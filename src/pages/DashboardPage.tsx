import { Notice } from '../components/ui/Feedback'
import { PortfolioOverview } from '../components/dashboard/PortfolioOverview'
import { MarketChart } from '../components/dashboard/MarketChart'
import { AICoachPreview } from '../components/dashboard/AICoachPreview'
import { MarketWatchlist } from '../components/dashboard/MarketWatchlist'
import { TradingSignals } from '../components/dashboard/TradingSignals'
import { RecentActivity } from '../components/dashboard/RecentActivity'

export function DashboardPage() {
  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Overview</div>
          <h1 style={{ marginTop: 4 }}>Trading cockpit</h1>
          <p>
            Live market data, your virtual paper account and AI-assisted signals. Everything you
            approve here is simulated — nothing touches a real exchange.
          </p>
        </div>
        <Notice tone="ai" icon="shield">
          Paper trading only. No live orders or withdrawals.
        </Notice>
      </div>

      <PortfolioOverview />

      <div className="dash-grid">
        <div className="span-2">
          <MarketChart />
        </div>
        <AICoachPreview />

        <div className="span-2">
          <MarketWatchlist />
        </div>
        <TradingSignals />

        <div className="span-3">
          <RecentActivity />
        </div>
      </div>
    </>
  )
}
