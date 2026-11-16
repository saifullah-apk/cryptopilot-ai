/**
 * Performance analytics — pure calculations over closed trades.
 *
 * Used for two clearly separated things:
 *   1. the virtual paper-trading portfolio (`tradesFromPaperPositions`)
 *   2. historical backtest reports (`analyticsFromTrades`)
 *
 * Every number is derived from the trades passed in. Nothing is estimated,
 * and empty samples return explicit nulls instead of misleading zeros.
 */

import { round, STARTING_BALANCE, type PaperPosition } from './paperTrading.ts'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** Minimal shape needed for analytics; paper and backtest trades both map to this. */
export type TradeRecord = {
  id: string
  symbol: string
  interval: string
  side: 'long' | 'short'
  /** Net P&L after entry + exit fees and slippage. */
  pnl: number
  openedAt: number
  closedAt: number
  exitReason: string
}

export type EquityPoint = {
  at: number
  equity: number
  /** Cumulative net P&L at this point. */
  pnl: number
  /** Equity change contributed by this trade. */
  change: number
}

export type PerformanceBreakdown = {
  key: string
  trades: number
  wins: number
  losses: number
  winRate: number | null
  netPnl: number
  avgPnl: number | null
}

export type PerformanceMetrics = {
  totalTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number | null
  averageWin: number | null
  /** Negative when there are losing trades. */
  averageLoss: number | null
  averagePnl: number | null
  grossProfit: number
  grossLoss: number
  /** Gross profit ÷ gross loss. `null` when there are no losses. */
  profitFactor: number | null
  netPnl: number
  /** Equity at the start of the sample (before any trade). */
  startingBalance: number
  endingEquity: number
  /** Absolute peak-to-trough decline in equity. */
  maxDrawdown: number
  /** Peak-to-trough decline as a percentage of the peak. */
  maxDrawdownPct: number
  peakEquity: number
}

export type AnalyticsReport = PerformanceMetrics & {
  equityCurve: EquityPoint[]
  bySymbol: PerformanceBreakdown[]
  byTimeframe: PerformanceBreakdown[]
  bestTrade: TradeRecord | null
  worstTrade: TradeRecord | null
}

/* ------------------------------------------------------------------ */
/* Conversion helpers                                                 */
/* ------------------------------------------------------------------ */

export function tradeFromPaperPosition(position: PaperPosition): TradeRecord | null {
  if (
    position.status !== 'closed' ||
    position.realizedPnl === null ||
    position.closedAt === null ||
    !Number.isFinite(position.realizedPnl)
  ) {
    return null
  }

  return {
    id: position.id,
    symbol: position.symbol,
    interval: position.interval,
    side: position.side,
    pnl: position.realizedPnl,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    exitReason: position.exitReason ?? 'manual',
  }
}

export function tradesFromPaperPositions(positions: readonly PaperPosition[]): TradeRecord[] {
  return positions
    .map(tradeFromPaperPosition)
    .filter((trade): trade is TradeRecord => trade !== null)
}

/* ------------------------------------------------------------------ */
/* Equity curve & drawdown                                            */
/* ------------------------------------------------------------------ */

function sortTrades(trades: readonly TradeRecord[]): TradeRecord[] {
  return [...trades].sort((a, b) => a.closedAt - b.closedAt || a.openedAt - b.openedAt)
}

/**
 * Reconstructs an equity curve from the starting balance and each trade's
 * realised P&L. The first point is an anchor at the starting balance, so a
 * first-trade loss still produces a visible drawdown.
 */
export function buildEquityCurve(
  trades: readonly TradeRecord[],
  startingBalance = STARTING_BALANCE,
): EquityPoint[] {
  const sorted = sortTrades(trades)
  const points: EquityPoint[] = []

  if (sorted.length > 0) {
    const firstAt = Math.min(sorted[0].openedAt, sorted[0].closedAt)
    points.push({
      at: firstAt,
      equity: round(startingBalance, 2),
      pnl: 0,
      change: 0,
    })
  }

  let equity = startingBalance
  for (const trade of sorted) {
    equity += trade.pnl
    points.push({
      at: trade.closedAt,
      equity: round(equity, 2),
      pnl: round(equity - startingBalance, 2),
      change: round(trade.pnl, 2),
    })
  }

  return points
}

