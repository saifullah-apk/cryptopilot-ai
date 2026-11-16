import test from 'node:test'
import assert from 'node:assert/strict'

import type { Ticker24h } from '../src/lib/binance.ts'
import type { PaperAccount, PaperPosition, PaperState } from '../src/lib/paperTrading.ts'
import {
  virtualPortfolioFromPaperState,
} from '../src/lib/portfolio.ts'
import {
  assertReadOnlyPath,
  parseAccountPayload,
  PortfolioError,
  signedAccountUrl,
  valueBalances,
} from '../server/binanceReadOnly.ts'
import { createPortfolioService } from '../server/portfolioService.ts'

/* ------------------------------------------------------------------ */
/* Virtual portfolio fixtures                                         */
/* ------------------------------------------------------------------ */

function account(overrides: Partial<PaperAccount> = {}): PaperAccount {
  return {
    startingBalance: 10_000,
    cash: 3_995,
    equity: 9_995,
    realizedPnl: 0,
    unrealizedPnl: 995,
    feesPaid: 5,
    openPositionsCount: 1,
    maxOpenPositions: 3,
    riskPerTradePct: 1,
    maxRiskPerTradePct: 1,
    dailyPnl: 0,
    dailyLoss: 0,
    dailyLossLimit: 300,
    dailyLossLimitPct: 3,
    paused: false,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    ...overrides,
  }
}

function position(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 'p1',
    signalId: 's1',
    symbol: 'BTCUSDT',
    interval: '15m',
    side: 'long',
    quantity: 0.1,
    entryPrice: 50_000,
    stopLoss: 49_000,
    takeProfit: 55_000,
    fees: 5,
    openedAt: 1_000,
    status: 'open',
    exitPrice: null,
    exitReason: null,
    closedAt: null,
    realizedPnl: null,
    currentPrice: 60_000,
    unrealizedPnl: 995,
    pnlPercent: 19.9,
    ...overrides,
  }
}

