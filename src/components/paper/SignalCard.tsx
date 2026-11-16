import { Badge } from '../ui/Badge'
import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Button } from '../ui/Controls'
import { Icon } from '../ui/Icon'
import { actionTone, type TradeSignal } from '../../lib/paperTrading'
import { isSignalExpired } from '../../lib/signals'
import { formatClock, formatPrice } from '../../lib/format'

type SignalCardProps = {
  signal: TradeSignal
  /** Compact list variant for the dashboard. */
  compact?: boolean
  busy?: boolean
  now?: number
  onApprove?: (signalId: string) => void
  onReject?: (signalId: string) => void
}

const STATUS_TONE = {
  pending: 'warn',
  approved: 'pos',
  rejected: 'neutral',
  expired: 'demo',
} as const

function timeLeftLabel(signal: TradeSignal, now: number): string {
  const remaining = signal.expiresAt - now
  if (remaining <= 0) return 'expired'
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m left`
  }
  if (minutes > 0) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}

function levelsGrid(signal: TradeSignal) {
  return (
    <div className="signal-levels">
      <div className="signal-levels__item">
        <span className="dim">Market price</span>
        <strong className="mono">{formatPrice(signal.marketPrice)}</strong>
      </div>
      <div className="signal-levels__item">
        <span className="dim">Entry reference</span>
        <strong className="mono">{formatPrice(signal.entry)}</strong>
      </div>
      <div className="signal-levels__item">
        <span className="dim">Stop-loss</span>
        <strong className="mono neg">{formatPrice(signal.stopLoss)}</strong>
      </div>
      <div className="signal-levels__item">
        <span className="dim">Take-profit</span>
        <strong className="mono pos">{formatPrice(signal.takeProfit)}</strong>
      </div>
      <div className="signal-levels__item">
        <span className="dim">Risk / reward</span>
        <strong className="mono">1 : {signal.riskReward.toFixed(2)}</strong>
      </div>
      <div className="signal-levels__item">
        <span className="dim">Confidence</span>
        <strong className="mono">{signal.confidence}/100</strong>
      </div>
    </div>
  )
}

function confidenceBar(signal: TradeSignal) {
  return (
    <div className="confidence">
      <span className="confidence__track">
        <span className="confidence__fill" style={{ width: `${signal.confidence}%` }} />
      </span>
      <span className="confidence__val">{signal.confidence}%</span>
      <Badge tone="ai">setup score</Badge>
    </div>
  )
}

export function SignalCard({
  signal,
  compact,
  busy,
  now = Date.now(),
  onApprove,
  onReject,
}: SignalCardProps) {
  const expired = signal.status === 'pending' && isSignalExpired(signal.expiresAt, now)
  const executable = signal.action === 'BUY' || signal.action === 'SELL'

  const head = (
    <CardHead
      title={
        <span className="signal-title">
          <span className="mono">{signal.symbol}</span>
          <span className="dim">{signal.interval}</span>
          <Badge tone={actionTone(signal.action)}>{signal.action}</Badge>
          <Badge tone={signal.side === 'long' ? 'pos' : 'neg'}>
            {signal.side === 'long' ? 'long ref' : 'short ref'}
          </Badge>
        </span>
      }
      badge={
        <Badge tone={STATUS_TONE[signal.status]}>
          {expired ? 'expired' : signal.status}
        </Badge>
      }
    />
  )

  if (compact) {
    return (
      <Card className="signal-card animate-in">
        {head}
        <CardBody>
          {confidenceBar(signal)}
          <p className="signal-card__summary dim">
            {signal.technicalReasoning[0] ?? 'No technical summary available.'}
          </p>
          <div className="signal-card__meta dim">
            <span>
              <Icon name="clock" size={12} />{' '}
              {signal.status === 'pending' ? timeLeftLabel(signal, now) : `created ${formatClock(signal.createdAt)}`}
            </span>
            <span>AI: {signal.aiProvider === 'gemini' ? 'Gemini' : 'rule-based'}</span>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="signal-card animate-in">
      {head}
      <CardBody>
        {levelsGrid(signal)}
        {confidenceBar(signal)}

        <div className="signal-section">
          <h3 className="signal-section__title">Technical reasoning</h3>
          <ul className="signal-list">
            {signal.technicalReasoning.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="signal-section">
          <h3 className="signal-section__title">
            AI explanation
            <Badge tone={signal.aiProvider === 'gemini' ? 'ai' : 'neutral'}>
              {signal.aiProvider === 'gemini' ? 'Gemini' : 'rule-based fallback'}
            </Badge>
          </h3>
          <p className="signal-ai">{signal.aiExplanation}</p>
        </div>

        <div className="signal-section">
          <h3 className="signal-section__title signal-section__title--warn">
            <Icon name="alert" size={14} /> Risk warnings
          </h3>
          <ul className="signal-list signal-list--warn">
            {signal.riskWarnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="signal-card__meta dim">
          <span>
            <Icon name="clock" size={12} />{' '}
            {signal.status === 'pending'
              ? `${timeLeftLabel(signal, now)} · expires ${formatClock(signal.expiresAt)}`
              : `created ${formatClock(signal.createdAt)}`}
          </span>
          <span>Paper simulation only — no real order is ever placed.</span>
        </div>
      </CardBody>

      {signal.status === 'pending' ? (
        <CardFoot>
          {expired || !executable ? (
            <span className="dim">
              {expired
                ? 'This signal expired before review — generate a fresh one.'
                : `${signal.action} signals are educational only and cannot open a virtual trade.`}
            </span>
          ) : (
            <div className="signal-actions">
              <Button
                variant="primary"
                size="sm"
                icon={<Icon name="check" size={14} />}
                onClick={() => onApprove?.(signal.id)}
              >
                {busy ? 'Approving…' : 'Approve (1% risk)'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReject?.(signal.id)}
              >
                {busy ? 'Rejecting…' : 'Reject'}
              </Button>
            </div>
          )}
        </CardFoot>
      ) : (
        <CardFoot>
          <span className="dim">
            {signal.status === 'approved'
              ? 'Approved — virtual position opened with a mandatory stop-loss.'
              : signal.status === 'rejected'
                ? 'Rejected — no trade was taken.'
                : `Expired before review.${signal.decisionNote ? ` ${signal.decisionNote}` : ''}`}
          </span>
        </CardFoot>
      )}
    </Card>
  )
}
