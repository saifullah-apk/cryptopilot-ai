/**
 * AI Coach contract shared by the client and the backend server.
 *
 * Validation lives here so both sides enforce the same rules:
 * no invented data, no profit promises, always an uncertainty note.
 */

import type { TechnicalAnalysis } from './indicators.ts'

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const COACH_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const
export type CoachSymbol = (typeof COACH_SYMBOLS)[number]

export const COACH_INTERVALS = ['15m', '1h'] as const
export type CoachInterval = (typeof COACH_INTERVALS)[number]

export const MAX_QUESTION_LENGTH = 1500
export const MAX_HISTORY_TURNS = 10
export const MAX_LIST_ITEMS = 6

export type ChatRole = 'user' | 'assistant'
export type ChatTurn = { role: ChatRole; text: string }

/** Optional read-only portfolio snapshot. Null in this phase — no account is connected. */
export type PortfolioSnapshot = {
  connected: boolean
  totalValue?: number | null
  positions?: { symbol: string; quantity: number; entryPrice?: number | null }[]
}
export type CoachPortfolio = PortfolioSnapshot | null

export type CoachRequest = {
  question: string
  symbol: CoachSymbol
  interval: CoachInterval
  history: ChatTurn[]
  portfolio: CoachPortfolio
}

/* ------------------------------------------------------------------ */
/* Structured reply                                                   */
/* ------------------------------------------------------------------ */

export type CoachSignal = 'bullish' | 'bearish' | 'neutral'
export type CoachCondition = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type CoachIndicator = {
  name: string
  explanation: string
  signal: CoachSignal
}

export type CoachReply = {
  summary: string
  marketCondition: CoachCondition
  analysis: string
  indicators: CoachIndicator[]
  opportunities: string[]
  risks: string[]
  avoidTrading: string[]
  confidenceNote: string
}

export type CoachContextSummary = {
  symbol: CoachSymbol
  interval: CoachInterval
  lastPrice: number | null
  change24h: number | null
  candleCount: number
  trend: 'bullish' | 'bearish' | 'neutral'
  trendScore: number
  trendMax: number
  fetchedAt: number
}

export type CoachProvider = 'gemini' | 'rule-based'

export type CoachResponse = {
  ok: true
  provider: CoachProvider
  model: string | null
  reply: CoachReply
  error: string | null
  context: CoachContextSummary
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const CONDITION_VALUES: CoachCondition[] = ['bullish', 'bearish', 'neutral', 'mixed']
const SIGNAL_VALUES: CoachSignal[] = ['bullish', 'bearish', 'neutral']

/** Language that would read as a promise of profit — rejected outright. */
const PROMISE_PATTERNS = [
  /guaranteed\s+(profit|returns?|gains?|wins?)/i,
  /(profits?|returns?|gains?|wins?)\s+(is|are)\s+(guaranteed|assured|certain)/i,
  /guarantee\s+(me\s+)?(profit|returns?|gains?|wins?)/i,
  /\bguaranteed\s+(win|winner)\b/i,
  /\brisk[\s-]?free\b/i,
  /cannot lose/i,
  /100\s*%\s*(win|profit|guarantee|accurate)/i,
  /sure\s+(profit|win|gain)/i,
  /certain\s+profit/i,
  /you\s+will\s+(make|earn)\s+(money|profit|returns?)/i,
  /you\s+will\s+win\b/i,
  /will\s+definitely\s+(profit|win|gain)/i,
]

export function findPromiseLanguage(text: string): string | null {
  // Strip explicitly negated claims ("no guaranteed returns", "not risk-free")
  // so uncertainty wording is never mistaken for a promise.
  const scrubbed = text.replace(
    /\b(?:no|not|never|without|cannot|can't|isn't|aren't|doesn't|don't|won't)\s+(?:a\s+|any\s+)?(?:guarantee|guaranteed|assurance|assured|risk[\s-]?free)\b/gi,
    ' ',
  )

  for (const pattern of PROMISE_PATTERNS) {
    if (pattern.test(scrubbed)) return pattern.source
  }
  return null
}

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

function asStringList(
  value: unknown,
  maxLength: number,
  requireAtLeast = 0,
): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length < requireAtLeast || value.length > MAX_LIST_ITEMS) return null

  const items: string[] = []
  for (const entry of value) {
    const text = asString(entry, maxLength)
    if (text === null) return null
    items.push(text)
  }
  return items
}

