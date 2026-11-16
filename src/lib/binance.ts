/**
 * Binance public market data client (read-only).
 *
 * Only public, unauthenticated endpoints are used:
 *   GET /api/v3/klines
 *   GET /api/v3/ticker/24hr
 *
 * No API key, no signature, no account or trading endpoints.
 */

export type Interval = '15m' | '1h'

export const INTERVALS: readonly Interval[] = ['15m', '1h']

export type MarketSymbol = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'

export type Market = {
  symbol: MarketSymbol
  base: string
  name: string
  markClass: string
}

export const MARKETS: readonly Market[] = [
  { symbol: 'BTCUSDT', base: 'BTC', name: 'Bitcoin', markClass: 'asset__mark--btc' },
  { symbol: 'ETHUSDT', base: 'ETH', name: 'Ethereum', markClass: 'asset__mark--eth' },
  { symbol: 'SOLUSDT', base: 'SOL', name: 'Solana', markClass: 'asset__mark--sol' },
]

export const MARKET_SYMBOLS: MarketSymbol[] = MARKETS.map((market) => market.symbol)

export function marketBySymbol(symbol: string): Market | undefined {
  return MARKETS.find((market) => market.symbol === symbol)
}

export type Candle = {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export type Ticker24h = {
  symbol: string
  lastPrice: number
  openPrice: number
  highPrice: number
  lowPrice: number
  volume: number
  priceChangePercent: number
  closeTime: number
}

export class BinanceError extends Error {
  status: number | null
  /** Region blocks / rate limits on one host should fall through to the next. */
  retryable: boolean

  constructor(message: string, status: number | null = null, retryable = false) {
    super(message)
    this.name = 'BinanceError'
    this.status = status
    this.retryable = retryable
  }
}

/* ------------------------------------------------------------------ */
/* Hosts                                                              */
/* ------------------------------------------------------------------ */

/** Public market-data hosts. `data-api.binance.vision` is the CORS-friendly one. */
const REST_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
] as const

const REQUEST_TIMEOUT_MS = 12_000

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function restGet(path: string, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown = null

  for (const host of REST_HOSTS) {
    try {
      const response = await fetch(`${host}${path}`, {
        signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        const retryable =
          response.status === 403 ||
          response.status === 418 ||
          response.status === 429 ||
          response.status === 451 ||
          response.status >= 500

        const error = new BinanceError(
          `Binance REST ${response.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
          response.status,
          retryable,
        )
        if (!retryable) throw error
        lastError = error
        continue
      }

      return (await response.json()) as unknown
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof BinanceError && !error.retryable) throw error
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new BinanceError('All Binance public data hosts failed')
}

/* ------------------------------------------------------------------ */
/* Parsing (pure + unit tested)                                       */
/* ------------------------------------------------------------------ */

function toFinite(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * Parses Binance kline rows:
 * [openTime, open, high, low, close, volume, closeTime, ...]
 * Malformed rows are skipped rather than throwing, so one bad row cannot
 * break the whole chart.
 */
export function parseKlines(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) {
    throw new BinanceError('Unexpected kline payload')
  }

  const candles: Candle[] = []

  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 7) continue

    const openTime = toFinite(row[0])
    const open = toFinite(row[1])
    const high = toFinite(row[2])
    const low = toFinite(row[3])
    const close = toFinite(row[4])
    const volume = toFinite(row[5])
    const closeTime = toFinite(row[6])

    if (
      openTime === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      closeTime === null
    ) {
      continue
    }

    candles.push({ openTime, open, high, low, close, volume, closeTime })
  }

  return candles
}

export function parseTicker24h(payload: unknown): Ticker24h {
  if (!payload || typeof payload !== 'object') {
    throw new BinanceError('Unexpected ticker payload')
  }

  const raw = payload as Record<string, unknown>
  if (typeof raw.symbol !== 'string') {
    throw new BinanceError('Ticker payload missing symbol')
  }

  const lastPrice = toFinite(raw.lastPrice)
  const openPrice = toFinite(raw.openPrice)
  const highPrice = toFinite(raw.highPrice)
  const lowPrice = toFinite(raw.lowPrice)
  const volume = toFinite(raw.volume)
  const closeTime = toFinite(raw.closeTime)
  const changePercent = toFinite(raw.priceChangePercent)

  if (
    lastPrice === null ||
    openPrice === null ||
    highPrice === null ||
    lowPrice === null ||
    volume === null ||
    closeTime === null ||
    changePercent === null
  ) {
    throw new BinanceError(`Ticker payload for ${raw.symbol} is incomplete`)
  }

  return {
    symbol: raw.symbol,
    lastPrice,
    openPrice,
    highPrice,
    lowPrice,
    volume,
    priceChangePercent: changePercent,
    closeTime,
  }
}

/* ------------------------------------------------------------------ */
/* Fetching                                                           */
/* ------------------------------------------------------------------ */

export async function fetchKlines(
  symbol: MarketSymbol | string,
  interval: Interval,
  limit = 120,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const safeLimit = Math.min(1000, Math.max(1, Math.trunc(limit)))
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(safeLimit),
  })

  const payload = await restGet(`/api/v3/klines?${params.toString()}`, signal)
  const candles = parseKlines(payload)

  if (candles.length === 0) {
    throw new BinanceError(`No candles returned for ${symbol} ${interval}`)
  }

  return candles
}

/**
 * Fetches historical candles inside a closed time range, paginating through
 * Binance's 1,000-row limit. Duplicate timestamps are removed. This is a
 * public, unauthenticated endpoint — no credentials involved.
 */
export async function fetchKlinesRange(
  symbol: MarketSymbol | string,
  interval: Interval,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
  maxCandles = 25_000,
): Promise<Candle[]> {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
    throw new BinanceError('A valid historical start and end time are required.')
  }

  const cap = Math.min(25_000, Math.max(1, Math.trunc(maxCandles)))
  const candles: Candle[] = []
  const seen = new Set<number>()
  let cursor = Math.trunc(startTime)

  while (candles.length < cap && cursor <= endTime) {
    const remaining = cap - candles.length
    const limit = Math.min(1000, remaining)
    const params = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(Math.trunc(endTime)),
      limit: String(limit),
    })

    const payload = await restGet(`/api/v3/klines?${params.toString()}`, signal)
    const batch = parseKlines(payload).filter((candle) => candle.openTime <= endTime)
    if (batch.length === 0) break

    let added = 0
    for (const candle of batch) {
      if (seen.has(candle.openTime)) continue
      seen.add(candle.openTime)
      candles.push(candle)
      added += 1
      if (candles.length >= cap) break
    }

    if (added === 0) break
    const next = batch[batch.length - 1].openTime + 1
    if (next <= cursor) break
    cursor = next

    if (batch.length < limit) break
  }

  if (candles.length === 0) {
    throw new BinanceError(`No historical candles returned for ${symbol} ${interval}.`)
  }

  return candles
}

export async function fetchTickers24h(
  symbols: readonly string[],
  signal?: AbortSignal,
): Promise<Ticker24h[]> {
  if (symbols.length === 0) return []

  const params = new URLSearchParams({
    symbols: JSON.stringify([...symbols]),
  })

  const payload = await restGet(`/api/v3/ticker/24hr?${params.toString()}`, signal)
  if (!Array.isArray(payload)) {
    throw new BinanceError('Unexpected tickers payload')
  }

  return payload.map(parseTicker24h)
}
