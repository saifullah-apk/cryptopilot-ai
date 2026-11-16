/**
 * Signal evaluation engine — turns verified indicator output into a
 * deterministic BUY / SELL / HOLD / NO TRADE draft.
 *
 * Pure and dependency-free: it only reads the `TechnicalAnalysis` it is
 * given, never a price source of its own. Confidence is a setup score built
 * from indicator agreement — it is never a win probability.
 */

import type { TechnicalAnalysis } from './indicators.ts'
import {
  calculateRiskReward,
  clamp,
  round,
  SIGNAL_TTL_MS,
  DEFAULT_RISK_PCT,
  MAX_RISK_PCT,
  FEE_RATE,
  SLIPPAGE_RATE,
  type PaperInterval,
  type SignalAction,
  type TradeSide,
} from './paperTrading.ts'

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const MIN_SIGNAL_CANDLES = 30
export const MAX_SIGNAL_ATR_PCT = 3
export const RSI_CHASE_OVERBOUGHT = 78
export const RSI_CHASE_OVERSOLD = 22
export const ACTION_VOTE_THRESHOLD = 1.5

export type SignalDraft = {
  action: SignalAction
  side: TradeSide
  /** 0–100 setup score. Descriptive, not predictive. */
  confidence: number
  entry: number
  stopLoss: number
  takeProfit: number
  riskReward: number
  technicalReasoning: string[]
  riskWarnings: string[]
}

export function signalExpiresAt(createdAt: number, interval: PaperInterval): number {
  return createdAt + SIGNAL_TTL_MS[interval]
}