/**
 * Structural + safety validation of a model reply. Rejects malformed shapes,
 * overlong text and any phrasing that could be read as a profit promise.
 */
export function validateCoachReply(value: unknown): ValidationResult<CoachReply> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Reply must be an object.' }
  }

  const raw = value as Record<string, unknown>

  const summary = asString(raw.summary, 1000)
  if (summary === null) return { ok: false, error: 'Missing or invalid "summary".' }

  const marketCondition = raw.marketCondition
  if (typeof marketCondition !== 'string' || !CONDITION_VALUES.includes(marketCondition as CoachCondition)) {
    return { ok: false, error: 'Invalid "marketCondition".' }
  }

  const analysis = asString(raw.analysis, 2500)
  if (analysis === null) return { ok: false, error: 'Missing or invalid "analysis".' }

  const confidenceNote = asString(raw.confidenceNote, 900)
  if (confidenceNote === null) {
    return { ok: false, error: 'Missing or invalid "confidenceNote".' }
  }

  if (!Array.isArray(raw.indicators) || raw.indicators.length === 0) {
    return { ok: false, error: 'Reply must include at least one indicator explanation.' }
  }

  const indicators: CoachIndicator[] = []
  for (const entry of raw.indicators) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Invalid indicator entry.' }
    }
    const item = entry as Record<string, unknown>
    const name = asString(item.name, 120)
    const explanation = asString(item.explanation, 900)
    if (name === null || explanation === null) {
      return { ok: false, error: 'Indicator entries need "name" and "explanation".' }
    }
    if (typeof item.signal !== 'string' || !SIGNAL_VALUES.includes(item.signal as CoachSignal)) {
      return { ok: false, error: 'Indicator "signal" must be bullish, bearish or neutral.' }
    }
    indicators.push({ name, explanation, signal: item.signal as CoachSignal })
  }

  const opportunities = asStringList(raw.opportunities, 600, 1)
  if (opportunities === null) {
    return { ok: false, error: '"opportunities" must be a list of 1-6 strings.' }
  }

  const risks = asStringList(raw.risks, 600, 1)
  if (risks === null) {
    return { ok: false, error: '"risks" must be a list of 1-6 strings.' }
  }

  const avoidTrading = asStringList(raw.avoidTrading, 600, 1)
  if (avoidTrading === null) {
    return { ok: false, error: '"avoidTrading" must be a list of 1-6 strings.' }
  }

  const reply: CoachReply = {
    summary,
    marketCondition: marketCondition as CoachCondition,
    analysis,
    indicators,
    opportunities,
    risks,
    avoidTrading,
    confidenceNote,
  }

  const haystack = [
    summary,
    analysis,
    confidenceNote,
    ...indicators.flatMap((item) => [item.name, item.explanation]),
    ...opportunities,
    ...risks,
    ...avoidTrading,
  ].join(' \n ')

  const promise = findPromiseLanguage(haystack)
  if (promise) {
    return { ok: false, error: 'Reply contains promise language: ' + promise }
  }

  return { ok: true, value: reply }
}

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

