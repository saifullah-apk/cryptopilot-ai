import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { TrendPill } from './TrendPill'
import type { Confluence, TechnicalAnalysis } from '../../lib/indicators'
import type { Interval } from '../../lib/binance'

type Frame = {
  interval: Interval
  analysis: TechnicalAnalysis
  loading: boolean
}

type MultiTimeframePanelProps = {
  frames: Frame[]
  confluence: Confluence
}

export function MultiTimeframePanel({
  frames,
  confluence,
}: MultiTimeframePanelProps) {
  return (
    <Card className="animate-in">
      <CardHead
        title="Multi-timeframe"
        badge={<Badge tone="ai">15m + 1h</Badge>}
      />
      <CardBody flush>
        <ul>
          {frames.map((frame) => {
            const { trend, indicators } = frame.analysis
            return (
              <li className="mtf-row" key={frame.interval}>
                <span className="mtf-row__tf mono">{frame.interval}</span>
                {frame.loading ? (
                  <span className="cell-skeleton shimmer" aria-label="Loading timeframe" />
                ) : (
                  <TrendPill direction={trend.direction} />
                )}
                <span className="mtf-row__metric">
                  <span className="dim">RSI</span>
                  <span className="mono">
                    {indicators.rsi14 !== null ? indicators.rsi14.toFixed(1) : '—'}
                  </span>
                </span>
                <span className="mtf-row__metric">
                  <span className="dim">MACD</span>
                  <span
                    className={`mono ${
                      indicators.macd
                        ? indicators.macd.histogram >= 0
                          ? 'pos'
                          : 'neg'
                        : ''
                    }`}
                  >
                    {indicators.macd ? indicators.macd.histogram.toFixed(2) : '—'}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </CardBody>
      <CardFoot>
        <span className="foot-row">
          <Icon
            name={
              confluence.alignment === 'bullish'
                ? 'arrowUp'
                : confluence.alignment === 'bearish'
                  ? 'arrowDown'
                  : 'activity'
            }
            size={13}
          />
          <strong style={{ color: 'var(--text-2)' }}>
            {confluence.alignment === 'mixed'
              ? 'Mixed'
              : confluence.alignment === 'bullish'
                ? 'Aligned bullish'
                : 'Aligned bearish'}
          </strong>
          {confluence.note}
        </span>
      </CardFoot>
    </Card>
  )
}
