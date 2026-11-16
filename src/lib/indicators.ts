/**
 * Technical analysis engine — pure, dependency-free calculations.
 *
 * Every function is deterministic and side-effect free so it can be unit
 * tested and reused by any view. Warm-up periods return `null`; values are
 * never estimated or back-filled.
 */

import type { Candle } from './binance.ts'

export type MaybeNumber = number | null

/* ------------------------------------------------------------------ */
/* Moving averages                                                    */
/* ------------------------------------------------------------------ */

export function sma(values: readonly number[], period: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out

  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]

  out[period - 1] = sum / period
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period]
    out[i] = sum / period
  }
  return out
}

/** Exponential moving average seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out

  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]

  let previous = sum / period
  out[period - 1] = previous

  const k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k)
    out[i] = previous
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Momentum                                                           */
/* ------------------------------------------------------------------ */

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgGain === 0 && avgLoss === 0) return 50
  if (avgLoss === 0) return 100
  if (avgGain === 0) return 0
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Relative Strength Index using Wilder's smoothing. */
export function rsi(values: readonly number[], period = 14): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length <= period) return out

  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1]
    if (delta >= 0) gain += delta
    else loss -= delta
  }

  let avgGain = gain / period
  let avgLoss = loss / period
  out[period] = rsiFromAverages(avgGain, avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period
    out[i] = rsiFromAverages(avgGain, avgLoss)
  }

  return out
}

export type MacdSeries = {
  macd: MaybeNumber[]
  signal: MaybeNumber[]
  histogram: MaybeNumber[]
}

/** MACD (12, 26, 9 by default) with an EMA-smoothed signal line. */
export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdSeries {
  const fast = ema(values, fastPeriod)
  const slow = ema(values, slowPeriod)

  const macdLine: MaybeNumber[] = values.map((_, index) => {
    const f = fast[index]
    const s = slow[index]
    return f !== null && s !== null ? f - s : null
  })

  const firstIndex = slowPeriod - 1
  const compact = firstIndex >= 0 ? macdLine.slice(firstIndex) : []
  const compactValues = compact.filter((value): value is number => value !== null)
  const signalCompact = ema(compactValues, signalPeriod)

  const signal: MaybeNumber[] = new Array(values.length).fill(null)
  if (compactValues.length === compact.length) {
    for (let i = 0; i < signalCompact.length; i++) {
      signal[firstIndex + i] = signalCompact[i]
    }
  }

  const histogram: MaybeNumber[] = macdLine.map((value, index) => {
    const s = signal[index]
    return value !== null && s !== null ? value - s : null
  })

  return { macd: macdLine, signal, histogram }
}

/* ------------------------------------------------------------------ */
/* Volatility                                                         */
/* ------------------------------------------------------------------ */

export type BollingerPoint = {
  middle: number
  upper: number
  lower: number
  /** (upper - lower) / middle, as a percentage. */
  bandwidth: number
  /** Position of the close within the band, 0..100. */
  percentB: number
}

export function bollinger(
  values: readonly number[],
  period = 20,
  multiplier = 2,
): (BollingerPoint | null)[] {
  const out: (BollingerPoint | null)[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    const middle = sum / period

    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - middle
      variance += diff * diff
    }
    const deviation = Math.sqrt(variance / period)
    const upper = middle + multiplier * deviation
    const lower = middle - multiplier * deviation

    out[i] = {
      middle,
      upper,
      lower,
      bandwidth: middle !== 0 ? ((upper - lower) / middle) * 100 : 0,
      percentB: upper !== lower ? ((values[i] - lower) / (upper - lower)) * 100 : 50,
    }
  }

  return out
}

export function trueRange(candles: readonly Candle[]): number[] {
  const out: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    if (i === 0) {
      out.push(candle.high - candle.low)
      continue
    }
    const previousClose = candles[i - 1].close
    out.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    )
  }
  return out
}

