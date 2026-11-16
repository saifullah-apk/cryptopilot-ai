import test from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from '../src/lib/binance.ts'
import { analyzeCandles } from '../src/lib/indicators.ts'
import {
  buildRuleBasedExplanation,
  findPromiseLanguage,
  postCoach,
  validateCoachReply,
  validateCoachRequest,
  type CoachReply,
  type CoachRequest,
} from '../src/lib/coach.ts'
import { historyFromMessages, type StoredMessage } from '../src/lib/coachHistory.ts'
import {
  callGemini,
  extractGeminiText,
  generateCoachReply,
  GeminiError,
  type VerifiedContext,
} from '../server/coachService.ts'

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function candle(index: number, close: number): Candle {
  const open = close - 0.5
  return {
    openTime: index * 60_000,
    open,
    high: close + 0.8,
    low: open - 0.8,
    close,
    volume: 10 + (index % 5),
    closeTime: index * 60_000 + 59_999,
  }
}

function trendCandles(count: number, start = 100, step = 1): Candle[] {
  return Array.from({ length: count }, (_, index) => candle(index, start + index * step))
}

const validReply: CoachReply = {
  summary: 'Trend is bullish on the verified candles.',
  marketCondition: 'bullish',
  analysis: 'Price is above the EMA 200 and the MACD histogram is positive.',
  indicators: [
    { name: 'RSI 14', explanation: 'RSI is in the neutral band.', signal: 'neutral' },
  ],
  opportunities: ['A pullback toward support could be studied.'],
  risks: ['Momentum can reverse without notice.'],
  avoidTrading: ['No position size or stop has been defined.'],
  confidenceNote: 'Indicators are descriptive and carry no win probability.',
}

function contextFixture(): VerifiedContext {
  const analysis = analyzeCandles(trendCandles(260, 100, 1))
  return {
    symbol: 'BTCUSDT',
    interval: '15m',
    analysis,
    ticker: {
      symbol: 'BTCUSDT',
      lastPrice: analysis.lastClose ?? 0,
      openPrice: 100,
      highPrice: 400,
      lowPrice: 90,
      volume: 1234,
      priceChangePercent: 1.5,
      closeTime: Date.now(),
    },
    fetchedAt: Date.now(),
  }
}

function requestFixture(overrides: Partial<CoachRequest> = {}): CoachRequest {
  return {
    question: 'What is the trend?',
    symbol: 'BTCUSDT',
    interval: '15m',
    history: [],
    portfolio: null,
    ...overrides,
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function geminiBody(reply: unknown): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(reply) }],
        },
      },
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Request validation                                                 */
/* ------------------------------------------------------------------ */

test('validateCoachRequest accepts a minimal request and applies defaults', () => {
  const result = validateCoachRequest({ question: '  Explain RSI  ' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.question, 'Explain RSI')
  assert.equal(result.value.symbol, 'BTCUSDT')
  assert.equal(result.value.interval, '15m')
  assert.equal(result.value.portfolio, null)
})

test('validateCoachRequest normalizes history and caps its length', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `turn ${index}`,
  }))
  const result = validateCoachRequest({ question: 'Hi', symbol: 'ETHUSDT', interval: '1h', history })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.history.length, 10)
  assert.equal(result.value.history.at(-1)?.text, 'turn 19')
})

test('validateCoachRequest rejects bad shapes and values', () => {
  assert.equal(validateCoachRequest(null).ok, false)
  assert.equal(validateCoachRequest({ question: '   ' }).ok, false)
  assert.equal(validateCoachRequest({ question: 'x'.repeat(1501) }).ok, false)
  assert.equal(validateCoachRequest({ question: 'Hi', symbol: 'DOGEUSDT' }).ok, false)
  assert.equal(validateCoachRequest({ question: 'Hi', interval: '4h' }).ok, false)
  assert.equal(validateCoachRequest({ question: 'Hi', history: 'nope' }).ok, false)
  assert.equal(validateCoachRequest({ question: 'Hi', portfolio: { connected: true } }).ok, true)
})

