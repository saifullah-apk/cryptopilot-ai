import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Candle } from '../src/lib/binance.ts'
import {
  ANALYSIS_WINDOW,
  BACKTEST_INTERVALS,
  BACKTEST_SYMBOLS,
  DEFAULT_MIN_CONFIDENCE,
  findExit,
  MAX_BACKTEST_RANGE_DAYS,
  runBacktest,
  validateBacktestRequest,
  type BacktestRequest,
  type OpenTrade,
} from '../src/lib/backtest.ts'
import { createPaperStore } from '../server/paperStore.ts'
import { createBacktestService } from '../server/backtestService.ts'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function candle(index: number, close: number, prev: number): Candle {
  const open = prev
  return {
    openTime: index * 60_000,
    open,
    high: Math.max(open, close) + 0.3,
    low: Math.min(open, close) - 0.3,
    close,
    volume: 100 + (index % 11),
    closeTime: index * 60_000 + 59_999,
  }
}

function series(closes: number[]): Candle[] {
  return closes.map((close, index) =>
    candle(index, close, index === 0 ? close : closes[index - 1]),
  )
}

/** Repeated rising steps with a small pullback every 8th bar. */
function staircase(count: number, up: boolean): number[] {
  const out: number[] = []
  let price = up ? 100 : 400
  for (let i = 0; i < count; i += 1) {
    price += i % 8 === 7 ? (up ? -3 : 3) : up ? 0.7 : -0.7
    out.push(price)
  }
  return out
}

