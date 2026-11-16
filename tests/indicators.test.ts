import test from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from '../src/lib/binance.ts'
import {
  analyzeCandles,
  analyzeVolume,
  atr,
  bollinger,
  combineTimeframes,
  detectPattern,
  detectTrend,
  ema,
  findSupportResistance,
  macd,
  rsi,
  sma,
  trueRange,
  validateCandles,
  vwap,
} from '../src/lib/indicators.ts'

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function candle(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1,
): Candle {
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + 59_999,
  }
}

function trendCandles(count: number, start = 100, step = 1): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = start + index * step
    const close = open + step
    return candle(index * 60_000, open, close + 0.5, open - 0.5, close, 10)
  })
}

/* ------------------------------------------------------------------ */
/* Moving averages                                                    */
/* ------------------------------------------------------------------ */

test('sma matches the manual window average', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
})

test('ema seeds with the SMA then applies the multiplier', () => {
  // period 3 → k = 0.5; seed = (1+2+3)/3 = 2, then 4*0.5+2*0.5 = 3, 5*0.5+3*0.5 = 4
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
})

test('ema of a constant series stays constant', () => {
  const result = ema(new Array(20).fill(5), 9)
  assert.equal(result[8], 5)
  assert.equal(result[19], 5)
})

test('moving averages return null while warming up', () => {
  assert.deepEqual(ema([1, 2, 3], 5), [null, null, null])
  assert.deepEqual(sma([1, 2], 3), [null, null])
})

/* ------------------------------------------------------------------ */
/* RSI                                                                */
/* ------------------------------------------------------------------ */

test('rsi follows Wilder smoothing on a hand-checked series', () => {
  // deltas: +1, -1, +1. period 2.
  // index 2: avgGain .5 / avgLoss .5 → 50
  // index 3: avgGain .75 / avgLoss .25 → 75
  assert.deepEqual(rsi([10, 11, 10, 11], 2), [null, null, 50, 75])
})

test('rsi saturates on one-directional series and neutral on flat', () => {
  const rising = rsi(Array.from({ length: 20 }, (_, i) => 100 + i), 14)
  assert.equal(rising.at(-1), 100)

  const falling = rsi(Array.from({ length: 20 }, (_, i) => 100 - i), 14)
  assert.equal(falling.at(-1), 0)

  const flat = rsi(new Array(20).fill(42), 14)
  assert.equal(flat.at(-1), 50)
})

test('rsi is null without enough history', () => {
  const result = rsi([1, 2, 3], 14)
  assert.ok(result.every((value) => value === null))
})

/* ------------------------------------------------------------------ */
/* MACD                                                               */
/* ------------------------------------------------------------------ */

test('macd is zero on a flat market once warmed up', () => {
  const result = macd(new Array(60).fill(5))
  assert.equal(result.macd.at(-1), 0)
  assert.equal(result.signal.at(-1), 0)
  assert.equal(result.histogram.at(-1), 0)
})

test('macd line equals fast EMA minus slow EMA', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const result = macd(closes)
  const index = closes.length - 1
  assert.ok(Math.abs((result.macd[index] as number) - ((fast[index] as number) - (slow[index] as number))) < 1e-9)
  assert.ok(result.histogram[index] !== null)
})

/* ------------------------------------------------------------------ */
/* Bollinger + ATR                                                    */
/* ------------------------------------------------------------------ */

test('bollinger collapses to the mean on a flat series', () => {
  const point = bollinger(new Array(25).fill(10)).at(-1)
  assert.ok(point)
  assert.equal(point?.middle, 10)
  assert.equal(point?.upper, 10)
  assert.equal(point?.lower, 10)
  assert.equal(point?.bandwidth, 0)
  assert.equal(point?.percentB, 50)
})

test('trueRange and atr match a hand-checked series', () => {
  const candles = [
    candle(0, 9, 10, 8, 9),
    candle(60_000, 10, 12, 10, 11),
    candle(120_000, 11, 13, 11, 12),
  ]
  assert.deepEqual(trueRange(candles), [2, 3, 2])
  // period 2: seed (2+3)/2 = 2.5, then (2.5*1 + 2)/2 = 2.25
  assert.deepEqual(atr(candles, 2), [null, 2.5, 2.25])
})

/* ------------------------------------------------------------------ */
/* VWAP + volume                                                      */
/* ------------------------------------------------------------------ */

test('vwap weights typical price by volume', () => {
  const candles = [
    candle(0, 3, 3, 3, 3, 1),
    candle(60_000, 6, 6, 6, 6, 2),
  ]
  // (3*1 + 6*2) / 3 = 5
  assert.deepEqual(vwap(candles, 2), [3, 5])
})

test('volume analysis reports relative volume and trend', () => {
  const candles = Array.from({ length: 10 }, (_, index) =>
    candle(index * 60_000, 100, 101, 99, 100, index < 7 ? 10 : 20),
  )
  const stats = analyzeVolume(candles, 3)
  assert.ok(stats)
  assert.equal(stats?.last, 20)
  assert.equal(stats?.average, 20)
  assert.equal(stats?.relative, 1)
  assert.equal(stats?.trend, 'rising')
})

test('volume analysis returns null without candles', () => {
  assert.equal(analyzeVolume([]), null)
})

