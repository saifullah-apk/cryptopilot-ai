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

import { useMarketFeed } from '../market/MarketDataProvider'
import { usePaperState } from '../paper/PaperStateProvider'
import {
  dedupeNotifications,
  deliverBrowser,
  evaluateAlerts,
  getBrowserPermission,
  initialAlertState,
  loadPreferences,
  requestBrowserPermission,
  savePreferences,
  validatePreferences,
  type AlertState,
  type AppNotification,
  type BrowserCtor,
  type NotificationPreferences,
} from '../lib/notifications'

const MAX_STORED = 100
const DAY_TICK_MS = 60_000

type NotificationFeedValue = {
  notifications: AppNotification[]
  unread: number
  prefs: NotificationPreferences
  browserPermission: NotificationPermission | 'unsupported'
  /** Currently visible auto-dismiss toasts. */
  toasts: AppNotification[]
  updatePrefs: (updater: (previous: NotificationPreferences) => NotificationPreferences) => void
  /** Requests OS permission and enables/disables the browser channel. */
  enableBrowser: () => Promise<boolean>
  disableBrowser: () => void
  refreshBrowserPermission: () => void
  markAllRead: () => void
  markRead: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  dismissToast: (id: string) => void
}

const NotificationContext = createContext<NotificationFeedValue | null>(null)

/**
 * Watches the live market feed and paper-trading state, runs the pure
 * alert engine on every change, and delivers results to the in-app
 * channel (bell + toasts) and the browser channel. Mounted once, inside
 * both data providers.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { tickers, connection, stale } = useMarketFeed()
  const { state: paperState, error: paperError } = usePaperState()

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [toasts, setToasts] = useState<AppNotification[]>([])
  const [prefs, setPrefs] = useState<NotificationPreferences>(loadPreferences)
  const [browserPermission, setBrowserPermission] = useState(getBrowserPermission)
  const [dayTick, setDayTick] = useState(0)

  const alertStateRef = useRef<AlertState>(initialAlertState())
  const notificationsRef = useRef<AppNotification[]>([])
  const prefsRef = useRef(prefs)
  const permissionRef = useRef(browserPermission)
  const mountedRef = useRef(true)

  prefsRef.current = prefs
  permissionRef.current = browserPermission

  const browserCtorRef = useRef<BrowserCtor | null>(null)
  if (browserCtorRef.current === null && typeof Notification !== 'undefined') {
    browserCtorRef.current = Notification as unknown as BrowserCtor
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const commitNotifications = useCallback((next: AppNotification[]) => {
    notificationsRef.current = next
    if (mountedRef.current) setNotifications(next)
  }, [])

  /* -------------------- evaluate on every data change -------------------- */

  useEffect(() => {
    const market = { tickers, connection, stale }
    const paper = { state: paperState, error: paperError }

    const result = evaluateAlerts({
      market,
      paper,
      prefs: prefsRef.current,
      now: Date.now(),
      state: alertStateRef.current,
    })
    alertStateRef.current = result.state

    if (result.notifications.length === 0) return

    const fresh = dedupeNotifications(
      result.notifications,
      notificationsRef.current,
      Date.now(),
    )
    if (fresh.length === 0) return

    if (prefsRef.current.inApp) {
      const next = [...fresh, ...notificationsRef.current].slice(0, MAX_STORED)
      commitNotifications(next)
      setToasts((previous) => [...fresh, ...previous].slice(0, 3))
    }

    for (const notification of fresh) {
      deliverBrowser(
        notification,
        prefsRef.current,
        permissionRef.current,
        browserCtorRef.current,
      )
    }
  }, [
    tickers,
    connection,
    stale,
    paperState,
    paperError,
    dayTick,
    commitNotifications,
  ])

  // Daily-summary safety net: re-check at least once a minute even if the
  // tab receives no ticker messages (UTC day rollover).
  useEffect(() => {
    const timer = window.setInterval(() => setDayTick((value) => value + 1), DAY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  /* ------------------------------ preferences --------------------------- */

  const updatePrefs = useCallback(
    (updater: (previous: NotificationPreferences) => NotificationPreferences) => {
      setPrefs((previous) => {
        const next = validatePreferences(updater(previous))
        savePreferences(next)
        return next
      })
    },
    [],
  )

  const enableBrowser = useCallback(async (): Promise<boolean> => {
    const result = await requestBrowserPermission()
    setBrowserPermission(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'unsupported')
    if (result === 'granted') {
      updatePrefs((previous) => ({ ...previous, browser: true }))
      return true
    }
    updatePrefs((previous) => ({ ...previous, browser: false }))
    return false
  }, [updatePrefs])

  const disableBrowser = useCallback(() => {
    updatePrefs((previous) => ({ ...previous, browser: false }))
  }, [updatePrefs])

  const refreshBrowserPermission = useCallback(() => {
    setBrowserPermission(getBrowserPermission())
  }, [])

  /* --------------------------- list management -------------------------- */

  const markAllRead = useCallback(() => {
    const next = notificationsRef.current.map((item) =>
      item.read ? item : { ...item, read: true },
    )
    commitNotifications(next)
  }, [commitNotifications])

  const markRead = useCallback(
    (id: string) => {
      const next = notificationsRef.current.map((item) =>
        item.id === id && !item.read ? { ...item, read: true } : item,
      )
      commitNotifications(next)
    },
    [commitNotifications],
  )

  const remove = useCallback(
    (id: string) => {
      commitNotifications(notificationsRef.current.filter((item) => item.id !== id))
    },
    [commitNotifications],
  )

  const clear = useCallback(() => {
    commitNotifications([])
  }, [commitNotifications])

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const unread = useMemo(
    () => notifications.reduce((count, item) => (item.read ? count : count + 1), 0),
    [notifications],
  )

  const value = useMemo<NotificationFeedValue>(
    () => ({
      notifications,
      unread,
      prefs,
      browserPermission,
      toasts,
      updatePrefs,
      enableBrowser,
      disableBrowser,
      refreshBrowserPermission,
      markAllRead,
      markRead,
      remove,
      clear,
      dismissToast,
    }),
    [
      notifications,
      unread,
      prefs,
      browserPermission,
      toasts,
      updatePrefs,
      enableBrowser,
      disableBrowser,
      refreshBrowserPermission,
      markAllRead,
      markRead,
      remove,
      clear,
      dismissToast,
    ],
  )

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationFeedValue {
  const value = useContext(NotificationContext)
  if (!value) {
    throw new Error('useNotifications must be used inside <NotificationProvider>')
  }
  return value
}
