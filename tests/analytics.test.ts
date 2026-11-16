import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyticsFromPaperPositions,
  analyticsFromTrades,
  buildEquityCurve,
  maxDrawdownFromCurve,
  tradeFromPaperPosition,
  tradesFromPaperPositions,
  type TradeRecord,
} from '../src/lib/analytics.ts'
import type { PaperPosition } from '../src/lib/paperTrading.ts'

function trade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 't1',
    symbol: 'BTCUSDT',
    interval: '15m',
    side: 'long',
    pnl: 100,
    openedAt: 1_000,
    closedAt: 2_000,
    exitReason: 'take-profit',
    ...overrides,
  }
}

function paperPosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 'p1',
    signalId: 's1',
    symbol: 'BTCUSDT',
    interval: '15m',
    side: 'long',
    quantity: 0.1,
    entryPrice: 50_000,
    stopLoss: 49_000,
    takeProfit: 52_000,
    fees: 10,
    openedAt: 1_000,
    status: 'closed',
    exitPrice: 52_000,
    exitReason: 'take-profit',
    closedAt: 2_000,
    realizedPnl: 190,
    currentPrice: null,
    unrealizedPnl: null,
    pnlPercent: null,
    ...overrides,
  }
}

test('empty samples return explicit nulls instead of misleading zeros', () => {
  const report = analyticsFromTrades([], 10_000)

  assert.equal(report.totalTrades, 0)
  assert.equal(report.wins, 0)
  assert.equal(report.losses, 0)
  assert.equal(report.winRate, null)
  assert.equal(report.averageWin, null)
  assert.equal(report.averageLoss, null)
  assert.equal(report.averagePnl, null)
  assert.equal(report.profitFactor, null)
  assert.equal(report.netPnl, 0)
  assert.equal(report.endingEquity, 10_000)
  assert.equal(report.maxDrawdown, 0)
  assert.equal(report.maxDrawdownPct, 0)
  assert.deepEqual(report.equityCurve, [])
  assert.deepEqual(report.bySymbol, [])
  assert.deepEqual(report.byTimeframe, [])
  assert.equal(report.bestTrade, null)
  assert.equal(report.worstTrade, null)
})

test('mixed results compute win rate, averages, profit factor and drawdown', () => {
  const trades = [
    trade({ id: 'a', pnl: 200, closedAt: 1_000 }),
    trade({ id: 'b', pnl: -100, symbol: 'ETHUSDT', closedAt: 2_000 }),
    trade({ id: 'c', pnl: 300, interval: '1h', closedAt: 3_000 }),
    trade({ id: 'd', pnl: -50, symbol: 'ETHUSDT', interval: '1h', closedAt: 4_000 }),
  ]

  const report = analyticsFromTrades(trades, 10_000)

  assert.equal(report.totalTrades, 4)
  assert.equal(report.wins, 2)
  assert.equal(report.losses, 2)
  assert.equal(report.winRate, 50)
  assert.equal(report.grossProfit, 500)
  assert.equal(report.grossLoss, -150)
  assert.equal(report.netPnl, 350)
  assert.equal(report.averageWin, 250)
  assert.equal(report.averageLoss, -75)
  assert.equal(report.averagePnl, 87.5)
  assert.equal(report.profitFactor, 3.33)
  assert.equal(report.endingEquity, 10_350)
  assert.equal(report.bestTrade?.id, 'c')
  assert.equal(report.worstTrade?.id, 'b')

  // Equity anchors at 10,000, then 10,200 / 10,100 / 10,400 / 10,350.
  assert.deepEqual(
    report.equityCurve.map((point) => point.equity),
    [10_000, 10_200, 10_100, 10_400, 10_350],
  )
  assert.equal(report.maxDrawdown, 100)
  assert.equal(report.maxDrawdownPct, 0.98)
})

test('all-winning samples report an undefined profit factor and no average loss', () => {
  const report = analyticsFromTrades(
    [trade({ id: 'a', pnl: 10 }), trade({ id: 'b', pnl: 30 })],
    1_000,
  )

  assert.equal(report.totalTrades, 2)
  assert.equal(report.wins, 2)
  assert.equal(report.losses, 0)
  assert.equal(report.winRate, 100)
  assert.equal(report.averageLoss, null)
  assert.equal(report.profitFactor, null)
  assert.equal(report.netPnl, 40)
  assert.equal(report.maxDrawdown, 0)
})

test('break-even trades count toward win rate but not wins or losses', () => {
  const report = analyticsFromTrades([
    trade({ id: 'a', pnl: 0 }),
    trade({ id: 'b', pnl: 10 }),
    trade({ id: 'c', pnl: -10 }),
  ])

  assert.equal(report.breakEven, 1)
  assert.equal(report.wins, 1)
  assert.equal(report.losses, 1)
  assert.equal(report.winRate, 33.3)
  assert.equal(report.profitFactor, 1)
})

test('drawdown is measured peak-to-trough across the whole curve', () => {
  const curve = buildEquityCurve([
    trade({ id: 'a', pnl: 500, closedAt: 100 }),
    trade({ id: 'b', pnl: -700, closedAt: 200 }),
    trade({ id: 'c', pnl: 100, closedAt: 300 }),
  ], 10_000)

  const drawdown = maxDrawdownFromCurve(curve)
  assert.equal(drawdown.peakEquity, 10_500)
  assert.equal(drawdown.amount, 700)
  assert.equal(drawdown.pct, 6.67)
})

test('performance breakdowns group by symbol and timeframe', () => {
  const report = analyticsFromTrades([
    trade({ id: 'a', symbol: 'BTCUSDT', interval: '15m', pnl: 100 }),
    trade({ id: 'b', symbol: 'BTCUSDT', interval: '1h', pnl: -40 }),
    trade({ id: 'c', symbol: 'ETHUSDT', interval: '15m', pnl: 60 }),
  ])

  assert.deepEqual(
    report.bySymbol.map((row) => [row.key, row.trades, row.netPnl]),
    [
      ['BTCUSDT', 2, 60],
      ['ETHUSDT', 1, 60],
    ],
  )
  assert.deepEqual(
    report.byTimeframe.map((row) => [row.key, row.trades, row.netPnl]),
    [
      ['15m', 2, 160],
      ['1h', 1, -40],
    ],
  )
  const eth = report.bySymbol.find((row) => row.key === 'ETHUSDT')
  assert.equal(eth?.winRate, 100)
  assert.equal(eth?.avgPnl, 60)
})

test('paper positions convert to trades only when closed and priced', () => {
  const closed = paperPosition()
  const open = paperPosition({
    id: 'p2',
    status: 'open',
    closedAt: null,
    realizedPnl: null,
  })
  const missingPnl = paperPosition({ id: 'p3', realizedPnl: null })

  assert.equal(tradeFromPaperPosition(closed)?.pnl, 190)
  assert.equal(tradeFromPaperPosition(open), null)
  assert.equal(tradeFromPaperPosition(missingPnl), null)
  assert.equal(tradesFromPaperPositions([closed, open, missingPnl]).length, 1)

  const report = analyticsFromPaperPositions([closed], 10_000)
  assert.equal(report.totalTrades, 1)
  assert.equal(report.netPnl, 190)
  assert.equal(report.endingEquity, 10_190)
  assert.equal(report.bySymbol[0].key, 'BTCUSDT')
})