test('validateCoachRequest sanitizes a connected portfolio without inventing fields', () => {
  const result = validateCoachRequest({
    question: 'How is my portfolio exposed?',
    portfolio: {
      connected: true,
      totalValue: 1250.5,
      positions: [
        { symbol: 'BTCUSDT', quantity: 0.01, entryPrice: 60000 },
        { symbol: 'SOLUSDT', quantity: 4 },
      ],
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.portfolio?.connected, true)
  assert.equal(result.value.portfolio?.totalValue, 1250.5)
  assert.equal(result.value.portfolio?.positions?.length, 2)
  assert.equal(result.value.portfolio?.positions?.[0].entryPrice, 60000)
  assert.equal(result.value.portfolio?.positions?.[1].entryPrice, null)
})

test('validateCoachRequest rejects malformed portfolio values', () => {
  assert.equal(
    validateCoachRequest({ question: 'Hi', portfolio: { connected: true, totalValue: -5 } }).ok,
    false,
  )
  assert.equal(
    validateCoachRequest({
      question: 'Hi',
      portfolio: { connected: true, positions: [{ symbol: 'BTCUSDT', quantity: 'lots' }] },
    }).ok,
    false,
  )
  assert.equal(
    validateCoachRequest({
      question: 'Hi',
      portfolio: { connected: true, positions: [{ symbol: 'BTCUSDT', quantity: 1, entryPrice: 0 }] },
    }).ok,
    false,
  )
  assert.equal(
    validateCoachRequest({
      question: 'Hi',
      portfolio: { connected: true, positions: new Array(21).fill({ symbol: 'BTCUSDT', quantity: 1 }) },
    }).ok,
    false,
  )
})

/* ------------------------------------------------------------------ */
/* Reply validation + safety                                          */
/* ------------------------------------------------------------------ */

test('validateCoachReply accepts a complete structured reply', () => {
  const result = validateCoachReply(validReply)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.marketCondition, 'bullish')
  assert.equal(result.value.indicators.length, 1)
})

test('validateCoachReply rejects missing fields and empty lists', () => {
  assert.equal(validateCoachReply(null).ok, false)
  assert.equal(validateCoachReply({ ...validReply, summary: '' }).ok, false)
  assert.equal(
    validateCoachReply({ ...validReply, marketCondition: 'sideways' }).ok,
    false,
  )
  assert.equal(validateCoachReply({ ...validReply, indicators: [] }).ok, false)
  assert.equal(
    validateCoachReply({
      ...validReply,
      indicators: [{ name: 'RSI', explanation: 'x', signal: 'up' }],
    }).ok,
    false,
  )
  assert.equal(validateCoachReply({ ...validReply, risks: [] }).ok, false)
  assert.equal(
    validateCoachReply({ ...validReply, opportunities: new Array(7).fill('x') }).ok,
    false,
  )
  assert.equal(validateCoachReply({ ...validReply, confidenceNote: '' }).ok, false)
})

test('validateCoachReply rejects profit-promise language anywhere', () => {
  const result = validateCoachReply({
    ...validReply,
    analysis: 'This setup is a guaranteed profit and risk-free.',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /promise language/i)
})

test('findPromiseLanguage flags common guarantees but not uncertainty language', () => {
  assert.ok(findPromiseLanguage('100% win rate'))
  assert.ok(findPromiseLanguage('You will make money'))
  assert.ok(findPromiseLanguage('a sure profit'))
  assert.ok(findPromiseLanguage('risk free returns'))
  assert.ok(findPromiseLanguage('a guaranteed profit'))
  assert.ok(findPromiseLanguage('profits are guaranteed'))
  assert.equal(findPromiseLanguage('Indicators are descriptive, not predictive.'), null)
  assert.equal(findPromiseLanguage('No outcome is guaranteed.'), null)
  assert.equal(findPromiseLanguage('There is no guarantee of profit.'), null)
  assert.equal(findPromiseLanguage('There are no guaranteed returns.'), null)
  assert.equal(findPromiseLanguage('Trading is not risk-free.'), null)
})

/* ------------------------------------------------------------------ */
/* Rule-based fallback                                                */
/* ------------------------------------------------------------------ */

test('buildRuleBasedExplanation derives everything from verified candles', () => {
  const analysis = analyzeCandles(trendCandles(260, 100, 1))
  const context = {
    symbol: 'BTCUSDT' as const,
    interval: '15m' as const,
    lastPrice: analysis.lastClose,
    change24h: 1.5,
    candleCount: analysis.candleCount,
    trend: analysis.trend.direction,
    trendScore: analysis.trend.score,
    trendMax: analysis.trend.maxScore,
    fetchedAt: Date.now(),
  }

  const reply = buildRuleBasedExplanation({ context, analysis })
  assert.equal(reply.marketCondition, 'bullish')
  assert.match(reply.summary, /BTCUSDT 15m/)
  assert.match(reply.analysis, /260 verified candles/)
  assert.ok(reply.indicators.length >= 4)
  assert.ok(reply.risks.length >= 1)
  assert.ok(reply.avoidTrading.length >= 1)
  assert.match(reply.confidenceNote, /not Gemini/i)
  assert.match(reply.confidenceNote, /win probability/i)

  const validation = validateCoachReply(reply)
  assert.equal(validation.ok, true)
})

test('buildRuleBasedExplanation handles zero-candle analysis without inventing values', () => {
  const analysis = analyzeCandles([])
  const context = {
    symbol: 'SOLUSDT' as const,
    interval: '1h' as const,
    lastPrice: null,
    change24h: null,
    candleCount: 0,
    trend: analysis.trend.direction,
    trendScore: analysis.trend.score,
    trendMax: analysis.trend.maxScore,
    fetchedAt: Date.now(),
  }

  const reply = buildRuleBasedExplanation({ context, analysis })
  assert.match(reply.summary, /SOLUSDT 1h/)
  assert.equal(reply.indicators.length, 1)
  assert.equal(reply.indicators[0].name, 'Indicator data')
  assert.ok(reply.avoidTrading.some((item) => /No trend checks/i.test(item)))
  assert.equal(validateCoachReply(reply).ok, true)
})

/* ------------------------------------------------------------------ */
/* Gemini transport                                                   */
/* ------------------------------------------------------------------ */

test('extractGeminiText joins text parts and ignores empty candidates', () => {
  assert.equal(
    extractGeminiText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
    'ab',
  )
  assert.equal(extractGeminiText({ candidates: [] }), null)
  assert.equal(extractGeminiText({}), null)
})

test('callGemini sends the key as a header, never in the URL', async () => {
  let capturedUrl = ''
  let capturedKey = ''
  let capturedBody = ''

  const fetchImpl = async (url: string, init: RequestInit) => {
    capturedUrl = url
    capturedKey = String((init.headers as Record<string, string>)['x-goog-api-key'])
    capturedBody = String(init.body)
    return jsonResponse(geminiBody(validReply))
  }

  const reply = await callGemini({
    apiKey: 'test-key-123',
    model: 'gemini-2.5-flash',
    prompt: 'verified context',
    fetchImpl,
  })

  assert.equal(reply.summary, validReply.summary)
  assert.ok(capturedUrl.startsWith('https://generativelanguage.googleapis.com/'))
  assert.ok(!capturedUrl.includes('test-key-123'))
  assert.equal(capturedKey, 'test-key-123')

  const body = JSON.parse(capturedBody) as Record<string, unknown>
  assert.equal(body.systemInstruction !== undefined, true)
  const generation = body.generationConfig as Record<string, unknown>
  assert.equal(generation.responseMimeType, 'application/json')
})

test('callGemini surfaces HTTP errors with the provider message', async () => {
  const fetchImpl = async () =>
    jsonResponse({ error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, 400)

  await assert.rejects(
    () =>
      callGemini({
        apiKey: 'bad',
        model: 'gemini-2.5-flash',
        prompt: 'x',
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiError)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'INVALID_ARGUMENT')
      assert.match(error.message, /API key not valid/)
      return true
    },
  )
})

test('callGemini rejects empty, non-JSON and malformed content', async () => {
  const cases: Array<{ body: unknown; code: string }> = [
    { body: { candidates: [] }, code: 'empty' },
    { body: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }, code: 'invalid_json' },
    {
      body: geminiBody({ ...validReply, risks: [] }),
      code: 'invalid_reply',
    },
    {
      body: geminiBody({ ...validReply, summary: 'Guaranteed profit awaits.' }),
      code: 'invalid_reply',
    },
  ]

  for (const entry of cases) {
    const fetchImpl = async () => jsonResponse(entry.body)
    await assert.rejects(
      () =>
        callGemini({
          apiKey: 'key',
          model: 'gemini-2.5-flash',
          prompt: 'x',
          fetchImpl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof GeminiError)
        assert.equal(error.code, entry.code)
        return true
      },
    )
  }
})

test('callGemini reports network failures as GeminiError', async () => {
  const fetchImpl = async () => {
    throw new Error('socket hang up')
  }

  await assert.rejects(
    () =>
      callGemini({
        apiKey: 'key',
        model: 'gemini-2.5-flash',
        prompt: 'x',
        fetchImpl,
      }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiError)
      assert.equal(error.code, 'network')
      return true
    },
  )
})

