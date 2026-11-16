/**
 * Historical backtesting engine — pure and look-ahead safe.
 *
 * Rules that keep the simulation honest:
 *   - A signal is evaluated using ONLY candles up to and including bar `i`.
 *   - Entry happens at the OPEN of bar `i + 1`, never at bar `i`'s close.
 *   - Protective exits are checked with each later candle's high/low; when
 *     the stop and target could both be hit in the same candle, the stop is
 *     assumed first (the conservative choice).
 *   - Fees and adverse slippage are charged on every simulated fill.
 *
 * This is a historical simulation, not live or paper-account performance.
 */

import {
  analyzeCandles,
  type TechnicalAnalysis,
} from './indicators.ts'
import { evaluateSetup, MIN_SIGNAL_CANDLES } from './signals.ts'
import type { Candle, Interval, MarketSymbol } from './binance.ts'
import {
  analyticsFromTrades,
  type AnalyticsReport,
  type TradeRecord,
} from './analytics.ts'
import {
  calculateFee,
  calculatePositionSize,
  clamp,
  DEFAULT_RISK_PCT,
  FEE_RATE,
  MAX_RISK_PCT,
  netRealizedPnl,
  round,
  SLIPPAGE_RATE,
  STARTING_BALANCE,
  type ValidationResult,
} from './paperTrading.ts'

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const BACKTEST_SYMBOLS: readonly MarketSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
export const BACKTEST_INTERVALS: readonly Interval[] = ['15m', '1h']
export const MAX_BACKTEST_CANDLES = 25_000
export const MAX_BACKTEST_RANGE_DAYS = 366
export const MIN_BACKTEST_CAPITAL = 100
export const MAX_BACKTEST_CAPITAL = 1_000_000
export const DEFAULT_MIN_CONFIDENCE = 50
export const MAX_BACKTEST_MIN_CONFIDENCE = 90
/** Indicator history is recomputed from at most this many recent candles. */
export const ANALYSIS_WINDOW = 300

export const INTERVAL_MS: Record<Interval, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type BacktestRequest = {
  symbol: MarketSymbol
  interval: Interval
  /** Milliseconds since epoch, inclusive. */
  startTime: number
  /** Milliseconds since epoch, inclusive. */
  endTime: number
  initialCapital: number
  riskPct: number
  minConfidence: number
  feeRate: number
  slippageRate: number
}

export type BacktestExitReason = 'stop-loss' | 'take-profit' | 'end-of-data'

export type BacktestTrade = TradeRecord & {
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  exitPrice: number
  quantity: number
  stopLoss: number
  takeProfit: number
  entryFee: number
  exitFee: number
  fees: number
  slippageCost: number
  pnlPercent: number
}

export type BacktestReport = {
  symbol: MarketSymbol
  interval: Interval
  startTime: number
  endTime: number
  generatedAt: number
  params: BacktestRequest
  candlesAvailable: number
  candlesEvaluated: number
  executableSignals: number
  skippedSignals: number
  trades: BacktestTrade[]
  metrics: AnalyticsReport
  /** Always true — the engine never reads a future candle. */
  lookAheadSafe: true
  methodology: string[]
  disclaimers: string[]
}

export type BacktestRunSummary = {
  id: string
  symbol: MarketSymbol
  interval: Interval
  startTime: number
  endTime: number
  initialCapital: number
  riskPct: number
  minConfidence: number
  trades: number
  netPnl: number
  winRate: number | null
  maxDrawdownPct: number
  createdAt: number
}