export function isSignalExpired(expiresAt: number, now = Date.now()): boolean {
  return expiresAt <= now
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function decimalsFor(price: number): number {
  if (price >= 1) return 2
  if (price >= 0.01) return 4
  return 6
}

function priceLabel(value: number): string {
  const digits = decimalsFor(value)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Builds a signal draft from a verified analysis.
 * Returns `null` only when no usable market price exists — callers turn
 * that into an explicit market-data error instead of a fabricated number.
 */
export function evaluateSetup(
  analysis: TechnicalAnalysis,
  interval: PaperInterval,
): SignalDraft | null {
  const entry = analysis.lastClose
  if (entry === null || !Number.isFinite(entry) || entry <= 0) return null

  const { indicators: ind, trend, levels, patterns } = analysis
  const rsi14 = ind.rsi14
  const macdPoint = ind.macd
  const atr = ind.atr14
  const atrPct = ind.atrPercent
  const volume = ind.volume
  const newestPattern = patterns.length > 0 ? patterns[0] : null

  /* ---- votes from independent checks ---- */
  let net = 0
  if (trend.direction === 'bullish') net += 1
  else if (trend.direction === 'bearish') net -= 1

  if (ind.ema21 !== null) {
    if (entry > ind.ema21) net += 1
    else if (entry < ind.ema21) net -= 1
  }
  if (macdPoint) {
    if (macdPoint.histogram > 0) net += 1
    else if (macdPoint.histogram < 0) net -= 1
  }
  if (rsi14 !== null) {
    if (rsi14 >= 55) net += 1
    else if (rsi14 <= 45) net -= 1
  }
  if (ind.ema9 !== null && ind.ema21 !== null) {
    if (ind.ema9 > ind.ema21) net += 0.5
    else if (ind.ema9 < ind.ema21) net -= 0.5
  }
  if (newestPattern) {
    if (newestPattern.direction === 'bullish') net += 0.5
    else if (newestPattern.direction === 'bearish') net -= 0.5
  }

  const trendSign =
    trend.direction === 'bullish' ? 1 : trend.direction === 'bearish' ? -1 : 0
  const conflict = trendSign !== 0 && net !== 0 && Math.sign(net) !== trendSign

  /* ---- hard blocks → NO TRADE ---- */
  let blocked: string | null = null
  if (analysis.candleCount < MIN_SIGNAL_CANDLES) {
    blocked = `only ${analysis.candleCount} verified candles are available (at least ${MIN_SIGNAL_CANDLES} required)`
  } else if (atrPct !== null && atrPct > MAX_SIGNAL_ATR_PCT) {
    blocked = `ATR is ${atrPct.toFixed(1)}% of price — volatility is too high for a dependable stop`
  } else if (rsi14 !== null && rsi14 >= RSI_CHASE_OVERBOUGHT && trendSign >= 0) {
    blocked = `RSI 14 reads ${rsi14.toFixed(1)} — entering after such an extreme raises reversal risk`
  } else if (rsi14 !== null && rsi14 <= RSI_CHASE_OVERSOLD && trendSign <= 0) {
    blocked = `RSI 14 reads ${rsi14.toFixed(1)} — entering after such an extreme raises squeeze risk`
  } else if (conflict) {
    blocked = `indicators disagree with the ${trend.direction} trend — the setup is not trustworthy`
  }

  let action: SignalAction
  if (blocked) action = 'NO TRADE'
  else if (trend.direction === 'bullish' && net >= ACTION_VOTE_THRESHOLD) action = 'BUY'
  else if (trend.direction === 'bearish' && net <= -ACTION_VOTE_THRESHOLD) action = 'SELL'
  else action = 'HOLD'

  const side: TradeSide =
    action === 'SELL'
      ? 'short'
      : action === 'BUY'
        ? 'long'
        : trend.direction === 'bearish'
          ? 'short'
          : 'long'

  /* ---- confidence: agreement score, capped for non-entries ---- */
  const strength = trend.maxScore > 0 ? Math.abs(trend.score) / trend.maxScore : 0
  let confidence = 40 + clamp(net, -5, 5) * 6 + strength * 10
  if (volume && volume.relative !== null) {
    confidence += volume.relative >= 1.1 ? 4 : volume.relative < 0.7 ? -4 : 0
  }
  confidence = clamp(Math.round(confidence), 5, 88)
  if (action !== 'BUY' && action !== 'SELL') confidence = Math.min(confidence, 45)

  /* ---- levels: ATR-based risk, structure-aware target ---- */
  const distance =
    atr !== null && atr > 0 ? clamp(atr * 1.6, entry * 0.005, entry * 0.03) : entry * 0.01
  const dp = decimalsFor(entry)

  let stopLoss: number
  let takeProfit: number

  if (side === 'long') {
    stopLoss = round(entry - distance, dp)
    let target = entry + distance * 2
    const resistance = levels.resistances.length > 0 ? levels.resistances[0] : null
    if (resistance !== null && resistance > entry) {
      const rr = (resistance - entry) / distance
      if (rr >= 1.4 && rr <= 3.5) target = resistance
    }
    takeProfit = round(target, dp)
    if (!(stopLoss < entry)) stopLoss = round(entry - entry * 0.005, dp)
    if (!(takeProfit > entry)) takeProfit = round(entry + entry * 0.01, dp)
  } else {
    stopLoss = round(entry + distance, dp)
    let target = entry - distance * 2
    const support = levels.supports.length > 0 ? levels.supports[0] : null
    if (support !== null && support < entry) {
      const rr = (entry - support) / distance
      if (rr >= 1.4 && rr <= 3.5) target = support
    }
    takeProfit = round(target, dp)
    if (!(stopLoss > entry)) stopLoss = round(entry + entry * 0.005, dp)
    if (!(takeProfit < entry)) takeProfit = round(entry - entry * 0.01, dp)
  }

  const riskReward = round(calculateRiskReward(entry, stopLoss, takeProfit), 2)

  /* ---- technical reasoning (verified values only) ---- */
  const reasoning: string[] = []
  reasoning.push(
    `Trend is ${trend.direction} (net weighted score ${trend.score}/${trend.maxScore})`,
  )
  if (trend.reasons.length > 0) {
    reasoning.push(`Trend basis: ${trend.reasons.slice(0, 2).join(' · ')}`)
  }
  if (analysis.insufficient.length > 0) {
    reasoning.push(`Limited history: ${analysis.insufficient.slice(0, 2).join('; ')}`)
  }
  if (rsi14 !== null) {
    const zone =
      rsi14 >= 70
        ? 'overbought zone'
        : rsi14 <= 30
          ? 'oversold zone'
          : rsi14 >= 55
            ? 'bullish momentum'
            : rsi14 <= 45
              ? 'bearish momentum'
              : 'neutral zone'
    reasoning.push(`RSI 14 reads ${rsi14.toFixed(1)} — ${zone}`)
  }
  if (macdPoint) {
    const momentum =
      macdPoint.histogram > 0
        ? 'positive momentum'
        : macdPoint.histogram < 0
          ? 'negative momentum'
          : 'flat momentum'
    reasoning.push(`MACD histogram is ${macdPoint.histogram.toFixed(2)} — ${momentum}`)
  }
  if (newestPattern) {
    reasoning.push(
      `Latest candle shows ${newestPattern.name} (${newestPattern.direction}) — ${newestPattern.description}`,
    )
  }
  if (levels.supports.length > 0 || levels.resistances.length > 0) {
    const parts: string[] = []
    if (levels.resistances.length > 0) parts.push(`resistance ${priceLabel(levels.resistances[0])}`)
    if (levels.supports.length > 0) parts.push(`support ${priceLabel(levels.supports[0])}`)
    reasoning.push(`Nearest structure: ${parts.join(', ')}`)
  }
  if (volume && volume.relative !== null) {
    reasoning.push(
      `Volume is ${volume.relative.toFixed(2)}x its 20-candle average (${volume.trend ?? 'trend unknown'})`,
    )
  }
  const emaParts: string[] = []
  if (ind.ema50 !== null) {
    emaParts.push(`EMA 50 ${entry > ind.ema50 ? 'above' : entry < ind.ema50 ? 'below' : 'at price'}`)
  }
  if (ind.ema200 !== null) {
    emaParts.push(`EMA 200 ${entry > ind.ema200 ? 'above' : entry < ind.ema200 ? 'below' : 'at price'}`)
  }
  if (emaParts.length > 0) reasoning.push(`Price relative to long-term averages: ${emaParts.join(', ')}`)
  if (reasoning.length === 0) {
    reasoning.push(`Only ${analysis.candleCount} candles analysed — indicators are incomplete.`)
  }
  const technicalReasoning = reasoning.slice(0, 6)

  /* ---- risk warnings (uncertainty first) ---- */
  const ttlMinutes = Math.round(SIGNAL_TTL_MS[interval] / 60_000)
  const distPct = round((distance / entry) * 100, 2)
  const warnings: string[] = []
  if (action === 'NO TRADE' && blocked) warnings.push(`No entry: ${blocked}.`)
  if (action === 'HOLD') {
    warnings.push('Setup is indecisive — nothing to execute; the levels are reference only.')
  }
  warnings.push(
    `Confidence ${confidence}/100 is a setup score derived from indicators — not a win probability.`,
  )
  warnings.push(
    `The stop sits ${distPct}% from entry; size is capped at ${DEFAULT_RISK_PCT}% of equity (${MAX_RISK_PCT}% maximum) with a mandatory stop-loss.`,
  )
  warnings.push(
    `This signal expires ${ttlMinutes} minutes after creation — price can move through the stop in a single candle.`,
  )
  if (atrPct !== null) {
    warnings.push(
      `ATR is ${atrPct.toFixed(1)}% of price, so ordinary candles on this timeframe can reach the stop without any trend change.`,
    )
  }
  warnings.push(
    `Simulated fills add a ${(FEE_RATE * 100).toFixed(1)}% fee and ${(SLIPPAGE_RATE * 100).toFixed(2)}% slippage — paper results differ from live execution.`,
  )
  warnings.push('Paper trading only — no real orders, no exchange connection, no withdrawals.')
  const riskWarnings = warnings.slice(0, 6)

  return {
    action,
    side,
    confidence,
    entry,
    stopLoss,
    takeProfit,
    riskReward,
    technicalReasoning,
    riskWarnings,
  }
}
