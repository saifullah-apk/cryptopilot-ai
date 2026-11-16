import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useTheme } from '../../hooks/useTheme'
import { MarketDataProvider } from '../../market/MarketDataProvider'
import { PaperStateProvider } from '../../paper/PaperStateProvider'
import { NotificationProvider } from '../../notifications/NotificationProvider'
import { NotificationToasts } from '../../notifications/NotificationToasts'

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // Close on Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <div className="app">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />

      {menuOpen ? (
        <div
          className="overlay"
          onClick={() => setMenuOpen(false)}
          role="presentation"
        />
      ) : null}

      <div className="main-col">
        <MarketDataProvider>
          <PaperStateProvider>
            <NotificationProvider>
              <Header
                theme={theme}
                onToggleTheme={toggleTheme}
                onOpenMenu={() => setMenuOpen(true)}
              />
              <main className="page" id="main">
                <Outlet />
              </main>
              <NotificationToasts />
            </NotificationProvider>
          </PaperStateProvider>
        </MarketDataProvider>
      </div>
    </div>
  )
}
