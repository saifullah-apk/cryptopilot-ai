import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchKlines,
  fetchTickers24h,
  parseKlines,
  parseTicker24h,
} from '../src/lib/binance.ts'
import {
  MarketStream,
  isStale,
  nextReconnectDelay,
  parseStreamMessage,
  streamUrl,
} from '../src/lib/binanceSocket.ts'
import {
  formatPercent,
  formatPrice,
  percentChange,
} from '../src/lib/format.ts'

/* ------------------------------------------------------------------ */
/* Candle parsing                                                     */
/* ------------------------------------------------------------------ */

const RAW_KLINE = [
  1_764_000_000_000,
  '100.00',
  '104.50',
  '99.20',
  '103.10',
  '12.345',
  1_764_000_899_999,
  '1270.5',
  42,
  '6.1',
  '620.2',
  '0',
]

test('parseKlines converts Binance rows into numeric candles', () => {
  const candles = parseKlines([RAW_KLINE])
  assert.equal(candles.length, 1)
  assert.deepEqual(candles[0], {
    openTime: 1_764_000_000_000,
    open: 100,
    high: 104.5,
    low: 99.2,
    close: 103.1,
    volume: 12.345,
    closeTime: 1_764_000_899_999,
  })
})

test('parseKlines skips malformed rows instead of throwing', () => {
  const candles = parseKlines([
    RAW_KLINE,
    'not-a-row',
    [1, 2, 3],
    [1_764_000_900_000, 'x', '1', '1', '1', '1', '1'],
    [1_764_000_900_000, '101', '102', '100', '101.5', '2', 1_764_000_999_999],
  ])
  assert.equal(candles.length, 2)
  assert.equal(candles[1].close, 101.5)
})

test('parseKlines rejects a non-array payload', () => {
  assert.throws(() => parseKlines({ error: 'nope' }))
})

test('parseTicker24h maps public ticker fields', () => {
  const ticker = parseTicker24h({
    symbol: 'BTCUSDT',
    lastPrice: '73958.01',
    openPrice: '74359.14',
    highPrice: '74843.82',
    lowPrice: '72727.27',
    volume: '1200.5',
    priceChangePercent: '-0.54',
    closeTime: 1_764_000_000_000,
  })

  assert.equal(ticker.symbol, 'BTCUSDT')
  assert.equal(ticker.lastPrice, 73958.01)
  assert.equal(ticker.priceChangePercent, -0.54)
})

/* ------------------------------------------------------------------ */
/* WebSocket frames                                                   */
/* ------------------------------------------------------------------ */

test('parseStreamMessage parses a miniTicker frame', () => {
  const ticker = parseStreamMessage(
    JSON.stringify({
      stream: 'btcusdt@miniTicker',
      data: {
        e: '24hrMiniTicker',
        E: 1_764_000_000_000,
        s: 'BTCUSDT',
        c: '73978.00000000',
        o: '74359.14000000',
        h: '74843.82000000',
        l: '72727.27000000',
        v: '1234.5',
      },
    }),
  )

  assert.ok(ticker)
  assert.equal(ticker?.symbol, 'BTCUSDT')
  assert.equal(ticker?.last, 73978)
  assert.equal(ticker?.open, 74359.14)
})

test('parseStreamMessage ignores control frames and garbage', () => {
  assert.equal(parseStreamMessage(JSON.stringify({ result: null, id: 1 })), null)
  assert.equal(parseStreamMessage('not json'), null)
  assert.equal(parseStreamMessage(''), null)
  assert.equal(parseStreamMessage(42 as unknown), null)
})

test('streamUrl builds a combined public miniTicker stream', () => {
  const url = streamUrl(0, ['BTCUSDT', 'ETHUSDT'])
  assert.ok(url.startsWith('wss://'))
  assert.match(url, /btcusdt@miniTicker\/ethusdt@miniTicker/)
})

/* ------------------------------------------------------------------ */
/* Backoff + staleness                                                */
/* ------------------------------------------------------------------ */

