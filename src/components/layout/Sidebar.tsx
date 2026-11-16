import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { NAV_GROUPS, isCurrent } from '../../navigation'

type SidebarProps = {
  open: boolean
  onNavigate: () => void
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { pathname } = useLocation()

  return (
    <nav
      className={`sidebar${open ? ' is-open' : ''}`}
      aria-label="Primary"
    >
      <div className="sidebar__brand">
        <span className="brand-mark">
          <Icon name="logo" size={17} strokeWidth={2.2} />
        </span>
        <span className="brand-name">
          CryptoPilot <span>AI</span>
        </span>
      </div>

      <div className="sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group__label eyebrow">{group.label}</div>
            <ul>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={`nav-link${isCurrent(pathname, item.to) ? ' is-active' : ''}`}
                    aria-current={isCurrent(pathname, item.to) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={17} />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <div className="safety-note">
          <Icon name="shield" size={15} />
          <span>
            <strong>Paper trading only</strong>
            No real orders, no withdrawals, no live funds in this build.
          </span>
        </div>
      </div>
    </nav>
  )
}