export function maxDrawdownFromCurve(curve: readonly EquityPoint[]): {
  amount: number
  pct: number
  peakEquity: number
} {
  let peak = 0
  let amount = 0
  let peakAtMaxDrawdown = 0

  for (const point of curve) {
    if (point.equity > peak) peak = point.equity
    const decline = peak - point.equity
    if (decline > amount) {
      amount = decline
      peakAtMaxDrawdown = peak
    }
  }

  return {
    amount: round(amount, 2),
    pct:
      peakAtMaxDrawdown > 0
        ? round((amount / peakAtMaxDrawdown) * 100, 2)
        : 0,
    peakEquity: round(peak, 2),
  }
}

/* ------------------------------------------------------------------ */
/* Breakdowns                                                         */
/* ------------------------------------------------------------------ */

function buildBreakdown(
  trades: readonly TradeRecord[],
  keyOf: (trade: TradeRecord) => string,
): PerformanceBreakdown[] {
  const groups = new Map<string, TradeRecord[]>()

  for (const trade of trades) {
    const key = keyOf(trade)
    const list = groups.get(key)
    if (list) list.push(trade)
    else groups.set(key, [trade])
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const wins = rows.filter((trade) => trade.pnl > 0).length
      const losses = rows.filter((trade) => trade.pnl < 0).length
      const netPnl = round(
        rows.reduce((sum, trade) => sum + trade.pnl, 0),
        2,
      )
      return {
        key,
        trades: rows.length,
        wins,
        losses,
        winRate:
          rows.length > 0 ? round((wins / rows.length) * 100, 1) : null,
        netPnl,
        avgPnl: rows.length > 0 ? round(netPnl / rows.length, 2) : null,
      }
    })
    .sort((a, b) => b.netPnl - a.netPnl)
}

/* ------------------------------------------------------------------ */
/* Main report                                                        */
/* ------------------------------------------------------------------ */

export function analyticsFromTrades(
  inputTrades: readonly TradeRecord[],
  startingBalance = STARTING_BALANCE,
): AnalyticsReport {
  const trades = sortTrades(inputTrades)
  const wins = trades.filter((trade) => trade.pnl > 0)
  const losses = trades.filter((trade) => trade.pnl < 0)
  const breakEven = trades.length - wins.length - losses.length

  const grossProfit = round(
    wins.reduce((sum, trade) => sum + trade.pnl, 0),
    2,
  )
  const grossLoss = round(
    losses.reduce((sum, trade) => sum + trade.pnl, 0),
    2,
  )
  const netPnl = round(grossProfit + grossLoss, 2)

  const curve = buildEquityCurve(trades, startingBalance)
  const drawdown = maxDrawdownFromCurve(curve)
  const endingEquity = round(startingBalance + netPnl, 2)

  let bestTrade: TradeRecord | null = null
  let worstTrade: TradeRecord | null = null
  for (const trade of trades) {
    if (bestTrade === null || trade.pnl > bestTrade.pnl) bestTrade = trade
    if (worstTrade === null || trade.pnl < worstTrade.pnl) worstTrade = trade
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakEven,
    winRate: trades.length > 0 ? round((wins.length / trades.length) * 100, 1) : null,
    averageWin:
      wins.length > 0 ? round(grossProfit / wins.length, 2) : null,
    averageLoss:
      losses.length > 0 ? round(grossLoss / losses.length, 2) : null,
    averagePnl: trades.length > 0 ? round(netPnl / trades.length, 2) : null,
    grossProfit,
    grossLoss,
    profitFactor:
      losses.length > 0 && grossLoss < 0
        ? round(grossProfit / Math.abs(grossLoss), 2)
        : null,
    netPnl,
    startingBalance: round(startingBalance, 2),
    endingEquity,
    maxDrawdown: drawdown.amount,
    maxDrawdownPct: drawdown.pct,
    peakEquity: drawdown.peakEquity,
    equityCurve: curve,
    bySymbol: buildBreakdown(trades, (trade) => trade.symbol),
    byTimeframe: buildBreakdown(trades, (trade) => trade.interval),
    bestTrade,
    worstTrade,
  }
}

/** Analytics for the virtual paper portfolio. */
export function analyticsFromPaperPositions(
  closedPositions: readonly PaperPosition[],
  startingBalance = STARTING_BALANCE,
): AnalyticsReport {
  return analyticsFromTrades(tradesFromPaperPositions(closedPositions), startingBalance)
}