/** Average True Range using Wilder's smoothing. */
export function atr(candles: readonly Candle[], period = 14): MaybeNumber[] {
  const ranges = trueRange(candles)
  const out: MaybeNumber[] = new Array(candles.length).fill(null)
  if (period <= 0 || ranges.length < period) return out

  let sum = 0
  for (let i = 0; i < period; i++) sum += ranges[i]

  let previous = sum / period
  out[period - 1] = previous

  for (let i = period; i < ranges.length; i++) {
    previous = (previous * (period - 1) + ranges[i]) / period
    out[i] = previous
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Volume                                                             */
/* ------------------------------------------------------------------ */

export type VolumeStats = {
  last: number
  average: number | null
  /** last / average, e.g. 1.8 means 1.8x normal. */
  relative: number | null
  trend: 'rising' | 'falling' | 'flat' | null
}

export function analyzeVolume(candles: readonly Candle[], period = 20): VolumeStats | null {
  if (candles.length === 0) return null

  const last = candles[candles.length - 1].volume

  let average: number | null = null
  if (candles.length >= period) {
    const window = candles.slice(-period)
    average = window.reduce((total, candle) => total + candle.volume, 0) / period
  }

  const relative = average !== null && average > 0 ? last / average : null

  let trend: VolumeStats['trend'] = null
  if (candles.length >= 6) {
    const recent = candles.slice(-3).reduce((total, candle) => total + candle.volume, 0) / 3
    const prior = candles.slice(-6, -3).reduce((total, candle) => total + candle.volume, 0) / 3
    if (prior > 0) {
      const ratio = recent / prior
      trend = ratio > 1.1 ? 'rising' : ratio < 0.9 ? 'falling' : 'flat'
    }
  }

  return { last, average, relative, trend }
}

/** Rolling volume-weighted average price over the last `window` candles. */
export function vwap(candles: readonly Candle[], window = 50): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(candles.length).fill(null)

  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - window + 1)
    let priceVolume = 0
    let volume = 0
    for (let j = start; j <= i; j++) {
      const candle = candles[j]
      const typical = (candle.high + candle.low + candle.close) / 3
      priceVolume += typical * candle.volume
      volume += candle.volume
    }
    out[i] = volume > 0 ? priceVolume / volume : null
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Support & resistance                                               */
/* ------------------------------------------------------------------ */

function clusterLevels(values: number[], tolerance: number): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const clusters: number[][] = []

  for (const value of sorted) {
    const current = clusters[clusters.length - 1]
    if (current && Math.abs(value - current[current.length - 1]) <= tolerance) {
      current.push(value)
    } else {
      clusters.push([value])
    }
  }

  return clusters.map(
    (cluster) => cluster.reduce((total, value) => total + value, 0) / cluster.length,
  )
}

export type SupportResistance = {
  supports: number[]
  resistances: number[]
}

export type SupportResistanceOptions = {
  left?: number
  right?: number
  tolerancePct?: number
  maxLevels?: number
}

/**
 * Swing-pivot support/resistance. Pivots are clustered by price proximity;
 * supports sit below the last close, resistances above it.
 */
export function findSupportResistance(
  candles: readonly Candle[],
  options: SupportResistanceOptions = {},
): SupportResistance {
  const { left = 2, right = 2, tolerancePct = 0.004, maxLevels = 3 } = options

  if (candles.length < left + right + 3) return { supports: [], resistances: [] }

  const highs: number[] = []
  const lows: number[] = []

  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true
    let isLow = true

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isHigh = false
      if (candles[j].low <= candles[i].low) isLow = false
    }

    if (isHigh) highs.push(candles[i].high)
    if (isLow) lows.push(candles[i].low)
  }

  const close = candles[candles.length - 1].close
  const tolerance = Math.abs(close) * tolerancePct

  const resistances = clusterLevels(highs.filter((value) => value > close), tolerance)
    .sort((a, b) => a - b)
    .slice(0, maxLevels)

  const supports = clusterLevels(lows.filter((value) => value < close), tolerance)
    .sort((a, b) => b - a)
    .slice(0, maxLevels)

  return { supports, resistances }
}

