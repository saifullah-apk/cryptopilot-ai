import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { MarketsPage } from './pages/MarketsPage'
import { CoachPage } from './pages/CoachPage'
import { PaperTradingPage } from './pages/PaperTradingPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { BacktestPage } from './pages/BacktestPage'
import { NotFoundPage, SettingsPage } from './pages/PlaceholderPages'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="markets" element={<MarketsPage />} />
          <Route path="coach" element={<CoachPage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="paper-trading" element={<PaperTradingPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="backtest" element={<BacktestPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