export type StoredBacktestRun = {
  summary: BacktestRunSummary
  report: BacktestReport
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function estimateCandleCount(interval: Interval, startTime: number, endTime: number): number {
  const span = Math.max(0, endTime - startTime)
  return Math.ceil(span / INTERVAL_MS[interval]) + ANALYSIS_WINDOW + 5
}

export function validateBacktestRequest(value: unknown): ValidationResult<BacktestRequest> {
  if (!isRecord(value)) return { ok: false, error: 'Body must be an object.' }

  const symbol = value.symbol ?? 'BTCUSDT'
  if (typeof symbol !== 'string' || !BACKTEST_SYMBOLS.includes(symbol as MarketSymbol)) {
    return { ok: false, error: `Symbol must be one of ${BACKTEST_SYMBOLS.join(', ')}.` }
  }

  const interval = value.interval ?? '15m'
  if (typeof interval !== 'string' || !BACKTEST_INTERVALS.includes(interval as Interval)) {
    return { ok: false, error: `Interval must be one of ${BACKTEST_INTERVALS.join(', ')}.` }
  }

  const startTime = finiteNumber(value.startTime, Number.NaN)
  const endTime = finiteNumber(value.endTime, Number.NaN)
  if (startTime === null || endTime === null || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return { ok: false, error: 'startTime and endTime must be millisecond timestamps.' }
  }
  if (startTime <= 0 || endTime <= 0) {
    return { ok: false, error: 'The date range must be after 1970.' }
  }
  // Binance spot history starts in 2017; earlier timestamps cannot produce candles.
  const earliest = Date.UTC(2017, 0, 1)
  if (startTime < earliest) {
    return { ok: false, error: 'The start date must be on or after 2017-01-01.' }
  }
  if (startTime >= endTime) {
    return { ok: false, error: 'The start date must be before the end date.' }
  }
  if (endTime > Date.now() + 60_000) {
    return { ok: false, error: 'The end date cannot be in the future.' }
  }

  const rangeDays = (endTime - startTime) / 86_400_000
  if (rangeDays > MAX_BACKTEST_RANGE_DAYS) {
    return {
      ok: false,
      error: `The date range is limited to ${MAX_BACKTEST_RANGE_DAYS} days per backtest.`,
    }
  }

  const candleEstimate = estimateCandleCount(interval as Interval, startTime, endTime)
  if (candleEstimate > MAX_BACKTEST_CANDLES) {
    return {
      ok: false,
      error: `That range needs about ${candleEstimate.toLocaleString()} candles; the limit is ${MAX_BACKTEST_CANDLES.toLocaleString()}. Shorten the range or use 1h.`,
    }
  }

  const initialCapital = finiteNumber(value.initialCapital, STARTING_BALANCE)
  if (
    initialCapital === null ||
    initialCapital < MIN_BACKTEST_CAPITAL ||
    initialCapital > MAX_BACKTEST_CAPITAL
  ) {
    return {
      ok: false,
      error: `initialCapital must be between ${MIN_BACKTEST_CAPITAL} and ${MAX_BACKTEST_CAPITAL.toLocaleString()}.`,
    }
  }

  const riskPct = finiteNumber(value.riskPct, DEFAULT_RISK_PCT)
  if (riskPct === null || riskPct <= 0 || riskPct > MAX_RISK_PCT) {
    return { ok: false, error: `riskPct must be greater than 0 and at most ${MAX_RISK_PCT}.` }
  }

  const minConfidence = finiteNumber(value.minConfidence, DEFAULT_MIN_CONFIDENCE)
  if (
    minConfidence === null ||
    minConfidence < 0 ||
    minConfidence > MAX_BACKTEST_MIN_CONFIDENCE
  ) {
    return {
      ok: false,
      error: `minConfidence must be between 0 and ${MAX_BACKTEST_MIN_CONFIDENCE}.`,
    }
  }

  const feeRate = finiteNumber(value.feeRate, FEE_RATE)
  if (feeRate === null || feeRate < 0 || feeRate > 0.01) {
    return { ok: false, error: 'feeRate must be between 0 and 0.01 (0–1%).' }
  }

  const slippageRate = finiteNumber(value.slippageRate, SLIPPAGE_RATE)
  if (slippageRate === null || slippageRate < 0 || slippageRate > 0.01) {
    return { ok: false, error: 'slippageRate must be between 0 and 0.01 (0–1%).' }
  }

  return {
    ok: true,
    value: {
      symbol: symbol as MarketSymbol,
      interval: interval as Interval,
      startTime: Math.trunc(startTime),
      endTime: Math.trunc(endTime),
      initialCapital: round(initialCapital, 2),
      riskPct,
      minConfidence: Math.round(minConfidence),
      feeRate,
      slippageRate,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Engine helpers                                                     */
/* ------------------------------------------------------------------ */

export type OpenTrade = {
  side: 'long' | 'short'
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  quantity: number
  stopLoss: number
  takeProfit: number
  entryFee: number
  entryTime: number
  entryIndex: number
  slippageCost: number
}

function fillWithSlippage(price: number, side: 'buy' | 'sell', rate: number): number {
  return side === 'buy' ? price * (1 + rate) : price * (1 - rate)
}

function analyzeWindow(candles: readonly Candle[], index: number): TechnicalAnalysis {
  const from = Math.max(0, index + 1 - ANALYSIS_WINDOW)
  return analyzeCandles(candles.slice(from, index + 1))
}

type ExitFill = {
  reason: BacktestExitReason
  price: number
  index: number
  time: number
  slippageCost: number
}

/**
 * Checks one candle for a protective exit. Stop is evaluated first, so a
 * candle that spans both levels is scored as a loss.
 */
export function findExit(
  trade: OpenTrade,
  candle: Candle,
  index: number,
  slippageRate: number,
): ExitFill | null {
  if (trade.side === 'long') {
    if (candle.low <= trade.stopLoss) {
      const base = Math.min(candle.open, trade.stopLoss)
      const price = fillWithSlippage(base, 'sell', slippageRate)
      return {
        reason: 'stop-loss',
        price,
        index,
        time: candle.closeTime,
        slippageCost: Math.abs(price - base) * trade.quantity,
      }
    }
    if (candle.high >= trade.takeProfit) {
      return {
        reason: 'take-profit',
        price: trade.takeProfit,
        index,
        time: candle.closeTime,
        slippageCost: 0,
      }
    }
    return null
  }

  if (candle.high >= trade.stopLoss) {
    const base = Math.max(candle.open, trade.stopLoss)
    const price = fillWithSlippage(base, 'buy', slippageRate)
    return {
      reason: 'stop-loss',
      price,
      index,
      time: candle.closeTime,
      slippageCost: Math.abs(price - base) * trade.quantity,
    }
  }
  if (candle.low <= trade.takeProfit) {
    return {
      reason: 'take-profit',
      price: trade.takeProfit,
      index,
      time: candle.closeTime,
      slippageCost: 0,
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Engine                                                             */
/* ------------------------------------------------------------------ */

export function runBacktest(
  rawCandles: readonly Candle[],
  params: BacktestRequest,
): BacktestReport {
  // Sort defensively and drop duplicate bars so the timeline is unambiguous.
  const seen = new Set<number>()
  const candles = [...rawCandles]
    .filter(
      (candle) =>
        Number.isFinite(candle.openTime) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.open > 0,
    )
    .sort((a, b) => a.openTime - b.openTime)
    .filter((candle) => {
      if (seen.has(candle.openTime)) return false
      seen.add(candle.openTime)
      return true
    })

  const trades: BacktestTrade[] = []
  let equity = params.initialCapital
  let candlesEvaluated = 0
  let executableSignals = 0
  let skippedSignals = 0

  // The simulation cannot trade or exit after the requested end time.
  let lastIndex = -1
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].openTime <= params.endTime) lastIndex = i
  }

  let index = MIN_SIGNAL_CANDLES - 1

  while (index < lastIndex) {
    const signalCandle = candles[index]
    const entryCandle = candles[index + 1]

    // Only evaluate bars whose close is inside the requested window.
    if (signalCandle.closeTime < params.startTime) {
      index += 1
      continue
    }
    if (entryCandle.openTime > params.endTime) break

    candlesEvaluated += 1

    const analysis = analyzeWindow(candles, index)
    const draft = evaluateSetup(analysis, params.interval)
    if (!draft || (draft.action !== 'BUY' && draft.action !== 'SELL')) {
      index += 1
      continue
    }
    if (draft.confidence < params.minConfidence) {
      index += 1
      continue
    }

    executableSignals += 1
    const side = draft.action === 'BUY' ? 'long' : 'short'
    const entryFill = fillWithSlippage(
      entryCandle.open,
      side === 'long' ? 'buy' : 'sell',
      params.slippageRate,
    )

    // A gap can invalidate the levels the signal was built from.
    const levelsValid =
      side === 'long'
        ? entryFill > draft.stopLoss && entryFill < draft.takeProfit
        : entryFill < draft.stopLoss && entryFill > draft.takeProfit
    if (!levelsValid) {
      skippedSignals += 1
      index += 1
      continue
    }

    const size = calculatePositionSize({
      equity,
      cash: equity,
      riskPct: params.riskPct,
      entryPrice: entryFill,
      stopLoss: draft.stopLoss,
      feeRate: params.feeRate,
    })
    if (size.quantity <= 0) {
      skippedSignals += 1
      index += 1
      continue
    }

    const openTrade: OpenTrade = {
      side,
      action: draft.action,
      confidence: draft.confidence,
      entryPrice: entryFill,
      quantity: size.quantity,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
      entryFee: size.fee,
      entryTime: entryCandle.openTime,
      entryIndex: index + 1,
      slippageCost: Math.abs(entryFill - entryCandle.open) * size.quantity,
    }

    // Walk forward candle by candle. Stop is checked before target.
    let exit: ExitFill | null = null
    for (let j = index + 1; j <= lastIndex; j += 1) {
      exit = findExit(openTrade, candles[j], j, params.slippageRate)
      if (exit) break
    }

    if (exit === null) {
      const last = candles[lastIndex]
      const price = fillWithSlippage(
        last.close,
        side === 'long' ? 'sell' : 'buy',
        params.slippageRate,
      )
      exit = {
        reason: 'end-of-data',
        price,
        index: lastIndex,
        time: last.closeTime,
        slippageCost: Math.abs(price - last.close) * size.quantity,
      }
    }

    const exitFee = calculateFee(openTrade.quantity * exit.price, params.feeRate)
    const pnl = netRealizedPnl(
      side,
      openTrade.entryPrice,
      exit.price,
      openTrade.quantity,
      openTrade.entryFee,
      exitFee,
    )
    const notional = openTrade.entryPrice * openTrade.quantity
    equity = round(equity + pnl, 2)

    trades.push({
      id: `bt-${openTrade.entryTime}-${exit.index}`,
      symbol: params.symbol,
      interval: params.interval,
      side,
      action: openTrade.action,
      confidence: openTrade.confidence,
      pnl: round(pnl, 2),
      openedAt: openTrade.entryTime,
      closedAt: exit.time,
      exitReason: exit.reason,
      entryPrice: round(openTrade.entryPrice, 6),
      exitPrice: round(exit.price, 6),
      quantity: openTrade.quantity,
      stopLoss: round(openTrade.stopLoss, 6),
      takeProfit: round(openTrade.takeProfit, 6),
      entryFee: round(openTrade.entryFee, 2),
      exitFee: round(exitFee, 2),
      fees: round(openTrade.entryFee + exitFee, 2),
      slippageCost: round(openTrade.slippageCost + exit.slippageCost, 2),
      pnlPercent: notional > 0 ? round((pnl / notional) * 100, 2) : 0,
    })

    // Do not open another trade while this one was in the market.
    index = Math.max(index + 1, exit.index)
  }

  const metrics = analyticsFromTrades(trades, params.initialCapital)

  return {
    symbol: params.symbol,
    interval: params.interval,
    startTime: params.startTime,
    endTime: params.endTime,
    generatedAt: Date.now(),
    params,
    candlesAvailable: candles.length,
    candlesEvaluated,
    executableSignals,
    skippedSignals,
    trades,
    metrics,
    lookAheadSafe: true,
    methodology: [
      'Signals are evaluated only from candles up to and including the signal bar.',
      'Entries fill at the next candle open with adverse slippage — never at the signal candle close.',
      'Stops fill with adverse slippage; targets fill at their limit level.',
      'When a single candle spans both stop and target, the stop is assumed to fill first.',
      'One position at a time, risk-based sizing capped by available capital, no leverage.',
      `Fees ${(params.feeRate * 100).toFixed(2)}% per side and slippage ${(params.slippageRate * 100).toFixed(2)}% are applied to simulated fills.`,
    ],
    disclaimers: [
      'Backtest results are a historical simulation — not live trading, not paper-account performance, and not a forecast.',
      'The strategy reuses this app’s indicator rules; a good historical sample does not imply future profit.',
      'Real fills can be worse than simulated due to liquidity, latency, funding and exchange rules.',
      'No real order was placed by this backtest. CryptoPilot never trades with real money.',
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function clampRiskPct(value: number): number {
  return clamp(value, 0.1, MAX_RISK_PCT)
}

export function defaultBacktestRange(now = Date.now(), days = 90): {
  startTime: number
  endTime: number
} {
  const endTime = now
  const startTime = now - days * 86_400_000
  return { startTime, endTime }
}