/* ------------------------------------------------------------------ */
/* Candlestick patterns                                               */
/* ------------------------------------------------------------------ */

export type PatternDirection = 'bullish' | 'bearish' | 'neutral'

export type DetectedPattern = {
  name: string
  direction: PatternDirection
  index: number
  time: number
  description: string
}

type CandleShape = {
  body: number
  range: number
  upperShadow: number
  lowerShadow: number
  bullish: boolean
}

function shapeOf(candle: Candle): CandleShape {
  const body = Math.abs(candle.close - candle.open)
  const range = candle.high - candle.low
  return {
    body,
    range,
    upperShadow: candle.high - Math.max(candle.open, candle.close),
    lowerShadow: Math.min(candle.open, candle.close) - candle.low,
    bullish: candle.close >= candle.open,
  }
}

/** Evaluates a single candle (plus its predecessor where relevant). */
export function detectPattern(
  candles: readonly Candle[],
  index: number,
): DetectedPattern | null {
  const candle = candles[index]
  if (!candle) return null

  const current = shapeOf(candle)
  const previous = index > 0 ? candles[index - 1] : null
  const previousShape = previous ? shapeOf(previous) : null

  const make = (name: string, direction: PatternDirection, description: string) => ({
    name,
    direction,
    index,
    time: candle.openTime,
    description,
  })

  if (current.range === 0) return null

  // Doji
  if (current.body <= current.range * 0.1) {
    return make('Doji', 'neutral', 'Open and close are nearly equal — indecision.')
  }

  // Engulfing (needs a prior candle)
  if (previous && previousShape) {
    const engulfing =
      current.body > previousShape.body &&
      Math.max(candle.open, candle.close) >= Math.max(previous.open, previous.close) &&
      Math.min(candle.open, candle.close) <= Math.min(previous.open, previous.close)

    if (engulfing && current.bullish && !previousShape.bullish) {
      return make(
        'Bullish engulfing',
        'bullish',
        'Current body engulfs the prior bearish candle.',
      )
    }
    if (engulfing && !current.bullish && previousShape.bullish) {
      return make(
        'Bearish engulfing',
        'bearish',
        'Current body engulfs the prior bullish candle.',
      )
    }

    const insideBody =
      Math.max(candle.open, candle.close) < Math.max(previous.open, previous.close) &&
      Math.min(candle.open, candle.close) > Math.min(previous.open, previous.close)

    if (insideBody && current.bullish && !previousShape.bullish && previousShape.body > current.body) {
      return make('Bullish harami', 'bullish', 'Small bullish body inside a larger bearish candle.')
    }
    if (insideBody && !current.bullish && previousShape.bullish && previousShape.body > current.body) {
      return make('Bearish harami', 'bearish', 'Small bearish body inside a larger bullish candle.')
    }
  }

  // Hammer / hanging man / inverted hammer / shooting star
  if (current.lowerShadow >= current.body * 2 && current.upperShadow <= current.body * 1.2) {
    return make(
      current.bullish ? 'Hammer' : 'Hanging man',
      current.bullish ? 'bullish' : 'bearish',
      current.bullish
        ? 'Long lower wick shows buyers rejecting lower prices.'
        : 'Long lower wick after an advance can signal selling pressure.',
    )
  }

  if (current.upperShadow >= current.body * 2 && current.lowerShadow <= current.body * 1.2) {
    return make(
      current.bullish ? 'Inverted hammer' : 'Shooting star',
      current.bullish ? 'bullish' : 'bearish',
      current.bullish
        ? 'Long upper wick after a decline can signal buyer interest.'
        : 'Long upper wick shows sellers rejecting higher prices.',
    )
  }

  return null
}

