/**
 * Typed client for the read-only portfolio API.
 *
 * The browser sends credentials only to this app's local server over the
 * same origin. The server holds them in memory; the client never persists
 * them and clears the form after a successful connection.
 */

import type { BinancePortfolioStatus } from './portfolio.ts'

export class PortfolioApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'error') {
    super(message)
    this.name = 'PortfolioApiError'
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
    throw new PortfolioApiError('Unable to reach the server. Check your connection.', 0, 'network')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new PortfolioApiError('The server returned an unreadable response.', response.status)
  }

  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    if (isRecord(payload) && typeof payload.error === 'string') {
      const code = typeof payload.code === 'string' ? payload.code : 'error'
      throw new PortfolioApiError(payload.error, response.status, code)
    }
    throw new PortfolioApiError(`Request failed with status ${response.status}.`, response.status)
  }

  return payload
}

function requireStatus(payload: unknown): BinancePortfolioStatus {
  if (!isRecord(payload) || !isRecord(payload.status)) {
    throw new PortfolioApiError('The server returned an invalid portfolio status.', 500, 'bad-status')
  }
  return payload.status as unknown as BinancePortfolioStatus
}

export async function fetchBinancePortfolioStatus(): Promise<BinancePortfolioStatus> {
  return requireStatus(await request('/api/portfolio/binance'))
}

export async function connectBinanceRequest(
  apiKey: string,
  secret: string,
): Promise<BinancePortfolioStatus> {
  return requireStatus(
    await request('/api/portfolio/binance', {
      method: 'POST',
      body: JSON.stringify({ action: 'connect', apiKey, secret }),
    }),
  )
}

export async function refreshBinanceRequest(): Promise<BinancePortfolioStatus> {
  return requireStatus(
    await request('/api/portfolio/binance', {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh' }),
    }),
  )
}

export async function disconnectBinanceRequest(): Promise<BinancePortfolioStatus> {
  return requireStatus(
    await request('/api/portfolio/binance', {
      method: 'POST',
      body: JSON.stringify({ action: 'disconnect' }),
    }),
  )
}
