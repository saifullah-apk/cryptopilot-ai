import { Link } from 'react-router-dom'
import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Badge, DemoBadge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { DEMO_COACH_MESSAGE, DEMO_COACH_POINTS } from '../../data/demo'
import { SUGGESTED_QUESTIONS } from '../../lib/coach'

/** AI Coach preview panel. Demo copy here; the live coach lives at /coach. */
export function AICoachPreview() {
  return (
    <Card className="ai-panel animate-in">
      <CardHead
        title="AI Coach"
        badge={<DemoBadge />}
        actions={<Badge tone="ai" pulse>Live coach</Badge>}
      />
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 15 }}>
          <span className="ai-orb">
            <Icon name="spark" size={20} />
          </span>
          <div>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>Coach preview</div>
            <div className="dim" style={{ fontSize: 11.5 }}>
              Illustrative copy · answers below use verified live data
            </div>
          </div>
        </div>

        <div className="ai-message">{DEMO_COACH_MESSAGE}</div>

        <ul className="ai-points">
          {DEMO_COACH_POINTS.map((point) => (
            <li className="ai-point" key={point.label}>
              <span className="ai-point__tick">
                <Icon name="check" size={11} strokeWidth={2.6} />
              </span>
              <span>
                <strong>{point.label}</strong> — {point.value}
              </span>
            </li>
          ))}
        </ul>

        <div className="ai-preview-asks">
          <span className="eyebrow">Ask the coach</span>
          {SUGGESTED_QUESTIONS.slice(0, 3).map((question) => (
            <Link
              key={question}
              className="ai-preview-ask"
              to="/coach"
              state={{ question }}
            >
              <Icon name="spark" size={12} />
              {question}
            </Link>
          ))}
        </div>

        <Link className="btn btn--ai btn--block" to="/coach" style={{ marginTop: 18 }}>
          Open AI Coach
          <Icon name="arrowRight" size={15} />
        </Link>
      </CardBody>
      <CardFoot>
        The panel above is illustrative. The Coach refetches Binance candles, runs the
        indicator engine, then asks Gemini to explain only those verified values.
      </CardFoot>
    </Card>
  )
}