/** Patterns found within the last `lookback` candles, newest first. */
export function detectPatterns(
  candles: readonly Candle[],
  lookback = 5,
): DetectedPattern[] {
  if (candles.length === 0) return []

  const start = Math.max(0, candles.length - Math.max(1, lookback))
  const found: DetectedPattern[] = []

  for (let i = start; i < candles.length; i++) {
    const pattern = detectPattern(candles, i)
    if (pattern) found.push(pattern)
  }

  return found.reverse()
}

/* ------------------------------------------------------------------ */
/* Trend detection                                                    */
/* ------------------------------------------------------------------ */

export type TrendDirection = 'bullish' | 'bearish' | 'neutral'

export type TrendResult = {
  direction: TrendDirection
  /** Net signed weight of the checks that had data. */
  score: number
  /** Number of checks that could be evaluated. */
  maxScore: number
  reasons: string[]
}

export function detectTrend(
  lastClose: number | null,
  indicators: IndicatorSnapshot,
): TrendResult {
  const reasons: string[] = []
  let score = 0
  let maxScore = 0

  const check = (available: boolean, bullish: boolean, up: string, down: string) => {
    if (!available) return
    maxScore += 1
    if (bullish) {
      score += 1
      reasons.push(up)
    } else {
      score -= 1
      reasons.push(down)
    }
  }

  const { ema9, ema21, ema50, ema200, macd: macdPoint, rsi14 } = indicators

  check(
    ema9 !== null && ema21 !== null,
    (ema9 ?? 0) > (ema21 ?? 0),
    'EMA 9 above EMA 21',
    'EMA 9 below EMA 21',
  )
  check(
    ema21 !== null && ema50 !== null,
    (ema21 ?? 0) > (ema50 ?? 0),
    'EMA 21 above EMA 50',
    'EMA 21 below EMA 50',
  )
  check(
    ema200 !== null && lastClose !== null,
    (lastClose ?? 0) > (ema200 ?? 0),
    'Price above EMA 200',
    'Price below EMA 200',
  )
  check(
    macdPoint !== null,
    (macdPoint?.histogram ?? 0) > 0,
    'MACD histogram positive',
    'MACD histogram negative',
  )

  // RSI only votes outside the neutral 45–55 band.
  if (rsi14 !== null) {
    if (rsi14 >= 55) {
      maxScore += 1
      score += 1
      reasons.push('RSI momentum above 55')
    } else if (rsi14 <= 45) {
      maxScore += 1
      score -= 1
      reasons.push('RSI momentum below 45')
    }
  }

  let direction: TrendDirection = 'neutral'
  if (maxScore > 0) {
    const normalized = score / maxScore
    if (normalized >= 0.4) direction = 'bullish'
    else if (normalized <= -0.4) direction = 'bearish'
  }

  return { direction, score, maxScore, reasons }
}

/* ------------------------------------------------------------------ */
/* Full analysis                                                      */
/* ------------------------------------------------------------------ */

export type IndicatorSnapshot = {
  rsi14: MaybeNumber
  macd: { line: number; signal: number; histogram: number } | null
  ema9: MaybeNumber
  ema21: MaybeNumber
  ema50: MaybeNumber
  ema200: MaybeNumber
  bollinger: BollingerPoint | null
  atr14: MaybeNumber
  atrPercent: MaybeNumber
  vwap: MaybeNumber
  volume: VolumeStats | null
}

export type TechnicalAnalysis = {
  candleCount: number
  lastClose: MaybeNumber
  lastCandleTime: MaybeNumber
  indicators: IndicatorSnapshot
  trend: TrendResult
  levels: SupportResistance
  patterns: DetectedPattern[]
  insufficient: string[]
}

function lastOf<T>(values: readonly (T | null)[]): T | null {
  if (values.length === 0) return null
  return values[values.length - 1]
}

export function validateCandles(
  candles: readonly Candle[],
  required: number,
): { ok: boolean; required: number; available: number } {
  const available = candles.filter(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      Number.isFinite(candle.volume) &&
      candle.high >= candle.low,
  ).length

  return { ok: available >= required, required, available }
}