function state(overrides: Partial<PaperState> = {}): PaperState {
  return {
    account: account(),
    signals: [],
    openPositions: [position()],
    closedPositions: [],
    orders: [],
    serverTime: 2_000,
    priceSource: 'binance-public',
    priceError: null,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Virtual portfolio                                                  */
/* ------------------------------------------------------------------ */

test('virtual portfolio separates cash and marked asset exposure', () => {
  const portfolio = virtualPortfolioFromPaperState(state())

  assert.equal(portfolio.cash, 3_995)
  assert.equal(portfolio.equity, 9_995)
  assert.equal(portfolio.exposure, 6_000)
  assert.equal(portfolio.totalPnl, -5)
  assert.equal(portfolio.totalPnlPct, -0.05)
  assert.equal(portfolio.allocationComplete, true)
  assert.equal(portfolio.assets.length, 1)

  const btc = portfolio.assets[0]
  assert.equal(btc.netQuantity, 0.1)
  assert.equal(btc.markPrice, 60_000)
  assert.equal(btc.value, 6_000)
  assert.equal(btc.unrealizedPnl, 995)
  // Cash 3,995 / (3,995 + 6,000).
  assert.equal(btc.allocationPct, 60)
  assert.equal(portfolio.cashAllocationPct, 40)
})

test('missing marks are never estimated and hide allocation percentages', () => {
  const portfolio = virtualPortfolioFromPaperState(
    state({
      openPositions: [
        position({ currentPrice: null, unrealizedPnl: null }),
      ],
      account: account({ unrealizedPnl: null }),
      priceError: 'Unable to refresh market prices: timeout',
    }),
  )

  assert.equal(portfolio.allocationComplete, false)
  assert.equal(portfolio.exposure, 0)
  assert.equal(portfolio.unrealizedPnl, null)
  assert.equal(portfolio.priceError, 'Unable to refresh market prices: timeout')
  assert.equal(portfolio.assets[0].value, null)
  assert.equal(portfolio.assets[0].markPrice, null)
  assert.equal(portfolio.assets[0].allocationPct, null)
  assert.equal(portfolio.cashAllocationPct, 100)
})

test('short exposure is signed but counted by absolute value', () => {
  const short = position({
    side: 'short',
    quantity: 0.2,
    entryPrice: 30_000,
    stopLoss: 31_000,
    takeProfit: 28_000,
    currentPrice: 25_000,
    unrealizedPnl: 995,
  })
  const portfolio = virtualPortfolioFromPaperState(
    state({ openPositions: [short], account: account({ equity: 10_000 }) }),
  )

  assert.equal(portfolio.assets[0].netQuantity, -0.2)
  assert.equal(portfolio.assets[0].longQuantity, 0)
  assert.equal(portfolio.assets[0].shortQuantity, 0.2)
  assert.equal(portfolio.assets[0].value, -5_000)
  assert.equal(portfolio.exposure, 5_000)
  assert.equal(portfolio.assets[0].allocationPct, 55.6) // 5000 / (3995 + 5000)
})

test('no open positions keeps the virtual portfolio in cash', () => {
  const portfolio = virtualPortfolioFromPaperState(
    state({
      openPositions: [],
      account: account({ cash: 10_050, equity: 10_050, unrealizedPnl: 0 }),
    }),
  )

  assert.deepEqual(portfolio.assets, [])
  assert.equal(portfolio.exposure, 0)
  assert.equal(portfolio.cashAllocationPct, 100)
  assert.equal(portfolio.allocationComplete, true)
})

/* ------------------------------------------------------------------ */
/* Read-only Binance parsing + signing                                */
/* ------------------------------------------------------------------ */

test('account payload parsing keeps non-zero balances only', () => {
  const parsed = parseAccountPayload({
    accountType: 'SPOT',
    canTrade: false,
    canWithdraw: false,
    canDeposit: true,
    balances: [
      { asset: 'BTC', free: '0.5', locked: '0.1' },
      { asset: 'USDT', free: '100', locked: '0' },
      { asset: 'DOGE', free: '0', locked: '0' },
    ],
  })

  assert.equal(parsed.accountType, 'SPOT')
  assert.equal(parsed.canTrade, false)
  assert.equal(parsed.canDeposit, true)
  assert.deepEqual(parsed.balances, [
    { asset: 'BTC', free: 0.5, locked: 0.1 },
    { asset: 'USDT', free: 100, locked: 0 },
  ])

  assert.throws(
    () => parseAccountPayload({ balances: null }),
    /no balances list/,
  )
})

test('balances are valued only with verified prices', async () => {
  const fakePrices = async (symbols: readonly string[]): Promise<Ticker24h[]> => {
    assert.deepEqual([...symbols], ['BTCUSDT'])
    return [
      {
        symbol: 'BTCUSDT',
        lastPrice: 50_000,
        openPrice: 49_000,
        highPrice: 51_000,
        lowPrice: 48_000,
        volume: 10,
        priceChangePercent: 2,
        closeTime: 1,
      },
    ]
  }

  const valued = await valueBalances(
    [
      { asset: 'BTC', free: 0.5, locked: 0.1 },
      { asset: 'USDT', free: 100, locked: 0 },
      { asset: 'DOGE', free: 1_000, locked: 0 },
    ],
    fakePrices,
  )

  assert.equal(valued.valuedSubtotal, 30_100)
  assert.deepEqual(valued.unpricedAssets, ['DOGE'])
  assert.equal(valued.balances[0].usdtValue, 30_000)
  assert.equal(valued.balances[1].usdtValue, 100)
  assert.equal(valued.balances[2].usdtValue, null)
})

test('signed account URLs are GET-only-shaped and never contain the secret', () => {
  const signed = signedAccountUrl('my-key', 'my-secret', 1_234_567)
  assert.match(
    signed.url,
    /^https:\/\/api\.binance\.com\/api\/v3\/account\?recvWindow=5000&timestamp=1234567&signature=[0-9a-f]{64}$/,
  )
  assert.equal(signed.keyHeader, 'my-key')
  assert.equal(signed.url.includes('my-secret'), false)

  assert.throws(() => assertReadOnlyPath('/api/v3/order'), /Blocked/)
  assert.throws(() => assertReadOnlyPath('/api/v3/account/withdraw'), /Blocked/)
  assert.doesNotThrow(() => assertReadOnlyPath('/api/v3/account'))
})

/* ------------------------------------------------------------------ */
/* Read-only service                                                  */
/* ------------------------------------------------------------------ */

const payload = {
  accountType: 'SPOT',
  canTrade: false,
  canWithdraw: false,
  canDeposit: true,
  balances: [
    { asset: 'BTC', free: '0.5', locked: '0' },
    { asset: 'USDT', free: '1000', locked: '0' },
  ],
}

test('portfolio service connects, reports permissions and disconnects', async () => {
  const calls: { url: string; method: string | undefined }[] = []
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const service = createPortfolioService({
    fetchImpl: fakeFetch,
    fetchPrices: async () => [
      {
        symbol: 'BTCUSDT',
        lastPrice: 50_000,
        openPrice: 49_000,
        highPrice: 51_000,
        lowPrice: 48_000,
        volume: 10,
        priceChangePercent: 2,
        closeTime: 1,
      },
    ],
    now: () => 1_700_000_000_000,
  })

  assert.equal(service.getStatus().connected, false)

  const connected = await service.connect('abc1234', 'secret')
  assert.equal(connected.connected, true)
  assert.equal(connected.readOnly, true)
  assert.equal(connected.keyHint, '••••1234')
  assert.equal(connected.snapshot?.canTrade, false)
  assert.equal(connected.snapshot?.canWithdraw, false)
  assert.equal(connected.snapshot?.permissionWarning, null)
  assert.equal(connected.snapshot?.valuedSubtotal, 26_000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'GET')
  assert.ok(calls[0].url.includes('/api/v3/account?'))
  assert.equal(calls[0].url.includes('secret'), false)

  const disconnected = service.disconnect()
  assert.equal(disconnected.connected, false)
  assert.equal(disconnected.snapshot, null)
})

test('invalid keys map to a clear 401 without leaking credentials', async () => {
  const service = createPortfolioService({
    fetchImpl: (async () => new Response('bad key', { status: 401 })) as typeof fetch,
    now: () => 1_700_000_000_000,
  })

  await assert.rejects(
    () => service.connect('bad-key', 'bad-secret'),
    (error: unknown) =>
      error instanceof PortfolioError &&
      error.status === 401 &&
      !error.message.includes('bad-secret'),
  )
  assert.equal(service.getStatus().connected, false)
})

test('trading-enabled keys surface a warning but remain read-only', async () => {
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({ ...payload, canTrade: true, canWithdraw: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch

  const service = createPortfolioService({
    fetchImpl: fakeFetch,
    fetchPrices: async () => [],
    now: () => 1_700_000_000_000,
  })

  const status = await service.connect('key', 'secret')
  assert.equal(status.connected, true)
  assert.match(status.snapshot?.permissionWarning ?? '', /read-only key/)
})
