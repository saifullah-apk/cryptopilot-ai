import type { DetectedPattern } from '../../lib/indicators'
import { Badge } from '../ui/Badge'
import { formatCandleTime } from '../../lib/format'

export function PatternList({ patterns }: { patterns: DetectedPattern[] }) {
  return (
    <div className="subpanel">
      <h3 className="subpanel__title">Candlestick patterns</h3>
      {patterns.length === 0 ? (
        <p className="dim" style={{ fontSize: 12.5 }}>
          No pattern detected in the last 5 candles.
        </p>
      ) : (
        <ul className="pattern-list">
          {patterns.map((pattern) => (
            <li className="pattern-item" key={`${pattern.index}-${pattern.name}`}>
              <div className="pattern-item__top">
                <span className="pattern-item__name">{pattern.name}</span>
                <Badge
                  tone={
                    pattern.direction === 'bullish'
                      ? 'pos'
                      : pattern.direction === 'bearish'
                        ? 'neg'
                        : 'neutral'
                  }
                >
                  {pattern.direction}
                </Badge>
                <span className="pattern-item__time mono">
                  {formatCandleTime(pattern.time)}
                </span>
              </div>
              <p className="pattern-item__desc">{pattern.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