export function computeIndicators(candles: readonly Candle[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close)
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null

  const macd_ = macd(closes)
  const macdLine = lastOf(macd_.macd)
  const macdSignal = lastOf(macd_.signal)
  const macdHistogram = lastOf(macd_.histogram)

  const atr14 = lastOf(atr(candles, 14))

  return {
    rsi14: lastOf(rsi(closes, 14)),
    macd:
      macdLine !== null && macdSignal !== null && macdHistogram !== null
        ? { line: macdLine, signal: macdSignal, histogram: macdHistogram }
        : null,
    ema9: lastOf(ema(closes, 9)),
    ema21: lastOf(ema(closes, 21)),
    ema50: lastOf(ema(closes, 50)),
    ema200: lastOf(ema(closes, 200)),
    bollinger: lastOf(bollinger(closes, 20, 2)),
    atr14,
    atrPercent:
      atr14 !== null && lastClose !== null && lastClose !== 0
        ? (atr14 / lastClose) * 100
        : null,
    vwap: lastOf(vwap(candles, 50)),
    volume: analyzeVolume(candles, 20),
  }
}

/**
 * Runs the full engine. Missing history produces `null` indicator values and
 * an entry in `insufficient` — nothing is fabricated.
 */
export function analyzeCandles(candles: readonly Candle[]): TechnicalAnalysis {
  const valid = candles.filter(
    (candle) =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      candle.high >= candle.low,
  )

  const indicators = computeIndicators(valid)
  const lastCandle = valid.length > 0 ? valid[valid.length - 1] : null
  const lastClose = lastCandle ? lastCandle.close : null

  const requirements: Array<[string, number, number | null]> = [
    ['RSI 14', 15, indicators.rsi14],
    ['MACD', 35, indicators.macd ? indicators.macd.line : null],
    ['EMA 9', 9, indicators.ema9],
    ['EMA 21', 21, indicators.ema21],
    ['EMA 50', 50, indicators.ema50],
    ['EMA 200', 200, indicators.ema200],
    ['Bollinger Bands', 20, indicators.bollinger ? indicators.bollinger.middle : null],
    ['ATR 14', 15, indicators.atr14],
    ['VWAP', 1, indicators.vwap],
    ['Volume average', 20, indicators.volume?.average ?? null],
  ]

  const insufficient = requirements
    .filter(([, , value]) => value === null)
    .map(([name, needed]) => `${name} needs ${needed} candles`)

  return {
    candleCount: valid.length,
    lastClose,
    lastCandleTime: lastCandle ? lastCandle.openTime : null,
    indicators,
    trend: detectTrend(lastClose, indicators),
    levels: findSupportResistance(valid),
    patterns: detectPatterns(valid, 5),
    insufficient,
  }
}

/* ------------------------------------------------------------------ */
/* Multi-timeframe confluence                                         */
/* ------------------------------------------------------------------ */

export type TimeframeTrend = {
  interval: string
  direction: TrendDirection
  score: number
}

export type Confluence = {
  alignment: 'bullish' | 'bearish' | 'mixed'
  note: string
}

export function combineTimeframes(frames: readonly TimeframeTrend[]): Confluence {
  const usable = frames.filter((frame) => frame.direction !== 'neutral')
  if (usable.length === 0) {
    return { alignment: 'mixed', note: 'No timeframe has enough history for a trend.' }
  }

  const bullish = usable.filter((frame) => frame.direction === 'bullish').length
  const bearish = usable.filter((frame) => frame.direction === 'bearish').length

  if (bullish === usable.length) {
    return { alignment: 'bullish', note: 'All timeframes lean bullish.' }
  }
  if (bearish === usable.length) {
    return { alignment: 'bearish', note: 'All timeframes lean bearish.' }
  }
  return {
    alignment: 'mixed',
    note: `Timeframes disagree (${bullish} bullish, ${bearish} bearish).`,
  }
}
