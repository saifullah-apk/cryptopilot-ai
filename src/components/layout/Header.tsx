import { useLocation } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { pageTitle } from '../../navigation'
import { NotificationBell } from '../../notifications/NotificationBell'

type HeaderProps = {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenMenu: () => void
}

export function Header({ theme, onToggleTheme, onOpenMenu }: HeaderProps) {
  const { pathname } = useLocation()
  const title = pageTitle(pathname)

  return (
    <header className="header">
      <button
        type="button"
        className="icon-btn menu-btn"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
      >
        <Icon name="menu" size={19} />
      </button>

      <div className="header__title">
        <div className="header__crumbs">
          <span>CryptoPilot AI</span>
          <Icon name="chevronRight" size={11} />
          <span>{title}</span>
        </div>
        <h1>{title}</h1>
      </div>

      <div className="header__actions">
        <span className="badge badge--demo">Demo build</span>

        <NotificationBell />

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={
            theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
          }
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>

        <span className="header__divider" aria-hidden="true" />

        <div className="profile" title="Local demo session — no account connected">
          <span className="avatar" aria-hidden="true">
            CP
          </span>
          <span className="profile__meta">
            <span className="profile__name">Guest Trader</span>
            <span className="profile__role">Demo session</span>
          </span>
        </div>
      </div>
    </header>
  )
}
