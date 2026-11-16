import { useEffect, useState } from 'react'

import { Icon } from '../components/ui/Icon'
import { useNotifications } from './NotificationProvider'
import { type NotificationKind } from '../lib/notifications'

const TOAST_DURATION_MS = 6_000

const KIND_ICONS: Record<NotificationKind, string> = {
  price: 'spark',
  signal: 'star',
  pnl: 'wallet',
  'stop-loss': 'alert',
  'take-profit': 'check',
  volatility: 'alert',
  disconnect: 'refresh',
  stale: 'clock',
  daily: 'info',
}

/**
 * Auto-dismissing toast stack for new notifications. Pauses while hovered
 * or focused so a message can always be read; announced politely to
 * screen readers.
 */
export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications()
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || toasts.length === 0) return
    const oldest = toasts[toasts.length - 1]
    const remaining = Math.max(
      500,
      TOAST_DURATION_MS - (Date.now() - oldest.at),
    )
    const timer = window.setTimeout(() => dismissToast(oldest.id), remaining)
    return () => window.clearTimeout(timer)
  }, [toasts, paused, dismissToast])

  if (toasts.length === 0) return null

  return (
    <div
      className="toasts"
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.severity}`}
          data-kind={toast.kind}
        >
          <span className="toast__icon" aria-hidden="true">
            <Icon name={KIND_ICONS[toast.kind]} size={16} />
          </span>
          <div className="toast__body">
            <strong>{toast.title}</strong>
            <p>{toast.body}</p>
          </div>
          <button
            type="button"
            className="toast__dismiss"
            aria-label={`Dismiss: ${toast.title}`}
            onClick={() => dismissToast(toast.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