function sanitizePortfolio(value: unknown): ValidationResult<CoachPortfolio> {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Portfolio must be an object or null.' }
  }

  const raw = value as Record<string, unknown>
  if (raw.connected !== true) return { ok: true, value: { connected: false } }

  let totalValue: number | null = null
  if (raw.totalValue !== undefined && raw.totalValue !== null) {
    if (typeof raw.totalValue !== 'number' || !Number.isFinite(raw.totalValue) || raw.totalValue < 0) {
      return { ok: false, error: 'Portfolio totalValue must be a positive number or null.' }
    }
    totalValue = raw.totalValue
  }

  const positions: NonNullable<PortfolioSnapshot['positions']> = []
  if (raw.positions !== undefined) {
    if (!Array.isArray(raw.positions) || raw.positions.length > 20) {
      return { ok: false, error: 'Portfolio positions must be an array of at most 20 entries.' }
    }
    for (const entry of raw.positions) {
      if (!entry || typeof entry !== 'object') {
        return { ok: false, error: 'Portfolio position entries must be objects.' }
      }
      const position = entry as Record<string, unknown>
      const symbol = asString(position.symbol, 20)
      if (symbol === null) {
        return { ok: false, error: 'Portfolio positions need a symbol.' }
      }
      if (
        typeof position.quantity !== 'number' ||
        !Number.isFinite(position.quantity) ||
        position.quantity < 0
      ) {
        return { ok: false, error: 'Portfolio position quantity must be a positive number.' }
      }
      let entryPrice: number | null = null
      if (position.entryPrice !== undefined && position.entryPrice !== null) {
        if (
          typeof position.entryPrice !== 'number' ||
          !Number.isFinite(position.entryPrice) ||
          position.entryPrice <= 0
        ) {
          return { ok: false, error: 'Portfolio entryPrice must be a positive number or null.' }
        }
        entryPrice = position.entryPrice
      }
      positions.push({ symbol, quantity: position.quantity, entryPrice })
    }
  }

  return { ok: true, value: { connected: true, totalValue, positions } }
}

