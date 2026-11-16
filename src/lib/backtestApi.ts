/**
 * Typed client for historical backtests.
 *
 * The server fetches public Binance candles, runs the shared engine and
 * persists the report. Every response is re-validated before the UI uses it.
 */

import type {
  BacktestRequest,
  BacktestRunSummary,
  StoredBacktestRun,
} from './backtest.ts'

export class BacktestApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'error') {
    super(message)
    this.name = 'BacktestApiError'
    this.status = status
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new BacktestApiError('Unable to reach the server. Check your connection.', 0, 'network')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new BacktestApiError('The server returned an unreadable response.', response.status)
  }

  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    if (isRecord(payload) && typeof payload.error === 'string') {
      const code = typeof payload.code === 'string' ? payload.code : 'error'
      throw new BacktestApiError(payload.error, response.status, code)
    }
    throw new BacktestApiError(`Request failed with status ${response.status}.`, response.status)
  }

  return payload
}

function requireRun(payload: unknown): StoredBacktestRun {
  if (
    !isRecord(payload) ||
    !isRecord(payload.run) ||
    !isRecord(payload.run.summary) ||
    !isRecord(payload.run.report)
  ) {
    throw new BacktestApiError('The server returned an invalid backtest result.', 500, 'bad-run')
  }
  return payload.run as unknown as StoredBacktestRun
}

export async function runBacktestRequest(
  params: BacktestRequest,
): Promise<StoredBacktestRun> {
  return requireRun(
    await request('/api/backtest', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  )
}

export async function fetchBacktestRuns(): Promise<BacktestRunSummary[]> {
  const payload = await request('/api/backtest/runs')
  if (!isRecord(payload) || !Array.isArray(payload.runs)) {
    throw new BacktestApiError('The server returned an invalid run list.', 500, 'bad-runs')
  }
  return payload.runs as unknown as BacktestRunSummary[]
}

export async function fetchBacktestRun(id: string): Promise<StoredBacktestRun> {
  return requireRun(await request(`/api/backtest/runs/${encodeURIComponent(id)}`))
}
