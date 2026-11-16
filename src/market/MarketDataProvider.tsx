import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  MarketStream,
  isStale,
  type ConnectionState,
  type MiniTicker,
} from '../lib/binanceSocket'
import { MARKET_SYMBOLS } from '../lib/binance'

type MarketFeedValue = {
  tickers: Record<string, MiniTicker>
  connection: ConnectionState
  stale: boolean
  lastMessageAt: number | null
  reconnect: () => void
}

const MarketFeedContext = createContext<MarketFeedValue | null>(null)

/**
 * Owns the single public Binance WebSocket used across the app and derives
 * liveness/staleness from it. Mounted once in the app shell.
 */
export function MarketDataProvider({ children }: { children: ReactNode }) {
  const [tickers, setTickers] = useState<Record<string, MiniTicker>>({})
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)
  const [stale, setStale] = useState(true)

  const streamRef = useRef<MarketStream | null>(null)
  const lastAtRef = useRef<number | null>(null)
  const lastWatchdogRef = useRef(Date.now())

  useEffect(() => {
    const stream = new MarketStream({
      symbols: MARKET_SYMBOLS,
      onTicker: (ticker) => {
        const now = Date.now()
        lastAtRef.current = now
        setLastMessageAt(now)
        setStale(false)
        setTickers((current) => ({ ...current, [ticker.symbol]: ticker }))
      },
      onState: setConnection,
      onError: () => {
        /* Reconnection is handled by the stream; errors are surfaced via state. */
      },
    })

    streamRef.current = stream
    stream.connect()

    // Stale detection: no message within the threshold means the feed is dead.
    const timer = window.setInterval(() => {
      setStale(isStale(lastAtRef.current, Date.now()))
    }, 5_000)

    const onOnline = () => stream.reconnectNow()
    window.addEventListener('online', onOnline)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      stream.close()
      streamRef.current = null
    }
  }, [])

  const reconnect = useCallback(() => {
    streamRef.current?.reconnectNow()
  }, [])

  // Watchdog: a socket can stay "open" while the feed is dead. When the
  // data is stale, force a reconnect (throttled so a bad upstream cannot
  // cause a reconnect storm).
  useEffect(() => {
    if (!stale || connection !== 'open') return
    const now = Date.now()
    if (now - lastWatchdogRef.current < 30_000) return
    lastWatchdogRef.current = now
    streamRef.current?.reconnectNow()
  }, [stale, connection])

  const value = useMemo<MarketFeedValue>(
    () => ({ tickers, connection, stale, lastMessageAt, reconnect }),
    [tickers, connection, stale, lastMessageAt, reconnect],
  )

  return <MarketFeedContext.Provider value={value}>{children}</MarketFeedContext.Provider>
}

export function useMarketFeed(): MarketFeedValue {
  const value = useContext(MarketFeedContext)
  if (!value) {
    throw new Error('useMarketFeed must be used inside <MarketDataProvider>')
  }
  return value
}
