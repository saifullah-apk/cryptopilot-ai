import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Feedback'
import { Icon } from '../ui/Icon'
import { usePaperState } from '../../paper/PaperStateProvider'
import { formatClock, formatMoney, formatPrice } from '../../lib/format'
import { pnlTone } from '../../lib/paperTrading'

type ActivityEntry = {
  id: string
  icon: 'check' | 'close' | 'alert' | 'trend'
  tone: 'pos' | 'neg' | 'neutral'
  title: string
  detail: string
  at: number
  tag: string
}

/** Recent paper-trading decisions and fills — live engine data. */
export function RecentActivity() {
  const { state } = usePaperState()

  const entries: ActivityEntry[] = []

  for (const signal of state?.signals ?? []) {
    if (signal.status === 'pending') continue
    entries.push({
      id: `signal-${signal.id}`,
      icon: signal.status === 'approved' ? 'check' : signal.status === 'rejected' ? 'close' : 'alert',
      tone:
        signal.status === 'approved' ? 'pos' : signal.status === 'rejected' ? 'neutral' : 'neg',
      title: `${signal.symbol} ${signal.interval} signal ${signal.status}`,
      detail:
        signal.status === 'approved'
          ? `${signal.action} approved · stop ${formatPrice(signal.stopLoss)} · target ${formatPrice(signal.takeProfit)}`
          : signal.decisionNote ?? `${signal.action} · no trade taken`,
      at: signal.decidedAt ?? signal.createdAt,
      tag: 'paper',
    })
  }

  for (const position of state?.closedPositions ?? []) {
    entries.push({
      id: `closed-${position.id}`,
      icon: 'trend',
      tone: pnlTone(position.realizedPnl),
      title: `${position.symbol} ${position.side} closed ${formatMoney(position.realizedPnl)}`,
      detail: `${position.exitReason ?? 'exit'} @ ${formatPrice(position.exitPrice)} · fees ${formatMoney(position.fees)}`,
      at: position.closedAt ?? position.openedAt,
      tag: 'fill',
    })
  }

  entries.sort((a, b) => b.at - a.at)
  const visible = entries.slice(0, 6)

  return (
    <Card className="animate-in">
      <CardHead
        title="Recent activity"
        badge={state ? <Badge tone="live" pulse>Live paper</Badge> : <Badge tone="neutral">loading</Badge>}
        actions={<Badge tone="neutral">{entries.length} events</Badge>}
      />
      <CardBody flush>
        {visible.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No activity yet"
            description="Signal decisions and simulated fills appear here as soon as you review your first signal."
          />
        ) : (
          <ul>
            {visible.map((entry) => (
              <li className="activity-row" key={entry.id}>
                <span
                  className={`activity__icon${
                    entry.tone === 'neutral' ? '' : ` activity__icon--${entry.tone}`
                  }`}
                >
                  <Icon name={entry.icon} size={16} />
                </span>

                <span className="activity__body">
                  <span className="activity__title">{entry.title}</span>
                  <br />
                  <span className="activity__sub">{entry.detail}</span>
                </span>

                <span className="activity__time">
                  {formatClock(entry.at)}
                  <br />
                  <span className="dim">{entry.tag}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardFoot>
        Every entry comes from the paper engine — simulated decisions and fills only, no real
        orders.
      </CardFoot>
    </Card>
  )
}
