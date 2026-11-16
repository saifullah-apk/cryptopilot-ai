/**
 * Binance read-only account access.
 *
 * HARD LIMITS:
 *   - ONLY signed GET requests to an explicit allowlist.
 *   - The allowlist currently contains `/api/v3/account` and nothing else.
 *   - No order, transfer, deposit or withdrawal endpoint exists in this file.
 *   - Credentials live in memory for this server process only. They are
 *     never persisted, never logged and never sent to the browser.
 *
 * A read-only API key is strongly recommended. The snapshot reports the
 * key's own permission flags so the user can verify them.
 */

import { createHmac } from 'node:crypto'

import { fetchTickers24h, MARKET_SYMBOLS } from '../src/lib/binance.ts'
import type { RealAccountSnapshot, RealAssetBalance } from '../src/lib/portfolio.ts'
import { round } from '../src/lib/paperTrading.ts'

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export class PortfolioError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'portfolio-error') {
    super(message)
    this.name = 'PortfolioError'
    this.status = status
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Allowlist + signing                                                */
/* ------------------------------------------------------------------ */

export const SIGNED_ACCOUNT_HOST = 'https://api.binance.com'

/** GET-only endpoints this app is allowed to call. Deliberately tiny. */
export const READ_ONLY_PATHS = ['/api/v3/account'] as const
export type ReadOnlyPath = (typeof READ_ONLY_PATHS)[number]

export function assertReadOnlyPath(path: string): asserts path is ReadOnlyPath {
  if (!READ_ONLY_PATHS.includes(path as ReadOnlyPath)) {
    throw new PortfolioError(
      `Blocked non-allowlisted Binance path: ${path}. This app only performs read-only account reads.`,
      403,
      'blocked-path',
    )
  }
}

export function accountQuery(timestamp: number, recvWindow = 5_000): string {
  return `recvWindow=${recvWindow}&timestamp=${timestamp}`
}

export function signQuery(secret: string, query: string): string {
  return createHmac('sha256', secret).update(query).digest('hex')
}

export function signedAccountUrl(
  apiKey: string,
  secret: string,
  timestamp = Date.now(),
): { url: string; keyHeader: string } {
  assertReadOnlyPath('/api/v3/account')
  const query = accountQuery(timestamp)
  const signature = signQuery(secret, query)
  return {
    url: `${SIGNED_ACCOUNT_HOST}/api/v3/account?${query}&signature=${signature}`,
    keyHeader: apiKey,
  }
}

/* ------------------------------------------------------------------ */
/* Parsing (pure)                                                     */
/* ------------------------------------------------------------------ */

export type RawBalance = {
  asset: string
  free: number
  locked: number
}

export type ParsedAccount = {
  accountType: string | null
  canTrade: boolean
  canWithdraw: boolean
  canDeposit: boolean
  balances: RawBalance[]
}

function finiteString(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseAccountPayload(payload: unknown): ParsedAccount {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PortfolioError('Binance returned an unexpected account payload.', 502, 'bad-payload')
  }

  const raw = payload as Record<string, unknown>
  if (!Array.isArray(raw.balances)) {
    throw new PortfolioError('Binance account payload has no balances list.', 502, 'bad-payload')
  }

  const balances: RawBalance[] = []
  for (const row of raw.balances) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const entry = row as Record<string, unknown>
    if (typeof entry.asset !== 'string' || entry.asset.length === 0) continue

    const free = finiteString(entry.free)
    const locked = finiteString(entry.locked)
    if (free === null || locked === null) continue
    if (free + locked <= 0) continue

    balances.push({ asset: entry.asset, free, locked })
  }

  return {
    accountType: typeof raw.accountType === 'string' ? raw.accountType : null,
    canTrade: raw.canTrade === true,
    canWithdraw: raw.canWithdraw === true,
    canDeposit: raw.canDeposit === true,
    balances,
  }
}