/* ------------------------------------------------------------------ */
/* Orchestration                                                      */
/* ------------------------------------------------------------------ */

test('generateCoachReply uses the rule engine when no key is configured', async () => {
  const context = contextFixture()
  const result = await generateCoachReply({
    request: requestFixture(),
    context,
    apiKey: undefined,
    model: 'gemini-2.5-flash',
  })

  assert.equal(result.provider, 'rule-based')
  assert.equal(result.model, null)
  assert.match(result.error ?? '', /not configured/i)
  assert.equal(validateCoachReply(result.reply).ok, true)
})

test('generateCoachReply falls back with an error when Gemini fails', async () => {
  const context = contextFixture()
  const fetchImpl = async () => jsonResponse({ error: { message: 'quota exceeded' } }, 429)

  const result = await generateCoachReply({
    request: requestFixture(),
    context,
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    fetchImpl,
  })

  assert.equal(result.provider, 'rule-based')
  assert.match(result.error ?? '', /quota exceeded/)
  assert.equal(validateCoachReply(result.reply).ok, true)
})

test('generateCoachReply returns a Gemini reply when the call is valid', async () => {
  const context = contextFixture()
  const fetchImpl = async () => jsonResponse(geminiBody(validReply))

  const result = await generateCoachReply({
    request: requestFixture(),
    context,
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    fetchImpl,
  })

  assert.equal(result.provider, 'gemini')
  assert.equal(result.model, 'gemini-2.5-flash')
  assert.equal(result.error, null)
  assert.equal(result.reply.summary, validReply.summary)
})

