import type { SupportResistance } from '../../lib/indicators'
import { formatPercent, formatPrice } from '../../lib/format'

type LevelsPanelProps = {
  levels: SupportResistance
  lastClose: number | null
}

function distance(level: number, close: number | null): string {
  if (close === null || close === 0) return '—'
  return formatPercent(((level - close) / close) * 100)
}

/** Swing-pivot ladder rendered around the last price. */
export function LevelsPanel({ levels, lastClose }: LevelsPanelProps) {
  if (levels.supports.length === 0 && levels.resistances.length === 0) {
    return (
      <div className="subpanel">
        <h3 className="subpanel__title">Support &amp; resistance</h3>
        <p className="dim" style={{ fontSize: 12.5 }}>
          Not enough swing pivots in the loaded candles to estimate levels.
        </p>
      </div>
    )
  }

  return (
    <div className="subpanel">
      <h3 className="subpanel__title">Support &amp; resistance</h3>
      <ul className="level-ladder">
        {[...levels.resistances].reverse().map((level, index) => (
          <li className="level-row level-row--resistance" key={`r-${level}`}>
            <span className="level-row__tag">
              R{levels.resistances.length - index}
            </span>
            <span className="level-row__price mono">{formatPrice(level)}</span>
            <span className="level-row__distance mono pos">
              {distance(level, lastClose)}
            </span>
          </li>
        ))}

        <li className="level-row level-row--price">
          <span className="level-row__tag">Last</span>
          <span className="level-row__price mono">{formatPrice(lastClose)}</span>
          <span className="level-row__distance mono dim">—</span>
        </li>

        {levels.supports.map((level, index) => (
          <li className="level-row level-row--support" key={`s-${level}`}>
            <span className="level-row__tag">S{index + 1}</span>
            <span className="level-row__price mono">{formatPrice(level)}</span>
            <span className="level-row__distance mono neg">
              {distance(level, lastClose)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
