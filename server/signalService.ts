/**
 * Signal generation — verified market context → deterministic setup
 * evaluation → AI explanation → persisted pending `TradeSignal`.
 *
 * The AI layer only explains the setup that the rules engine produced; it
 * never decides the action, the levels or the confidence score. When Gemini
 * is unavailable a rule-based explanation is used (HTTP 200, `error` set).
 */

import { randomUUID } from 'node:crypto'

import type { CoachRequest } from '../src/lib/coach.ts'
import {
  type PaperInterval,
  type PaperSymbol,
  type TradeSignal,
} from '../src/lib/paperTrading.ts'
import { evaluateSetup, isSignalExpired, signalExpiresAt } from '../src/lib/signals.ts'
import {
  buildVerifiedContext,
  generateCoachReply,
  MarketDataError,
} from './coachService.ts'
import { PaperError } from './paperService.ts'
import type { PaperStore } from './paperStore.ts'

export type GenerateSignalDeps = {
  store: PaperStore
  apiKey: string | undefined
  model: string
}

export type GenerateSignalResult = {
  signal: TradeSignal
  provider: 'gemini' | 'rule-based'
  /** Non-null when Gemini was skipped or failed — shown to the user. */
  error: string | null
}

/** Plain-language question that asks the coach to explain (not decide). */
const EXPLAIN_QUESTION =
  'Explain this signal setup to a paper-trading user: what the indicators show, ' +
  'what would invalidate the read, and the main risks. Do not promise any outcome.'

function buildAiExplanation(
  summary: string,
  analysis: string,
  confidenceNote: string,
): string {
  const parts = [summary.trim(), analysis.trim()].filter(Boolean)
  const body = parts.join('\n\n')
  return confidenceNote.trim() ? `${body}\n\n${confidenceNote.trim()}` : body
}

export async function generateSignal(
  deps: GenerateSignalDeps,
  symbol: PaperSymbol,
  interval: PaperInterval,
): Promise<GenerateSignalResult> {
  const { store } = deps
  const now = Date.now()

  store.expireStaleSignals(now)

  // Duplicate protection: one pending signal per symbol + timeframe.
  const duplicate = store
    .listSignals(60)
    .find(
      (signal) =>
        signal.status === 'pending' &&
        signal.symbol === symbol &&
        signal.interval === interval &&
        !isSignalExpired(signal.expiresAt, now),
    )
  if (duplicate) {
    throw new PaperError(
      `A pending ${symbol} ${interval} signal already exists — review or wait for it to expire before generating another.`,
      409,
      'duplicate-pending',
    )
  }

  // Verified candles + ticker from Binance public data (throws
  // MarketDataError → 502 at the route layer; no invented prices).
  const context = await buildVerifiedContext(symbol, interval)

  const draft = evaluateSetup(context.analysis, interval)
  if (!draft) {
    throw new MarketDataError(
      `No usable market price was returned for ${symbol} — a signal cannot be built without one.`,
    )
  }

  // AI explanation of the rules-engine output (Gemini or rule-based fallback).
  const request: CoachRequest = {
    question: EXPLAIN_QUESTION,
    symbol,
    interval,
    history: [],
    portfolio: null,
  }
  const generation = await generateCoachReply({
    request,
    context,
    apiKey: deps.apiKey,
    model: deps.model,
  })

  const aiExplanation = buildAiExplanation(
    generation.reply.summary,
    generation.reply.analysis,
    generation.reply.confidenceNote,
  )

  // Merge up to two AI risks the coach flagged, keeping the deterministic
  // warnings first so the mandatory risk copy is never pushed out.
  const aiRisks = generation.reply.risks
    .filter((risk) => typeof risk === 'string' && risk.trim().length > 0)
    .map((risk) => risk.trim())
    .slice(0, 2)
  const riskWarnings = [...draft.riskWarnings]
  for (const risk of aiRisks) {
    if (riskWarnings.length >= 6) break
    if (!riskWarnings.some((existing) => existing.includes(risk))) {
      riskWarnings.push(risk)
    }
  }

  const marketPrice = context.analysis.lastClose
  if (marketPrice === null || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    throw new MarketDataError(
      `No usable market price was returned for ${symbol} — a signal cannot be built without one.`,
    )
  }

  const signal: TradeSignal = {
    id: randomUUID(),
    symbol,
    interval,
    action: draft.action,
    side: draft.side,
    marketPrice,
    technicalReasoning: draft.technicalReasoning,
    aiExplanation,
    aiProvider: generation.provider,
    confidence: draft.confidence,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    riskReward: draft.riskReward,
    riskWarnings,
    createdAt: now,
    expiresAt: signalExpiresAt(now, interval),
    status: 'pending',
    decidedAt: null,
    decisionNote: null,
  }

  store.insertSignal(signal)

  return { signal, provider: generation.provider, error: generation.error }
}
