/**
 * Binance public WebSocket stream with automatic reconnection.
 *
 * Uses the combined `<symbol>@miniTicker` streams from the public
 * market-data host. No listen key, no account stream, no authentication.
 */

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed'

export type MiniTicker = {
  symbol: string
  last: number
  open: number
  high: number
  low: number
  volume: number
  eventTime: number
}

/** miniTicker pushes roughly every second; 20s of silence means a dead feed. */
export const STALE_AFTER_MS = 20_000

const WS_HOSTS = [
  'wss://data-stream.binance.vision/stream',
  'wss://stream.binance.com:9443/stream',
] as const

export function streamUrl(hostIndex: number, symbols: readonly string[]): string {
  const host = WS_HOSTS[Math.abs(hostIndex) % WS_HOSTS.length]
  const streams = symbols.map((symbol) => `${symbol.toLowerCase()}@miniTicker`).join('/')
  return `${host}?streams=${streams}`
}

/** Parses a combined-stream frame. Control frames and bad data return null. */
export function parseStreamMessage(raw: unknown): MiniTicker | null {
  if (typeof raw !== 'string' || raw.length === 0) return null

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null

  const frame = data as Record<string, unknown>
  if (frame.e !== '24hrMiniTicker' || typeof frame.s !== 'string') return null

  const last = Number(frame.c)
  const open = Number(frame.o)
  const high = Number(frame.h)
  const low = Number(frame.l)
  const volume = Number(frame.v)
  const eventTime = Number(frame.E)

  if (![last, open, high, low, volume, eventTime].every(Number.isFinite)) {
    return null
  }

  return { symbol: frame.s, last, open, high, low, volume, eventTime }
}

/**
 * Exponential backoff with 20% jitter, capped at `maxMs`.
 * `attempt` is zero-based.
 */
export function nextReconnectDelay(
  attempt: number,
  baseMs = 1_000,
  maxMs = 30_000,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const jitter = capped * 0.2 * Math.min(1, Math.max(0, random()))
  return Math.round(capped * 0.8 + jitter)
}

/** True when no message has arrived within the threshold. */
export function isStale(
  lastMessageAt: number | null,
  now = Date.now(),
  thresholdMs = STALE_AFTER_MS,
): boolean {
  if (lastMessageAt === null) return true
  return now - lastMessageAt > thresholdMs
}

/* ------------------------------------------------------------------ */
/* Reconnecting stream                                                */
/* ------------------------------------------------------------------ */

/** Minimal socket surface so tests can inject a fake. */
export interface SocketLike {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close: () => void
}

export type MarketStreamOptions = {
  symbols: readonly string[]
  onTicker: (ticker: MiniTicker) => void
  onState?: (state: ConnectionState) => void
  onError?: (error: Error) => void
  /** Injectable for tests. Defaults to the browser WebSocket. */
  createSocket?: (url: string) => SocketLike
  baseDelayMs?: number
  maxDelayMs?: number
  random?: () => number
}

export class MarketStream {
  private readonly symbols: readonly string[]
  private readonly onTicker: (ticker: MiniTicker) => void
  private readonly onState: (state: ConnectionState) => void
  private readonly onError: (error: Error) => void
  private readonly createSocket: (url: string) => SocketLike
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly random: () => number

  private socket: SocketLike | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private hostIndex = 0
  private stopped = true
  private state: ConnectionState = 'closed'

  constructor(options: MarketStreamOptions) {
    this.symbols = options.symbols
    this.onTicker = options.onTicker
    this.onState = options.onState ?? (() => {})
    this.onError = options.onError ?? (() => {})
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url))
    this.baseDelayMs = options.baseDelayMs ?? 1_000
    this.maxDelayMs = options.maxDelayMs ?? 30_000
    this.random = options.random ?? Math.random
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  connect(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempts = 0
    this.open()
  }

  /** Force an immediate retry (used when the browser comes back online). */
  reconnectNow(): void {
    if (this.stopped) return
    this.clearTimer()
    this.teardown()
    this.attempts = 0
    this.open()
  }

  close(): void {
    this.stopped = true
    this.clearTimer()
    this.teardown()
    this.setState('closed')
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.onState(state)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private teardown(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }

  private open(): void {
    if (this.stopped) return

    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting')

    let socket: SocketLike
    try {
      socket = this.createSocket(streamUrl(this.hostIndex, this.symbols))
    } catch (error) {
      this.reportError(error, 'Unable to open Binance stream')
      this.scheduleReconnect()
      return
    }

    this.socket = socket

    socket.onopen = () => {
      this.attempts = 0
      this.setState('open')
    }

    socket.onmessage = (event) => {
      const ticker = parseStreamMessage(event.data)
      if (ticker) this.onTicker(ticker)
    }

    socket.onerror = () => {
      this.onError(new Error('Binance stream socket error'))
      // `onclose` follows on real sockets and drives the reconnect.
    }

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      if (this.stopped) return
      // Rotate hosts on every drop so a blocked host does not wedge the feed.
      this.hostIndex += 1
      this.scheduleReconnect()
    }
  }

  private reportError(error: unknown, fallback: string): void {
    this.onError(error instanceof Error ? error : new Error(fallback))
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.setState('reconnecting')
    const delay = nextReconnectDelay(
      this.attempts,
      this.baseDelayMs,
      this.maxDelayMs,
      this.random,
    )
    this.attempts += 1
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.open()
    }, delay)
  }
}
