/**
 * Typed fetch helpers for the paper-trading API.
 *
 * Every response is re-validated before it reaches state — a malformed
 * payload becomes a clear error instead of corrupt UI. All trades here are
 * virtual; no exchange endpoints are ever called from the client.
 */

import type { PaperState, TradeSignal, PaperPosition } from './paperTrading.ts'

export class PaperApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'error') {
    super(message)
    this.name = 'PaperApiError'
    this.status = status
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readError(payload: unknown, status: number): PaperApiError {
  if (isRecord(payload) && typeof payload.error === 'string') {
    const code = typeof payload.code === 'string' ? payload.code : 'error'
    return new PaperApiError(payload.error, status, code)
  }
  return new PaperApiError(`Request failed with status ${status}.`, status)
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new PaperApiError('Unable to reach the server. Check your connection.', 0, 'network')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new PaperApiError('The server returned an unreadable response.', response.status)
  }

  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw readError(payload, response.status)
  }
  return payload
}

function requireState(payload: unknown): PaperState {
  if (!isRecord(payload) || !isRecord(payload.state)) {
    throw new PaperApiError('The server returned an invalid paper-trading state.', 500, 'bad-state')
  }
  return payload.state as unknown as PaperState
}

function requireSignal(payload: unknown): TradeSignal {
  if (!isRecord(payload) || !isRecord(payload.signal)) {
    throw new PaperApiError('The server returned an invalid signal.', 500, 'bad-signal')
  }
  return payload.signal as unknown as TradeSignal
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                          */
/* ------------------------------------------------------------------ */

export async function fetchPaperState(): Promise<PaperState> {
  const payload = await request('/api/paper/state')
  return requireState(payload)
}

export type GenerateSignalResponse = {
  signal: TradeSignal
  provider: 'gemini' | 'rule-based'
  /** Non-null when Gemini was skipped — surfaced to the user. */
  error: string | null
}

export async function generateSignalRequest(
  symbol: string,
  interval: string,
): Promise<GenerateSignalResponse> {
  const payload = await request('/api/paper/signals', {
    method: 'POST',
    body: JSON.stringify({ symbol, interval }),
  })
  const signal = requireSignal(payload)
  const provider = isRecord(payload) && payload.provider === 'rule-based' ? 'rule-based' : 'gemini'
  const error = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null
  return { signal, provider, error }
}

export async function approveSignalRequest(
  signalId: string,
  riskPct: number,
): Promise<{ signal: TradeSignal; position: PaperPosition; state: PaperState }> {
  const payload = await request(`/api/paper/signals/${encodeURIComponent(signalId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ riskPct }),
  })
  if (!isRecord(payload) || !isRecord(payload.position)) {
    throw new PaperApiError('The server returned an invalid execution result.', 500, 'bad-position')
  }
  return {
    signal: requireSignal(payload),
    position: payload.position as unknown as PaperPosition,
    state: requireState(payload),
  }
}

export async function rejectSignalRequest(signalId: string): Promise<PaperState> {
  const payload = await request(`/api/paper/signals/${encodeURIComponent(signalId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return requireState(payload)
}

export async function closePositionRequest(positionId: string): Promise<PaperState> {
  const payload = await request(`/api/paper/positions/${encodeURIComponent(positionId)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return requireState(payload)
}

export async function setPausedRequest(paused: boolean): Promise<PaperState> {
  const payload = await request('/api/paper/pause', {
    method: 'POST',
    body: JSON.stringify({ paused }),
  })
  return requireState(payload)
}