export function validateCoachRequest(value: unknown): ValidationResult<CoachRequest> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Request body must be an object.' }
  }

  const raw = value as Record<string, unknown>

  const question = asString(raw.question, MAX_QUESTION_LENGTH)
  if (question === null) {
    return { ok: false, error: `Question must be 1-${MAX_QUESTION_LENGTH} characters.` }
  }

  const symbol = raw.symbol ?? 'BTCUSDT'
  if (typeof symbol !== 'string' || !COACH_SYMBOLS.includes(symbol as CoachSymbol)) {
    return { ok: false, error: `Symbol must be one of ${COACH_SYMBOLS.join(', ')}.` }
  }

  const interval = raw.interval ?? '15m'
  if (typeof interval !== 'string' || !COACH_INTERVALS.includes(interval as CoachInterval)) {
    return { ok: false, error: `Interval must be one of ${COACH_INTERVALS.join(', ')}.` }
  }

  const history: ChatTurn[] = []
  const rawHistory = raw.history ?? []
  if (!Array.isArray(rawHistory)) {
    return { ok: false, error: 'History must be an array.' }
  }
  for (const entry of rawHistory.slice(-MAX_HISTORY_TURNS)) {
    if (!entry || typeof entry !== 'object') continue
    const turn = entry as Record<string, unknown>
    const role = turn.role === 'assistant' ? 'assistant' : 'user'
    const text = asString(turn.text, 2000)
    if (text === null) continue
    history.push({ role, text })
  }

  const portfolioResult = sanitizePortfolio(raw.portfolio)
  if (!portfolioResult.ok) {
    return { ok: false, error: portfolioResult.error }
  }

  return {
    ok: true,
    value: {
      question,
      symbol: symbol as CoachSymbol,
      interval: interval as CoachInterval,
      history,
      portfolio: portfolioResult.value,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Rule-based fallback                                                 */
/* ------------------------------------------------------------------ */

type RuleBasedInput = {
  context: CoachContextSummary
  analysis: TechnicalAnalysis
}

function pct(value: number | null, digits = 2): string {
  return value === null ? 'n/a' : value.toFixed(digits)
}

function price(value: number | null): string {
  if (value === null) return 'n/a'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Deterministic explanation built only from verified indicator values.
 * Used whenever Gemini is unavailable — never invents a number.
 */
export function buildRuleBasedExplanation(input: RuleBasedInput): CoachReply {
  const { context, analysis } = input
  const { indicators, trend } = analysis

  const marketCondition: CoachCondition =
    trend.direction === 'bullish' || trend.direction === 'bearish'
      ? trend.direction
      : 'neutral'

  const analysisParts: string[] = []
  analysisParts.push(
    `Last close on ${context.symbol} ${context.interval} is ${price(analysis.lastClose)}.`,
  )
  analysisParts.push(
    `Trend is ${trend.direction} (net score ${trend.score} across ${trend.maxScore} weighted checks).`,
  )
  if (indicators.rsi14 !== null) {
    analysisParts.push(`RSI 14 reads ${pct(indicators.rsi14, 1)}.`)
  }
  if (indicators.macd) {
    analysisParts.push(
      `MACD histogram is ${pct(indicators.macd.histogram, 2)} (line ${pct(indicators.macd.line, 2)}, signal ${pct(indicators.macd.signal, 2)}).`,
    )
  }
  if (analysis.lastClose !== null && indicators.ema200 !== null) {
    analysisParts.push(
      analysis.lastClose > indicators.ema200
        ? 'Price is above the EMA 200, which traders often read as a longer-term uptrend context.'
        : 'Price is below the EMA 200, which traders often read as a longer-term downtrend context.',
    )
  }
  if (context.change24h !== null) {
    analysisParts.push(`24h change is ${pct(context.change24h)}%.`)
  }
  if (analysis.patterns.length > 0) {
    const seen = new Set<string>()
    const recent = analysis.patterns
      .filter((pattern) => {
        if (seen.has(pattern.name)) return false
        seen.add(pattern.name)
        return true
      })
      .slice(0, 2)
    analysisParts.push(
      `Recent candlestick pattern${recent.length > 1 ? 's' : ''}: ${recent
        .map((pattern) => `${pattern.name} (${pattern.direction}) — ${pattern.description}`)
        .join(' ')}`,
    )
  }
  if (analysis.levels.supports.length > 0) {
    analysisParts.push(
      `Nearest verified support is ${price(analysis.levels.supports[0])}.`,
    )
  }
  if (analysis.levels.resistances.length > 0) {
    analysisParts.push(
      `Nearest verified resistance is ${price(analysis.levels.resistances[0])}.`,
    )
  }
  analysisParts.push(`Context was built from ${context.candleCount} verified candles.`)

  const indicatorList: CoachIndicator[] = []

  if (indicators.rsi14 !== null) {
    const rsi = indicators.rsi14
    indicatorList.push({
      name: 'RSI 14',
      explanation:
        rsi >= 70
          ? `RSI is ${pct(rsi, 1)}, which sits in the conventional overbought band (70+). It means recent gains outpaced recent losses; it is a caution flag, not a sell signal.`
          : rsi <= 30
            ? `RSI is ${pct(rsi, 1)}, which sits in the conventional oversold band (30-). It means recent losses outpaced recent gains; it is a caution flag, not a buy signal.`
            : `RSI is ${pct(rsi, 1)}, inside the neutral 30-70 band. Momentum is balanced rather than stretched.`,
      signal: rsi >= 55 ? 'bullish' : rsi <= 45 ? 'bearish' : 'neutral',
    })
  }

  if (indicators.macd) {
    const hist = indicators.macd.histogram
    indicatorList.push({
      name: 'MACD (12, 26, 9)',
      explanation:
        hist > 0
          ? `MACD histogram is positive (${pct(hist, 2)}), so the fast EMA is above the slow EMA and short-term momentum currently favours buyers.`
          : hist < 0
            ? `MACD histogram is negative (${pct(hist, 2)}), so the fast EMA is below the slow EMA and short-term momentum currently favours sellers.`
            : 'MACD histogram is flat, so the fast and slow EMA agree and momentum is indecisive.',
      signal: hist > 0 ? 'bullish' : hist < 0 ? 'bearish' : 'neutral',
    })
  }

  const stack = [indicators.ema9, indicators.ema21, indicators.ema50]
  if (stack.every((value) => value !== null)) {
    const ordered =
      indicators.ema9! > indicators.ema21! && indicators.ema21! > indicators.ema50!
    indicatorList.push({
      name: 'EMA 9 / 21 / 50',
      explanation: ordered
        ? 'The short EMAs are stacked above the longer ones (9 > 21 > 50), which is the classic bullish alignment.'
        : 'The EMAs are not stacked in order (9 > 21 > 50), so the short-term structure is mixed rather than trending.',
      signal: ordered ? 'bullish' : 'neutral',
    })
  }

  if (indicators.bollinger) {
    const bb = indicators.bollinger
    indicatorList.push({
      name: 'Bollinger Bands (20, 2)',
      explanation: `Bands are centred on ${price(bb.middle)} with a bandwidth of ${pct(bb.bandwidth)}%. %B is ${pct(bb.percentB, 0)}, showing where price sits inside the bands. Wide bands mean higher recent volatility.`,
      signal: 'neutral',
    })
  }

  if (indicators.atrPercent !== null) {
    indicatorList.push({
      name: 'ATR 14',
      explanation: `Average True Range is ${pct(indicators.atrPercent)}% of price per candle, a measure of how much the market typically moves within one candle on this timeframe.`,
      signal: 'neutral',
    })
  }

  if (indicators.vwap !== null) {
    indicatorList.push({
      name: 'VWAP (50)',
      explanation:
        analysis.lastClose !== null && analysis.lastClose > indicators.vwap
          ? `Price (${price(analysis.lastClose)}) is above VWAP (${price(indicators.vwap)}), meaning recent trades happened on average above the volume-weighted price.`
          : `Price (${price(analysis.lastClose)}) is below VWAP (${price(indicators.vwap)}), meaning recent trades happened on average below the volume-weighted price.`,
      signal:
        analysis.lastClose !== null && indicators.vwap !== null && analysis.lastClose > indicators.vwap
          ? 'bullish'
          : 'bearish',
    })
  }

  if (indicators.volume) {
    const volume = indicators.volume
    indicatorList.push({
      name: 'Volume (20)',
      explanation:
        volume.relative !== null
          ? `Latest candle volume is ${pct(volume.relative)}× the 20-candle average (${volume.average === null ? 'n/a' : volume.average.toFixed(2)}), and volume is ${volume.trend ?? 'flat'}. Volume confirms or weakens a move.`
          : 'Volume has no 20-candle average yet on this data, so volume context is limited.',
      signal: 'neutral',
    })
  }

  if (indicatorList.length === 0) {
    indicatorList.push({
      name: 'Indicator data',
      explanation:
        'No indicator values are available because there are not enough verified candles on this timeframe. Nothing is estimated.',
      signal: 'neutral',
    })
  }

  const opportunities: string[] = []
  if (trend.direction === 'bullish') {
    opportunities.push(
      'Momentum reads bullish on this timeframe; a trader studying this could watch for a pullback to support before considering an entry.',
    )
    if (indicators.macd && indicators.macd.histogram > 0) {
      opportunities.push(
        'The positive MACD histogram means short-term momentum currently favours buyers, so breakouts have more follow-through historically.',
      )
    }
  } else if (trend.direction === 'bearish') {
    opportunities.push(
      'Momentum reads bearish on this timeframe; the interest is in failed rallies or retests of resistance rather than chasing weakness.',
    )
  } else {
    opportunities.push(
      'Momentum is neutral, so the opportunity is mainly to wait and let a range resolve rather than act on a coin-flip setup.',
    )
  }

  const risks: string[] = [
    `These indicators describe the last ${context.candleCount} candles only. They cannot predict the next candle and have no win rate attached.`,
  ]
  if (indicators.atrPercent !== null) {
    risks.push(
      `ATR is ${pct(indicators.atrPercent)}% of price per candle, so a normal candle on this timeframe can move well beyond a naive stop-loss.`,
    )
  }
  if (indicators.rsi14 !== null && indicators.rsi14 >= 70) {
    risks.push('RSI is overbought, which historically precedes pullbacks more often than it precedes further upside.')
  }
  if (indicators.rsi14 !== null && indicators.rsi14 <= 30) {
    risks.push('RSI is oversold, but oversold can stay oversold in a downtrend — a falling knife can keep falling.')
  }
  if (trend.maxScore < 5) {
    risks.push(
      `Only ${trend.maxScore} trend checks could be evaluated, so the trend read is based on incomplete information.`,
    )
  }
  if (context.change24h !== null && Math.abs(context.change24h) > 5) {
    risks.push(
      `The 24h move of ${pct(context.change24h)}% is large, which raises slippage and volatility risk for any position.`,
    )
  }

  const avoidTrading: string[] = []
  if (trend.direction === 'neutral') {
    avoidTrading.push('The trend is neutral, so a trade here has no directional edge from this timeframe alone.')
  }
  if (trend.maxScore === 0) {
    avoidTrading.push('No trend checks could be evaluated, so there is nothing verified to base a decision on.')
  }
  if (analysis.insufficient.length > 0) {
    avoidTrading.push(
      `Some indicators are unavailable (${analysis.insufficient.slice(0, 3).join('; ')}), so the picture is incomplete.`,
    )
  }
  if (indicators.atrPercent !== null && indicators.atrPercent > 1) {
    avoidTrading.push(
      `ATR of ${pct(indicators.atrPercent)}% per candle means volatility is high enough that position sizing and a stop are essential before any entry.`,
    )
  }
  if (avoidTrading.length === 0) {
    avoidTrading.push(
      'Nothing here confirms an entry: the data is descriptive, no position size or stop level is defined, and risk is unmanaged.',
    )
  }

  return {
    summary: `Rule-based fallback for ${context.symbol} ${context.interval}: trend is ${trend.direction} (net score ${trend.score}/${trend.maxScore}), last close ${price(analysis.lastClose)}.`,
    marketCondition,
    analysis: analysisParts.join(' '),
    indicators: indicatorList,
    opportunities,
    risks: risks.slice(0, MAX_LIST_ITEMS),
    avoidTrading: avoidTrading.slice(0, MAX_LIST_ITEMS),
    confidenceNote:
      'This explanation comes from a deterministic rule engine, not Gemini. It is generated only from the verified candles and indicators listed above. Indicator readings are not a forecast, they carry no win probability, and no outcome is guaranteed.',
  }
}

/* ------------------------------------------------------------------ */
/* Suggested questions                                                 */
/* ------------------------------------------------------------------ */

export const SUGGESTED_QUESTIONS: string[] = [
  'Explain what RSI 14 and MACD are showing right now',
  'Why is the trend neutral on one timeframe and bullish on another?',
  'What are the main risks of entering a trade here?',
  'What reasons are there to avoid trading this market?',
  'Explain the candlestick pattern that was just detected',
  'How should I read the support and resistance levels?',
]

/* ------------------------------------------------------------------ */
/* Client transport                                                    */
/* ------------------------------------------------------------------ */

/** Posts a question to the backend. Throws with a readable message on failure. */
export async function postCoach(
  request: CoachRequest,
  signal?: AbortSignal,
): Promise<CoachResponse> {
  const response = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  const parsed = payload as Partial<CoachResponse> & { error?: string } | null

  if (!response.ok) {
    throw new Error(parsed?.error ?? `Coach request failed (${response.status}).`)
  }

  if (!parsed || parsed.ok !== true || typeof parsed.reply !== 'object') {
    throw new Error('Coach response was malformed.')
  }

  // Re-validate on the client too: a proxy or stale server must not be able
  // to inject a malformed or promise-style answer into the UI.
  const validated = validateCoachReply(parsed.reply)
  if (!validated.ok) {
    throw new Error(`Coach response failed validation: ${validated.error}`)
  }

  return { ...(parsed as CoachResponse), reply: validated.value }
}
