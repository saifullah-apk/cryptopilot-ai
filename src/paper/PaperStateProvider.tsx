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

import type { PaperState } from '../lib/paperTrading'
import {
  approveSignalRequest,
  closePositionRequest,
  fetchPaperState,
  generateSignalRequest,
  PaperApiError,
  rejectSignalRequest,
  setPausedRequest,
} from '../lib/paperApi'

const POLL_INTERVAL_MS = 20_000

type NoticeTone = 'pos' | 'neg' | 'ai' | 'neutral' | 'warn'

type Notice = {
  tone: NoticeTone
  text: string
}

type PaperFeedValue = {
  state: PaperState | null
  /** True until the first successful load (or after a total failure). */
  loading: boolean
  /** Non-fatal error from the most recent poll. */
  error: string | null
  /** Error from the most recent user action (approve/reject/…). */
  actionError: string | null
  /** Short success/failure banner text after a user action. */
  notice: Notice | null
  /** True while any mutation is in flight. */
  busy: boolean
  lastUpdatedAt: number | null
  refresh: () => Promise<void>
  generate: (symbol: string, interval: string) => Promise<boolean>
  approve: (signalId: string, riskPct: number) => Promise<boolean>
  reject: (signalId: string) => Promise<boolean>
  close: (positionId: string) => Promise<boolean>
  setPaused: (paused: boolean) => Promise<boolean>
  clearActionError: () => void
  dismissNotice: () => void
}

const PaperContext = createContext<PaperFeedValue | null>(null)

/**
 * Polls the paper-trading API and exposes review actions to the dashboard
 * and the paper page. Mounted once in the app shell.
 */
export function PaperStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PaperState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)

  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const next = await fetchPaperState()
      if (!mountedRef.current) return
      setState(next)
      setError(null)
      setLastUpdatedAt(Date.now())
    } catch (caught) {
      if (!mountedRef.current) return
      const message =
        caught instanceof PaperApiError ? caught.message : 'Unable to load paper-trading state.'
      setError(message)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const runAction = useCallback(
    async (
      fn: () => Promise<PaperState>,
      onSuccess: (next: PaperState) => Notice,
    ): Promise<boolean> => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      try {
        const next = await fn()
        if (!mountedRef.current) return false
        setState(next)
        setLastUpdatedAt(Date.now())
        setNotice(onSuccess(next))
        return true
      } catch (caught) {
        if (!mountedRef.current) return false
        const message =
          caught instanceof PaperApiError
            ? caught.message
            : 'The request failed. Please try again.'
        setActionError(message)
        setNotice({ tone: 'neg', text: message })
        return false
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    },
    [],
  )

  const generate = useCallback(
    async (symbol: string, interval: string): Promise<boolean> => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      try {
        const result = await generateSignalRequest(symbol, interval)
        const next = await fetchPaperState()
        if (!mountedRef.current) return false
        setState(next)
        setLastUpdatedAt(Date.now())
        const label =
          result.signal.action === 'NO TRADE'
            ? 'no trade'
            : result.signal.action
        setNotice({
          tone: result.signal.action === 'BUY' ? 'pos' : result.signal.action === 'SELL' ? 'neg' : 'neutral',
          text: `New signal: ${result.signal.symbol} ${result.signal.interval} → ${label}. Review it below.`,
        })
        return true
      } catch (caught) {
        if (!mountedRef.current) return false
        const message =
          caught instanceof PaperApiError
            ? caught.message
            : 'Signal generation failed. Please try again.'
        setActionError(message)
        setNotice({ tone: 'neg', text: message })
        return false
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    },
    [],
  )

  const approve = useCallback(
    (signalId: string, riskPct: number) =>
      runAction(
        async () => (await approveSignalRequest(signalId, riskPct)).state,
        () => ({
          tone: 'pos',
          text: 'Signal approved — a virtual position was opened with a mandatory stop-loss.',
        }),
      ),
    [runAction],
  )

  const reject = useCallback(
    (signalId: string) =>
      runAction(
        () => rejectSignalRequest(signalId),
        () => ({ tone: 'neutral', text: 'Signal rejected — no trade was taken.' }),
      ),
    [runAction],
  )

  const close = useCallback(
    (positionId: string) =>
      runAction(
        () => closePositionRequest(positionId),
        () => ({ tone: 'neutral', text: 'Position closed at the current market price.' }),
      ),
    [runAction],
  )

  const setPaused = useCallback(
    (paused: boolean) =>
      runAction(
        () => setPausedRequest(paused),
        (next) => ({
          tone: next.account.paused ? 'warn' : 'pos',
          text: next.account.paused
            ? 'Emergency pause ON — new approvals are blocked until you resume.'
            : 'Paper trading resumed — approvals are allowed again.',
        }),
      ),
    [runAction],
  )

  const clearActionError = useCallback(() => setActionError(null), [])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const value = useMemo<PaperFeedValue>(
    () => ({
      state,
      loading,
      error,
      actionError,
      notice,
      busy,
      lastUpdatedAt,
      refresh,
      generate,
      approve,
      reject,
      close,
      setPaused,
      clearActionError,
      dismissNotice,
    }),
    [
      state,
      loading,
      error,
      actionError,
      notice,
      busy,
      lastUpdatedAt,
      refresh,
      generate,
      approve,
      reject,
      close,
      setPaused,
      clearActionError,
      dismissNotice,
    ],
  )

  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>
}

export function usePaperState(): PaperFeedValue {
  const value = useContext(PaperContext)
  if (!value) {
    throw new Error('usePaperState must be used inside <PaperStateProvider>')
  }
  return value
}
