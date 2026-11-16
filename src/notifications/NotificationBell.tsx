import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '../components/ui/Icon'
import { useNotifications } from './NotificationProvider'
import { formatClock } from '../lib/format'
import {
  EMAIL_NOTIFICATIONS_AVAILABLE,
  KIND_LABELS,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from '../lib/notifications'

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

const THRESHOLDS = [
  { key: 'priceMovePct', label: 'Price move alert', hint: '% from reference', min: 0.1, max: 25, step: 0.1 },
  { key: 'volatilityPct', label: 'High volatility', hint: '% 24h range', min: 0.5, max: 50, step: 0.5 },
  { key: 'stopWarnPct', label: 'Stop-loss warning', hint: '% from stop', min: 0.1, max: 10, step: 0.1 },
  { key: 'equityMovePct', label: 'Equity drift', hint: '% change', min: 0.1, max: 25, step: 0.1 },
] as const

type ThresholdKey = (typeof THRESHOLDS)[number]['key']

/**
 * Header bell: unread badge, notification list, and the preferences
 * panel (channels, per-kind toggles, thresholds).
 */
export function NotificationBell() {
  const {
    notifications,
    unread,
    prefs,
    browserPermission,
    updatePrefs,
    enableBrowser,
    disableBrowser,
    refreshBrowserPermission,
    markAllRead,
    clear,
    remove,
  } = useNotifications()

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'alerts' | 'prefs'>('alerts')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    refreshBrowserPermission()

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, refreshBrowserPermission])

  const browserRow = () => {
    if (browserPermission === 'unsupported') {
      return (
        <label className="notif-prefs__row notif-prefs__row--muted">
          <input type="checkbox" disabled />
          <span>
            Browser notifications
            <small>Not supported by this browser.</small>
          </span>
        </label>
      )
    }
    if (browserPermission === 'denied') {
      return (
        <p className="notif-prefs__note">
          Browser notifications are blocked. Allow notifications for this site in
          your browser settings, then toggle them back on here.
        </p>
      )
    }
    if (prefs.browser && browserPermission === 'granted') {
      return (
        <label className="notif-prefs__row">
          <input
            type="checkbox"
            checked
            onChange={() => disableBrowser()}
          />
          <span>
            Browser notifications
            <small>Delivered by your OS while the tab is open.</small>
          </span>
        </label>
      )
    }
    return (
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => void enableBrowser()}
      >
        Enable browser notifications
      </button>
    )
  }

  return (
    <div className="notif" ref={containerRef}>
      <button
        type="button"
        className={`icon-btn notif-bell${unread > 0 ? ' notif-bell--unread' : ''}`}
        aria-label={
          unread > 0
            ? `Notifications (${unread} unread)`
            : 'Notifications'
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 ? (
          <span className="notif-bell__badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel__head">
            <div className="notif-panel__tabs" role="tablist" aria-label="Notification view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'alerts'}
                className={tab === 'alerts' ? 'is-active' : ''}
                onClick={() => setTab('alerts')}
              >
                Alerts
                {unread > 0 ? <span className="notif-panel__count">{unread}</span> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'prefs'}
                className={tab === 'prefs' ? 'is-active' : ''}
                onClick={() => setTab('prefs')}
              >
                Preferences
              </button>
            </div>
            {tab === 'alerts' && notifications.length > 0 ? (
              <div className="notif-panel__tools">
                <button type="button" className="link-btn" onClick={markAllRead}>
                  Mark all read
                </button>
                <button type="button" className="link-btn" onClick={clear}>
                  Clear
                </button>
              </div>
            ) : null}
          </div>

          {tab === 'alerts' ? (
            <div className="notif-panel__list">
              {notifications.length === 0 ? (
                <p className="notif-panel__empty">
                  No alerts yet. Price moves, new signals, volatility and account
                  events will show up here.
                </p>
              ) : (
                <ul>
                  {notifications.map((item) => (
                    <li
                      key={item.id}
                      className={`notif-item notif-item--${item.severity}${
                        item.read ? '' : ' notif-item--unread'
                      }`}
                    >
                      <span className="notif-item__icon" aria-hidden="true">
                        <Icon name={KIND_ICONS[item.kind]} size={15} />
                      </span>
                      <div className="notif-item__body">
                        <div className="notif-item__title">
                          {item.href ? (
                            <Link
                              to={item.href}
                              onClick={() => setOpen(false)}
                            >
                              {item.title}
                            </Link>
                          ) : (
                            item.title
                          )}
                          <time dateTime={new Date(item.at).toISOString()}>
                            {formatClock(item.at)}
                          </time>
                        </div>
                        <p>{item.body}</p>
                        <span className="notif-item__kind">
                          {KIND_LABELS[item.kind]}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="notif-item__dismiss"
                        aria-label={`Dismiss: ${item.title}`}
                        onClick={() => remove(item.id)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="notif-prefs">
              <fieldset>
                <legend>Channels</legend>
                <label className="notif-prefs__row">
                  <input
                    type="checkbox"
                    checked={prefs.inApp}
                    onChange={(event) =>
                      updatePrefs((previous) => ({
                        ...previous,
                        inApp: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    In-app notifications
                    <small>Bell badge and toast pop-ups.</small>
                  </span>
                </label>
                {browserRow()}
                <label
                  className={`notif-prefs__row notif-prefs__row--muted${
                    EMAIL_NOTIFICATIONS_AVAILABLE ? '' : ' notif-prefs__row--off'
                  }`}
                >
                  <input type="checkbox" disabled={!EMAIL_NOTIFICATIONS_AVAILABLE} />
                  <span>
                    Email notifications
                    <small>
                      {EMAIL_NOTIFICATIONS_AVAILABLE
                        ? 'Send alerts to your inbox.'
                        : 'Unavailable — no mail service is configured in this build.'}
                    </small>
                  </span>
                </label>
              </fieldset>

              <fieldset>
                <legend>Alert types</legend>
                {NOTIFICATION_KINDS.map((kind) => (
                  <label className="notif-prefs__row" key={kind}>
                    <input
                      type="checkbox"
                      checked={prefs.kinds[kind]}
                      onChange={(event) =>
                        updatePrefs((previous) => ({
                          ...previous,
                          kinds: { ...previous.kinds, [kind]: event.target.checked },
                        }))
                      }
                    />
                    <span>{KIND_LABELS[kind]}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset>
                <legend>Thresholds</legend>
                {THRESHOLDS.map((threshold) => (
                  <label className="notif-prefs__field" key={threshold.key}>
                    <span>
                      {threshold.label}
                      <small>{threshold.hint}</small>
                    </span>
                    <input
                      type="number"
                      min={threshold.min}
                      max={threshold.max}
                      step={threshold.step}
                      value={prefs[threshold.key as ThresholdKey]}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        updatePrefs((previous) => ({
                          ...previous,
                          [threshold.key]: value,
                        }))
                      }}
                    />
                  </label>
                ))}
                <p className="notif-prefs__note">
                  Alerts are generated only from live market data and your paper
                  account — never simulated for effect.
                </p>
              </fieldset>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