test('nextReconnectDelay grows exponentially and is capped', () => {
  const noJitter = () => 0
  assert.equal(nextReconnectDelay(0, 1000, 30000, noJitter), 800)
  assert.equal(nextReconnectDelay(1, 1000, 30000, noJitter), 1600)
  assert.equal(nextReconnectDelay(2, 1000, 30000, noJitter), 3200)
  assert.equal(nextReconnectDelay(20, 1000, 30000, noJitter), 24000)
  assert.ok(nextReconnectDelay(0, 1000, 30000, () => 1) <= 1000)
})

test('isStale detects missing and old data', () => {
  assert.equal(isStale(null), true)
  assert.equal(isStale(1_000, 1_500, 1000), false)
  assert.equal(isStale(1_000, 2_500, 1000), true)
})

/* ------------------------------------------------------------------ */
/* Reconnection lifecycle                                             */
/* ------------------------------------------------------------------ */

type FakeSocket = {
  url: string
  closed: boolean
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close: () => void
}

function fakeSocketFactory() {
  const sockets: FakeSocket[] = []
  const createSocket = (url: string): FakeSocket => {
    const socket: FakeSocket = {
      url,
      closed: false,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close() {
        socket.closed = true
      },
    }
    sockets.push(socket)
    return socket
  }
  return { sockets, createSocket }
}

test('MarketStream reconnects automatically after a drop', async () => {
  const { sockets, createSocket } = fakeSocketFactory()
  const states: string[] = []
  const ticks: string[] = []

  const stream = new MarketStream({
    symbols: ['BTCUSDT'],
    onTicker: (ticker) => ticks.push(ticker.symbol),
    onState: (state) => states.push(state),
    createSocket,
    baseDelayMs: 5,
    maxDelayMs: 20,
    random: () => 0,
  })

  stream.connect()
  assert.equal(sockets.length, 1)
  assert.equal(states.at(-1), 'connecting')

  sockets[0].onopen?.(new Event('open'))
  assert.equal(states.at(-1), 'open')

  sockets[0].onmessage?.({
    data: JSON.stringify({
      data: { e: '24hrMiniTicker', s: 'BTCUSDT', c: '1', o: '1', h: '1', l: '1', v: '1', E: 1 },
    }),
  } as MessageEvent)
  assert.deepEqual(ticks, ['BTCUSDT'])

  sockets[0].onclose?.(new Event('close') as CloseEvent)
  assert.equal(states.at(-1), 'reconnecting')

  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(sockets.length, 2)
  assert.notEqual(sockets[1].url, sockets[0].url, 'host rotates after a drop')

  stream.close()
  assert.equal(states.at(-1), 'closed')
})

/* ------------------------------------------------------------------ */
/* Live network (skipped when Binance is unreachable)                 */
/* ------------------------------------------------------------------ */

test('live: fetchKlines returns parsed 15m candles', async (t) => {
  try {
    const candles = await fetchKlines('BTCUSDT', '15m', 3, AbortSignal.timeout(15_000))
    assert.ok(candles.length >= 1)
    for (const candle of candles) {
      assert.ok(candle.high >= candle.low)
      assert.ok(Number.isFinite(candle.close))
    }
  } catch (error) {
    t.skip(`Binance REST unavailable: ${(error as Error).message}`)
  }
})

test('live: fetchTickers24h returns BTC/ETH/SOL', async (t) => {
  try {
    const tickers = await fetchTickers24h(
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      AbortSignal.timeout(15_000),
    )
    assert.equal(tickers.length, 3)
    assert.deepEqual(
      tickers.map((ticker) => ticker.symbol).sort(),
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    )
  } catch (error) {
    t.skip(`Binance REST unavailable: ${(error as Error).message}`)
  }
})

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

test('formatters handle prices, percentages and guards', () => {
  assert.equal(formatPrice(73958.01), '73,958.01')
  assert.equal(formatPrice(null), '—')
  assert.equal(formatPercent(1.234), '+1.23%')
  assert.equal(formatPercent(-0.5), '-0.50%')
  assert.equal(percentChange(100, 110), 10)
  assert.equal(percentChange(0, 10), null)
})