/* ------------------------------------------------------------------ */
/* Support / resistance                                               */
/* ------------------------------------------------------------------ */

test('support/resistance clusters swing pivots around price', () => {
  const closes = [100, 102, 105, 103, 101, 99, 97, 99, 101, 103, 105, 104, 102]
  const candles = closes.map((close, index) => {
    const high = close + 1
    const low = close - 1
    return candle(index * 60_000, close, Math.max(high, close), Math.min(low, close), close, 10)
  })

  const levels = findSupportResistance(candles, { left: 1, right: 1 })
  const lastClose = closes[closes.length - 1]

  for (const level of levels.supports) assert.ok(level < lastClose)
  for (const level of levels.resistances) assert.ok(level > lastClose)
  assert.ok(levels.supports.length > 0)
  assert.ok(levels.resistances.length > 0)
})

test('support/resistance returns empty without enough history', () => {
  assert.deepEqual(findSupportResistance([]), { supports: [], resistances: [] })
})

/* ------------------------------------------------------------------ */
/* Patterns                                                           */
/* ------------------------------------------------------------------ */

test('detects a bullish engulfing candle', () => {
  const candles = [
    candle(0, 105, 106, 99, 100, 10), // bearish
    candle(60_000, 99, 108, 98, 107, 15), // bullish engulfing
  ]
  const pattern = detectPattern(candles, 1)
  assert.equal(pattern?.name, 'Bullish engulfing')
  assert.equal(pattern?.direction, 'bullish')
})

test('detects a doji', () => {
  const candles = [candle(0, 100, 105, 95, 100.2, 10)]
  assert.equal(detectPattern(candles, 0)?.name, 'Doji')
})

test('detects a hammer with a long lower wick', () => {
  const candles = [candle(0, 98, 100, 90, 99.5, 10)]
  assert.equal(detectPattern(candles, 0)?.name, 'Hammer')
})

test('ordinary candles produce no pattern', () => {
  const candles = [
    candle(0, 100, 101, 99, 100.5, 10),
    candle(60_000, 100.5, 103, 100, 102.5, 10),
  ]
  assert.equal(detectPattern(candles, 1), null)
})

/* ------------------------------------------------------------------ */
/* Trend + validation                                                 */
/* ------------------------------------------------------------------ */

test('trend is bullish on a stacked up-trend and bearish on a downtrend', () => {
  const up = analyzeCandles(trendCandles(260, 100, 1))
  assert.equal(up.trend.direction, 'bullish')
  assert.ok(up.trend.maxScore >= 4)

  const down = analyzeCandles(trendCandles(260, 400, -1))
  assert.equal(down.trend.direction, 'bearish')
})

test('analyzeCandles never fabricates values on empty input', () => {
  const analysis = analyzeCandles([])
  assert.equal(analysis.candleCount, 0)
  assert.equal(analysis.lastClose, null)
  assert.equal(analysis.indicators.rsi14, null)
  assert.equal(analysis.indicators.ema200, null)
  assert.equal(analysis.indicators.bollinger, null)
  assert.equal(analysis.indicators.atr14, null)
  assert.equal(analysis.indicators.vwap, null)
  assert.equal(analysis.trend.direction, 'neutral')
  assert.equal(analysis.trend.maxScore, 0)
  assert.deepEqual(analysis.levels, { supports: [], resistances: [] })
  assert.deepEqual(analysis.patterns, [])
  assert.ok(analysis.insufficient.length >= 10)
})

test('insufficient history is reported per indicator', () => {
  const analysis = analyzeCandles(trendCandles(30))
  assert.equal(analysis.indicators.ema200, null)
  assert.ok(analysis.insufficient.some((item) => item.startsWith('EMA 200')))
  assert.ok(analysis.indicators.rsi14 !== null)
})

test('validateCandles checks availability and rejects malformed highs/lows', () => {
  assert.deepEqual(validateCandles(trendCandles(50), 30), {
    ok: true,
    required: 30,
    available: 50,
  })

  const broken: Candle[] = [candle(0, 100, 101, 99, 100), candle(60_000, 100, 90, 110, 100)]
  assert.equal(validateCandles(broken, 2).ok, false)
})

test('combineTimeframes reports alignment', () => {
  const bullish = combineTimeframes([
    { interval: '15m', direction: 'bullish', score: 3 },
    { interval: '1h', direction: 'bullish', score: 2 },
  ])
  assert.equal(bullish.alignment, 'bullish')

  const mixed = combineTimeframes([
    { interval: '15m', direction: 'bullish', score: 3 },
    { interval: '1h', direction: 'bearish', score: -2 },
  ])
  assert.equal(mixed.alignment, 'mixed')

  const none = combineTimeframes([{ interval: '1h', direction: 'neutral', score: 0 }])
  assert.equal(none.alignment, 'mixed')
})

test('detectTrend with no indicators is neutral and unscored', () => {
  const trend = detectTrend(null, {
    rsi14: null,
    macd: null,
    ema9: null,
    ema21: null,
    ema50: null,
    ema200: null,
    bollinger: null,
    atr14: null,
    atrPercent: null,
    vwap: null,
    volume: null,
  })
  assert.equal(trend.direction, 'neutral')
  assert.equal(trend.maxScore, 0)
  assert.deepEqual(trend.reasons, [])
})