function params(candles: Candle[], overrides: Partial<BacktestRequest> = {}): BacktestRequest {
  return {
    symbol: 'BTCUSDT',
    interval: '15m',
    startTime: candles[0].openTime,
    endTime: candles[candles.length - 1].closeTime,
    initialCapital: 10_000,
    riskPct: 1,
    minConfidence: 0,
    feeRate: 0.001,
    slippageRate: 0.0005,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

test('backtest request validation applies defaults and limits', () => {
  const now = Date.now()
  const valid = validateBacktestRequest({
    symbol: 'ETHUSDT',
    interval: '1h',
    startTime: now - 30 * 86_400_000,
    endTime: now - 60_000,
  })

  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(valid.value.initialCapital, 10_000)
    assert.equal(valid.value.riskPct, 1)
    assert.equal(valid.value.minConfidence, DEFAULT_MIN_CONFIDENCE)
    assert.equal(valid.value.feeRate, 0.001)
    assert.equal(valid.value.slippageRate, 0.0005)
  }

  assert.equal(
    validateBacktestRequest({
      symbol: 'DOGEUSDT',
      interval: '15m',
      startTime: now - 86_400_000,
      endTime: now,
    }).ok,
    false,
  )
  assert.equal(
    validateBacktestRequest({
      symbol: 'BTCUSDT',
      interval: '5m',
      startTime: now - 86_400_000,
      endTime: now,
    }).ok,
    false,
  )
  assert.equal(
    validateBacktestRequest({
      symbol: 'BTCUSDT',
      interval: '15m',
      startTime: now - 86_400_000,
      endTime: now + 86_400_000,
    }).ok,
    false,
  )
  assert.equal(
    validateBacktestRequest({
      symbol: 'BTCUSDT',
      interval: '15m',
      startTime: now,
      endTime: now - 86_400_000,
    }).ok,
    false,
  )
  assert.equal(
    validateBacktestRequest({
      symbol: 'BTCUSDT',
      interval: '15m',
      startTime: now - (MAX_BACKTEST_RANGE_DAYS + 1) * 86_400_000,
      endTime: now - 60_000,
    }).ok,
    false,
  )
  assert.equal(
    validateBacktestRequest({
      symbol: 'BTCUSDT',
      interval: '15m',
      startTime: now - 366 * 86_400_000,
      endTime: now - 60_000,
    }).ok,
    false,
    '15m over a year exceeds the candle cap',
  )
})

test('backtest constants expose the supported symbols and intervals', () => {
  assert.deepEqual([...BACKTEST_SYMBOLS], ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
  assert.deepEqual([...BACKTEST_INTERVALS], ['15m', '1h'])
})

/* ------------------------------------------------------------------ */
/* Exit precedence                                                    */
/* ------------------------------------------------------------------ */

function openLong(): OpenTrade {
  return {
    side: 'long',
    action: 'BUY',
    confidence: 60,
    entryPrice: 100,
    quantity: 1,
    stopLoss: 95,
    takeProfit: 120,
    entryFee: 0.1,
    entryTime: 0,
    entryIndex: 0,
    slippageCost: 0,
  }
}

test('a candle that spans both levels is scored as a stop-loss', () => {
  const exit = findExit(
    openLong(),
    {
      openTime: 60_000,
      open: 100,
      high: 125,
      low: 90,
      close: 110,
      volume: 1,
      closeTime: 119_999,
    },
    1,
    0.0005,
  )

  assert.ok(exit)
  assert.equal(exit?.reason, 'stop-loss')
  assert.ok((exit?.price ?? 0) < 95, 'stop fills with adverse slippage')
})

test('a gap through the stop fills at the candle open, not the stop level', () => {
  const exit = findExit(
    openLong(),
    {
      openTime: 60_000,
      open: 90,
      high: 96,
      low: 88,
      close: 92,
      volume: 1,
      closeTime: 119_999,
    },
    1,
    0.0005,
  )

  assert.equal(exit?.reason, 'stop-loss')
  assert.ok((exit?.price ?? 0) < 90, 'gap fill is worse than the stop')
})

test('a take-profit fills at its limit level without slippage', () => {
  const exit = findExit(
    openLong(),
    {
      openTime: 60_000,
      open: 110,
      high: 121,
      low: 108,
      close: 118,
      volume: 1,
      closeTime: 119_999,
    },
    1,
    0.0005,
  )

  assert.equal(exit?.reason, 'take-profit')
  assert.equal(exit?.price, 120)
})

/* ------------------------------------------------------------------ */
/* Engine                                                             */
/* ------------------------------------------------------------------ */

test('engine enters at the next candle open, never the signal close', () => {
  const candles = series(staircase(420, true))
  const report = runBacktest(candles, params(candles))

  assert.equal(report.lookAheadSafe, true)
  assert.ok(report.candlesEvaluated > 0)
  assert.ok(report.trades.length > 0, 'the rising fixture should produce entries')

  for (const trade of report.trades) {
    const entryCandle = candles.find((item) => item.openTime === trade.openedAt)
    assert.ok(entryCandle, 'entry timestamp must match a candle open')
    const expected =
      trade.side === 'long'
        ? entryCandle!.open * 1.0005
        : entryCandle!.open * 0.9995
    assert.ok(
      Math.abs(trade.entryPrice - expected) < 0.000001,
      'entry fill must be the next candle open with slippage',
    )
    assert.ok(trade.closedAt > trade.openedAt)
    assert.ok(['stop-loss', 'take-profit', 'end-of-data'].includes(trade.exitReason))
  }

  assert.equal(report.metrics.totalTrades, report.trades.length)
  assert.equal(report.metrics.startingBalance, 10_000)
  assert.equal(
    report.metrics.endingEquity,
    Math.round((10_000 + report.metrics.netPnl) * 100) / 100,
  )
})

test('fees and slippage reduce simulated results versus frictionless runs', () => {
  const candles = series(staircase(420, true))
  const frictionless = runBacktest(
    candles,
    params(candles, { feeRate: 0, slippageRate: 0 }),
  )
  const withCosts = runBacktest(candles, params(candles))

  assert.ok(frictionless.trades.length > 0)
  assert.ok(withCosts.trades.length > 0)

  for (const trade of frictionless.trades) {
    assert.equal(trade.fees, 0)
    assert.equal(trade.slippageCost, 0)
  }
  for (const trade of withCosts.trades) {
    assert.ok(trade.fees > 0, 'every simulated fill pays a fee')
  }

  if (frictionless.trades.length === withCosts.trades.length) {
    assert.ok(
      withCosts.metrics.netPnl < frictionless.metrics.netPnl,
      'fees and slippage must lower net P&L',
    )
  }
})

test('engine output is deterministic and position-locked', () => {
  const candles = series(staircase(420, true))
  const first = runBacktest(candles, params(candles))
  const second = runBacktest(candles, params(candles))

  assert.deepEqual(first.trades, second.trades)
  assert.equal(first.metrics.netPnl, second.metrics.netPnl)

  for (let i = 1; i < first.trades.length; i += 1) {
    assert.ok(
      first.trades[i].openedAt >= first.trades[i - 1].closedAt,
      'no overlapping positions',
    )
  }
})

test('engine stays inside the requested date window', () => {
  const candles = series(staircase(420, true))
  const all = params(candles)
  const startIndex = 200
  const endIndex = 320
  const windowed = runBacktest(candles, {
    ...all,
    startTime: candles[startIndex].openTime,
    endTime: candles[endIndex].closeTime,
  })

  for (const trade of windowed.trades) {
    assert.ok(trade.openedAt >= candles[startIndex].openTime)
    assert.ok(trade.openedAt <= candles[endIndex].openTime)
    assert.ok(trade.closedAt <= candles[endIndex].closeTime, 'exits never pass the end date')
  }
  assert.ok(windowed.candlesAvailable === candles.length)
})

test('short windows and flat data produce an honest empty report', () => {
  const flat = series(new Array(ANALYSIS_WINDOW + 20).fill(100))
  const report = runBacktest(flat, params(flat))

  assert.equal(report.trades.length, 0)
  assert.equal(report.metrics.winRate, null)
  assert.equal(report.metrics.profitFactor, null)
  assert.deepEqual(report.metrics.equityCurve, [])
  assert.ok(report.disclaimers.length >= 3)
})

/* ------------------------------------------------------------------ */
/* Server orchestration + persistence                                 */
/* ------------------------------------------------------------------ */

test('backtest service stores and reloads reports in SQLite', async () => {
  const root = existsSync('C:/Users/HP/AppData/Local/Temp/opencode')
    ? 'C:/Users/HP/AppData/Local/Temp/opencode'
    : tmpdir()
  const dir = mkdtempSync(join(root, 'cryptopilot-bt-'))
  const store = createPaperStore(join(dir, 'backtest.db'))

  try {
    const candles = series(staircase(420, true))
    const request = params(candles)
    const service = createBacktestService({
      store,
      fetchRange: async () => candles,
    })

    const stored = await service.run(request)
    assert.ok(stored.summary.id.length > 0)
    assert.equal(stored.summary.symbol, 'BTCUSDT')
    assert.equal(stored.summary.trades, stored.report.trades.length)
    assert.equal(stored.report.lookAheadSafe, true)

    const list = service.list()
    assert.equal(list.length, 1)
    assert.equal(list[0].id, stored.summary.id)

    const loaded = service.get(stored.summary.id)
    assert.deepEqual(loaded.report.trades, stored.report.trades)
    assert.equal(loaded.summary.netPnl, stored.report.metrics.netPnl)

    assert.throws(
      () => service.get('missing'),
      /Backtest run not found/,
    )
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
