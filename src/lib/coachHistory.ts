/**
 * Local persistence for the AI Coach conversation.
 *
 * Only messages the user already saw are stored; nothing is sent anywhere
 * except the explicit /api/coach request. Corrupt or old data is discarded
 * rather than repaired with guesses.
 */

import {
  validateCoachReply,
  type ChatRole,
  type CoachContextSummary,
  type CoachProvider,
  type CoachReply,
} from './coach.ts'

export const COACH_STORAGE_KEY = 'cryptopilot.coach.v1'
export const MAX_STORED_MESSAGES = 40

export type StoredMessage = {
  id: string
  role: ChatRole
  text: string
  /** Structured reply, only for assistant turns that succeeded. */
  reply: CoachReply | null
  provider: CoachProvider | null
  error: string | null
  context: CoachContextSummary | null
  at: number
}

export type StoredPreferences = {
  symbol: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
  interval: '15m' | '1h'
}

export type StoredConversation = {
  messages: StoredMessage[]
  preferences: StoredPreferences
}

export const DEFAULT_PREFERENCES: StoredPreferences = {
  symbol: 'BTCUSDT',
  interval: '15m',
}

const SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
const INTERVALS = new Set(['15m', '1h'])

function sanitizeMessage(value: unknown): StoredMessage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.role !== 'user' && raw.role !== 'assistant') return null
  if (typeof raw.text !== 'string' || raw.text.trim().length === 0) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null

  let reply: CoachReply | null = null
  if (raw.reply && typeof raw.reply === 'object') {
    const validated = validateCoachReply(raw.reply)
    if (validated.ok) reply = validated.value
  }

  const provider: CoachProvider | null =
    raw.provider === 'gemini' || raw.provider === 'rule-based' ? raw.provider : null

  const error = typeof raw.error === 'string' ? raw.error : null

  const context =
    raw.context && typeof raw.context === 'object'
      ? (raw.context as CoachContextSummary)
      : null

  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now()

  return {
    id: raw.id,
    role: raw.role,
    text: raw.text.trim(),
    reply,
    provider: raw.role === 'assistant' ? provider : null,
    error: raw.role === 'assistant' ? error : null,
    context: raw.role === 'assistant' ? context : null,
    at,
  }
}

/** Reads and sanitizes the stored conversation. Never throws. */
export function loadConversation(): StoredConversation {
  if (typeof localStorage === 'undefined') {
    return { messages: [], preferences: DEFAULT_PREFERENCES }
  }

  try {
    const raw = localStorage.getItem(COACH_STORAGE_KEY)
    if (!raw) return { messages: [], preferences: DEFAULT_PREFERENCES }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .map(sanitizeMessage)
          .filter((message): message is StoredMessage => message !== null)
          .slice(-MAX_STORED_MESSAGES)
      : []

    const rawPreferences = (parsed.preferences ?? {}) as Record<string, unknown>
    const preferences: StoredPreferences = {
      symbol: SYMBOLS.has(rawPreferences.symbol as string)
        ? (rawPreferences.symbol as StoredPreferences['symbol'])
        : DEFAULT_PREFERENCES.symbol,
      interval: INTERVALS.has(rawPreferences.interval as string)
        ? (rawPreferences.interval as StoredPreferences['interval'])
        : DEFAULT_PREFERENCES.interval,
    }

    return { messages, preferences }
  } catch {
    return { messages: [], preferences: DEFAULT_PREFERENCES }
  }
}

/** Writes the conversation, trimming the oldest turns. Never throws. */
export function saveConversation(
  messages: StoredMessage[],
  preferences: StoredPreferences,
): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      COACH_STORAGE_KEY,
      JSON.stringify({
        messages: messages.slice(-MAX_STORED_MESSAGES),
        preferences,
      }),
    )
  } catch {
    /* storage full or blocked — chat still works in memory */
  }
}

export function clearConversation(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(COACH_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Builds request history from stored turns (assistant turns use a compact summary). */
export function historyFromMessages(
  messages: StoredMessage[],
  limit = 8,
): { role: ChatRole; text: string }[] {
  return messages
    .filter((message) => message.role === 'user' || message.reply !== null)
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      text:
        message.role === 'user'
          ? message.text
          : (message.reply?.summary ?? message.text).slice(0, 700),
    }))
}
