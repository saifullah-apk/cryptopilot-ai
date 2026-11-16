import type { IconName } from './components/ui/Icon'

export type NavGroup = {
  label: string
  items: NavItem[]
}

export type NavItem = {
  to: string
  label: string
  icon: IconName
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/markets', label: 'Markets', icon: 'candles' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/coach', label: 'AI Coach', icon: 'spark' },
      { to: '/analytics', label: 'Analytics', icon: 'chart' },
      { to: '/backtest', label: 'Backtest', icon: 'flask' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { to: '/portfolio', label: 'Portfolio', icon: 'wallet' },
      { to: '/paper-trading', label: 'Paper Trading', icon: 'flask' },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: 'settings' }],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export function pageTitle(pathname: string): string {
  const match = NAV_ITEMS.find(
    (item) => item.to === pathname || (item.to !== '/' && pathname.startsWith(item.to)),
  )
  return match?.label ?? 'Not found'
}

export function isCurrent(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}
