import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchKlines, type Candle, type Interval } from '../lib/binance'

const REFRESH_MS = 30_000

type KlineStatus = 'loading' | 'ready' | 'error'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'Request timed out. Binance did not respond.'
    return error.message
  }
  return 'Unable to load candles from Binance'
}

/**
 * Loads historical OHLCV candles and refreshes them periodically.
 * Candles are kept while switching only the refresh, so the chart does not
 * flash a skeleton on every poll.
 */
export function useKlines(symbol: string, interval: Interval, limit = 180) {
  const [candles, setCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<KlineStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const key = `${symbol}:${interval}`
  const activeKeyRef = useRef<string>('')

  useEffect(() => {
    const controller = new AbortController()
    const isNewSeries = activeKeyRef.current !== key
    activeKeyRef.current = key

    if (isNewSeries) {
      setStatus('loading')
      setError(null)
    }

    fetchKlines(symbol, interval, limit, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setCandles(rows)
        setStatus('ready')
        setError(null)
        setLastUpdated(Date.now())
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(toMessage(reason))
        setStatus('error')
      })

    return () => controller.abort()
  }, [symbol, interval, limit, key, refreshToken])

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  // Background poll keeps historical candles current between WebSocket ticks.
  useEffect(() => {
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  return { candles, status, error, lastUpdated, refresh }
}
