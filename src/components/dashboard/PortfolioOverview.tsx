import { StatCard } from '../ui/StatCard'
import { Badge } from '../ui/Badge'
import { formatMoney } from '../../lib/format'
import { pnlTone } from '../../lib/paperTrading'
import { usePaperState } from '../../paper/PaperStateProvider'

/**
 * Portfolio overview — live virtual paper account. Values come from the
 * paper-trading engine (verified Binance marks); no demo numbers here.
 */
export function PortfolioOverview() {
  const { state } = usePaperState()
  const account = state?.account ?? null

  if (!account) {
    return (
      <div className="stat-grid stagger">
        <StatCard label="Equity" value={null} icon="wallet" iconTone="ai" />
        <StatCard label="Realised P&L" value={null} icon="trend" />
        <StatCard label="Unrealised P&L" value={null} icon="activity" />
        <StatCard label="Open positions" value={null} icon="candles" />
      </div>
    )
  }

  const overall = account.equity - account.startingBalance
  const overallTone = pnlTone(account.unrealizedPnl === null ? null : overall)

  return (
    <div className="stat-grid stagger">
      <StatCard
        label="Equity"
        value={formatMoney(account.equity)}
        delta={`${formatMoney(overall)} since start`}
        deltaTone={overallTone}
        note={`Cash ${formatMoney(account.cash)} · starting ${formatMoney(account.startingBalance)}`}
        icon="wallet"
        iconTone="ai"
        badge={<Badge tone="live">Paper</Badge>}
      />
      <StatCard
        label="Realised P&L"
        value={formatMoney(account.realizedPnl)}
        delta={`${account.wins}W / ${account.losses}L over ${account.closedTrades} trades`}
        deltaTone={pnlTone(account.realizedPnl)}
        note={
          account.winRate === null
            ? 'Appears after the first closed trade'
            : `Win rate ${account.winRate}% — not a prediction`
        }
        icon="trend"
        badge={<Badge tone="live">Paper</Badge>}
      />
      <StatCard
        label="Unrealised P&L"
        value={account.unrealizedPnl === null ? null : formatMoney(account.unrealizedPnl)}
        delta={`${account.openPositionsCount}/${account.maxOpenPositions} open`}
        note={
          account.unrealizedPnl === null
            ? 'Waiting for verified marks'
            : 'Marked with live Binance public prices'
        }
        icon="activity"
        badge={<Badge tone="live">Paper</Badge>}
      />
      <StatCard
        label="Daily loss"
        value={formatMoney(account.dailyLoss)}
        delta={`Limit ${formatMoney(account.dailyLossLimit)}`}
        deltaTone={account.dailyLoss > 0 ? 'neg' : 'neutral'}
        note={account.paused ? 'Emergency pause is ON' : `Resets 00:00 UTC · ${account.dailyLossLimitPct}% cap`}
        icon="shield"
        badge={account.paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="live">Paper</Badge>}
      />
    </div>
  )
}
