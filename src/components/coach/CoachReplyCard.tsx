import { Badge, type BadgeTone } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { formatClock, formatPercent, formatPrice } from '../../lib/format'
import type {
  CoachCondition,
  CoachContextSummary,
  CoachProvider,
  CoachReply,
  CoachSignal,
} from '../../lib/coach'

const CONDITION_LABEL: Record<CoachCondition, string> = {
  bullish: 'Bullish conditions',
  bearish: 'Bearish conditions',
  neutral: 'Neutral conditions',
  mixed: 'Mixed conditions',
}

const CONDITION_TONE: Record<CoachCondition, BadgeTone> = {
  bullish: 'pos',
  bearish: 'neg',
  neutral: 'neutral',
  mixed: 'warn',
}

const SIGNAL_TONE: Record<CoachSignal, BadgeTone> = {
  bullish: 'pos',
  bearish: 'neg',
  neutral: 'neutral',
}

type CoachReplyCardProps = {
  reply: CoachReply
  provider: CoachProvider | null
  context: CoachContextSummary | null
  error: string | null
  at: number
}

/** Renders one structured coach answer. */
export function CoachReplyCard({
  reply,
  provider,
  context,
  error,
  at,
}: CoachReplyCardProps) {
  return (
    <article className="coach-reply">
      <header className="coach-reply__head">
        <span className="ai-orb ai-orb--sm">
          <Icon name="spark" size={15} />
        </span>
        <Badge tone={CONDITION_TONE[reply.marketCondition]}>
          {CONDITION_LABEL[reply.marketCondition]}
        </Badge>
        <Badge tone={provider === 'gemini' ? 'ai' : 'warn'}>
          {provider === 'gemini' ? 'Gemini' : 'Rule-based'}
        </Badge>
        <span className="coach-reply__time">{formatClock(at)}</span>
      </header>

      {error ? (
        <div className="coach-alert" role="status">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      <p className="coach-reply__summary">{reply.summary}</p>
      <p className="coach-reply__analysis">{reply.analysis}</p>

      {context ? (
        <dl className="coach-context">
          <div>
            <dt>Symbol</dt>
            <dd className="mono">{context.symbol.replace('USDT', '/USDT')}</dd>
          </div>
          <div>
            <dt>Timeframe</dt>
            <dd className="mono">{context.interval}</dd>
          </div>
          <div>
            <dt>Last price</dt>
            <dd className="mono">{formatPrice(context.lastPrice)}</dd>
          </div>
          <div>
            <dt>24h</dt>
            <dd className={`mono ${context.change24h === null ? '' : context.change24h >= 0 ? 'pos' : 'neg'}`}>
              {context.change24h === null ? 'n/a' : formatPercent(context.change24h)}
            </dd>
          </div>
          <div>
            <dt>Trend</dt>
            <dd className="mono">
              {context.trend} · {context.trendScore}/{context.trendMax}
            </dd>
          </div>
          <div>
            <dt>Candles</dt>
            <dd className="mono">{context.candleCount}</dd>
          </div>
        </dl>
      ) : null}

      <section className="coach-block">
        <h4 className="coach-block__title">
          <Icon name="activity" size={13} />
          Indicators
        </h4>
        <ul className="coach-indicator-list">
          {reply.indicators.map((indicator) => (
            <li className="coach-indicator" key={`${indicator.name}-${indicator.explanation}`}>
              <div className="coach-indicator__top">
                <strong>{indicator.name}</strong>
                <Badge tone={SIGNAL_TONE[indicator.signal]}>{indicator.signal}</Badge>
              </div>
              <p>{indicator.explanation}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="coach-cols">
        <section className="coach-block coach-block--opportunity">
          <h4 className="coach-block__title">
            <Icon name="star" size={13} />
            Possible opportunities
          </h4>
          <ul className="coach-bullets">
            {reply.opportunities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="coach-block coach-block--risk">
          <h4 className="coach-block__title">
            <Icon name="alert" size={13} />
            Risks
          </h4>
          <ul className="coach-bullets">
            {reply.risks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="coach-block coach-block--avoid">
        <h4 className="coach-block__title">
          <Icon name="shield" size={13} />
          Reasons to avoid trading
        </h4>
        <ul className="coach-bullets">
          {reply.avoidTrading.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <footer className="coach-reply__foot">
        <Icon name="info" size={14} />
        <span>{reply.confidenceNote}</span>
      </footer>
    </article>
  )
}
