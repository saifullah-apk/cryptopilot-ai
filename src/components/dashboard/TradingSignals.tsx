import { Link } from 'react-router-dom'
import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/Feedback'
import { SignalCard } from '../paper/SignalCard'
import { usePaperState } from '../../paper/PaperStateProvider'

/** Live pending signals with approve/reject — real paper data, not demo. */
export function TradingSignals() {
  const { state, busy, approve, reject, error } = usePaperState()

  const pending = (state?.signals ?? []).filter((signal) => signal.status === 'pending')
  const recentDecided = (state?.signals ?? [])
    .filter((signal) => signal.status !== 'pending')
    .slice(0, 2)

  return (
    <Card className="animate-in">
      <CardHead
        title="Trading signals"
        badge={state ? <Badge tone="live" pulse>Live paper</Badge> : <Badge tone="neutral">loading</Badge>}
        actions={<Badge tone="neutral">{pending.length} pending</Badge>}
      />
      <CardBody>
        {error && !state ? (
          <EmptyState
            icon="alert"
            title="Signals unavailable"
            description={error}
          />
        ) : pending.length === 0 && recentDecided.length === 0 ? (
          <EmptyState
            icon="flask"
            title="No signals yet"
            description="Generate one from the Paper trading page — every signal is reviewed by you before it can become a trade."
            action={
              <Link className="btn btn--sm" to="/paper-trading">
                Open paper trading
              </Link>
            }
          />
        ) : (
          <div className="signal-stack">
            {pending.slice(0, 2).map((signal) => (
              <SignalCard
                key={signal.id}
                signal={signal}
                compact
                busy={busy}
                onApprove={(id) => void approve(id, 1)}
                onReject={(id) => void reject(id)}
              />
            ))}
            {pending.length === 0
              ? recentDecided.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} compact busy={busy} />
                ))
              : null}
          </div>
        )}
      </CardBody>
      <CardFoot>
        {pending.length > 0 ? (
          <>
            Review and approve on the{' '}
            <Link to="/paper-trading">paper trading page</Link>. Confidence is a setup score, not a
            win probability.
          </>
        ) : (
          <>
            Signals are educational until you approve them. Paper only — no real orders.
          </>
        )}
      </CardFoot>
    </Card>
  )
}