test('generateCoachReply falls back when Gemini returns promise language', async () => {
  const context = contextFixture()
  const fetchImpl = async () =>
    jsonResponse(geminiBody({ ...validReply, summary: 'This is a guaranteed win.' }))

  const result = await generateCoachReply({
    request: requestFixture(),
    context,
    apiKey: 'key',
    model: 'gemini-2.5-flash',
    fetchImpl,
  })

  assert.equal(result.provider, 'rule-based')
  assert.match(result.error ?? '', /validation/i)
  assert.equal(result.reply.summary, buildRuleBasedExplanation({
    context: {
      symbol: context.symbol,
      interval: context.interval,
      lastPrice: context.analysis.lastClose,
      change24h: context.ticker?.priceChangePercent ?? null,
      candleCount: context.analysis.candleCount,
      trend: context.analysis.trend.direction,
      trendScore: context.analysis.trend.score,
      trendMax: context.analysis.trend.maxScore,
      fetchedAt: context.fetchedAt,
    },
    analysis: context.analysis,
  }).summary)
})

/* ------------------------------------------------------------------ */
/* Client transport                                                   */
/* ------------------------------------------------------------------ */

test('postCoach returns a validated reply and re-checks the shape', async () => {
  const originalFetch = globalThis.fetch
  const context = {
    symbol: 'BTCUSDT' as const,
    interval: '15m' as const,
    lastPrice: 100,
    change24h: 1.2,
    candleCount: 300,
    trend: 'bullish' as const,
    trendScore: 4,
    trendMax: 5,
    fetchedAt: Date.now(),
  }

  try {
    globalThis.fetch = async () =>
      jsonResponse({
        ok: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        reply: validReply,
        error: null,
        context,
      })

    const response = await postCoach(requestFixture())
    assert.equal(response.provider, 'gemini')
    assert.equal(response.reply.summary, validReply.summary)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('postCoach rejects a malformed or unsafe reply from the wire', async () => {
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async () =>
      jsonResponse({
        ok: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        reply: { ...validReply, risks: [] },
        error: null,
        context: null,
      })

    await assert.rejects(
      () => postCoach(requestFixture()),
      /failed validation/i,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('postCoach surfaces HTTP error messages', async () => {
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async () =>
      jsonResponse({ ok: false, error: 'Too many coach requests.' }, 429)

    await assert.rejects(() => postCoach(requestFixture()), /Too many coach requests/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                */
/* ------------------------------------------------------------------ */

function storedMessage(partial: Partial<StoredMessage>): StoredMessage {
  return {
    id: 'id',
    role: 'user',
    text: 'hello',
    reply: null,
    provider: null,
    error: null,
    context: null,
    at: 1,
    ...partial,
  }
}

test('historyFromMessages keeps user turns and assistant summaries only', () => {
  const messages: StoredMessage[] = [
    storedMessage({ id: 'u1', role: 'user', text: 'first' }),
    storedMessage({
      id: 'a1',
      role: 'assistant',
      text: 'summary',
      reply: validReply,
      provider: 'gemini',
    }),
    storedMessage({ id: 'a2', role: 'assistant', text: 'error only', reply: null }),
    storedMessage({ id: 'u2', role: 'user', text: 'second' }),
  ]

  const history = historyFromMessages(messages)
  assert.deepEqual(
    history.map((turn) => turn.text),
    ['first', validReply.summary, 'second'],
  )
  assert.equal(historyFromMessages(messages, 1).length, 1)
})