/** Adds verified USDT valuations for assets we can price publicly. */
export async function valueBalances(
  balances: readonly RawBalance[],
  fetchPrices: typeof fetchTickers24h = fetchTickers24h,
): Promise<{ balances: RealAssetBalance[]; unpricedAssets: string[]; valuedSubtotal: number }> {
  const supported = new Set<string>(MARKET_SYMBOLS)
  const pricedSymbols = balances
    .filter((balance) => balance.asset !== 'USDT')
    .map((balance) => `${balance.asset}USDT`)
    .filter((symbol) => supported.has(symbol))

  const priceMap = new Map<string, number>()
  if (pricedSymbols.length > 0) {
    try {
      const tickers = await fetchPrices(pricedSymbols)
      for (const ticker of tickers) priceMap.set(ticker.symbol, ticker.lastPrice)
    } catch {
      // A pricing failure is not fatal: those balances stay explicit nulls.
    }
  }

  const unpricedAssets: string[] = []
  let valuedSubtotal = 0

  const mapped: RealAssetBalance[] = balances.map((balance) => {
    const total = balance.free + balance.locked
    let usdtValue: number | null

    if (balance.asset === 'USDT') {
      usdtValue = total
    } else {
      const price = priceMap.get(`${balance.asset}USDT`)
      usdtValue = price === undefined ? null : total * price
    }

    if (usdtValue === null) unpricedAssets.push(balance.asset)
    else valuedSubtotal += usdtValue

    return {
      asset: balance.asset,
      free: round(balance.free, 8),
      locked: round(balance.locked, 8),
      total: round(total, 8),
      usdtValue: usdtValue === null ? null : round(usdtValue, 2),
    }
  })

  mapped.sort((a, b) => (b.usdtValue ?? -1) - (a.usdtValue ?? -1))
  return { balances: mapped, unpricedAssets, valuedSubtotal: round(valuedSubtotal, 2) }
}

/* ------------------------------------------------------------------ */
/* Fetching                                                           */
/* ------------------------------------------------------------------ */

type FetchLike = typeof fetch

export type Credentials = {
  apiKey: string
  secret: string
}

export type SnapshotDeps = {
  fetchImpl?: FetchLike
  fetchPrices?: typeof fetchTickers24h
  now?: () => number
}

const REQUEST_TIMEOUT_MS = 12_000

/**
 * Performs exactly one signed GET to `/api/v3/account` and returns a
 * read-only snapshot. No credentials are included in thrown errors.
 */
export async function fetchAccountSnapshot(
  credentials: Credentials,
  deps: SnapshotDeps = {},
): Promise<RealAccountSnapshot> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  const { url, keyHeader } = signedAccountUrl(credentials.apiKey, credentials.secret, now())

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-MBX-APIKEY': keyHeader,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new PortfolioError(
      'Unable to reach Binance. The account was not connected.',
      502,
      'network',
    )
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new PortfolioError(
        'Binance rejected the API key or signature. Check the key, secret and server clock.',
        401,
        'invalid-key',
      )
    }
    if (response.status === 403) {
      throw new PortfolioError(
        'This API key or server IP is not permitted by Binance. Check the key restrictions.',
        403,
        'forbidden',
      )
    }
    if (response.status === 451) {
      throw new PortfolioError(
        'Binance account access is unavailable from this server region (HTTP 451).',
        502,
        'region-blocked',
      )
    }
    if (response.status === 418 || response.status === 429) {
      throw new PortfolioError(
        'Binance rate-limited the account request. Try again in a minute.',
        429,
        'rate-limited',
      )
    }
    throw new PortfolioError(
      `Binance account request failed with HTTP ${response.status}.`,
      502,
      'upstream',
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new PortfolioError('Binance returned an unreadable account response.', 502, 'bad-payload')
  }

  const parsed = parseAccountPayload(payload)
  const valued = await valueBalances(parsed.balances, deps.fetchPrices)

  let permissionWarning: string | null = null
  if (parsed.canWithdraw) {
    permissionWarning =
      'This API key reports withdrawal permission. CryptoPilot never calls withdrawal endpoints, but replace it with a read-only key.'
  } else if (parsed.canTrade) {
    permissionWarning =
      'This API key reports trading permission. CryptoPilot only calls GET /api/v3/account, but a read-only key is safer.'
  }

  return {
    source: 'binance-read-only',
    fetchedAt: now(),
    accountType: parsed.accountType,
    canTrade: parsed.canTrade,
    canWithdraw: parsed.canWithdraw,
    canDeposit: parsed.canDeposit,
    balances: valued.balances,
    valuedSubtotal: valued.valuedSubtotal,
    unpricedAssets: valued.unpricedAssets,
    permissionWarning,
  }
}
