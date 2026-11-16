import type { Market } from '../../lib/binance'
import type { TechnicalAnalysis } from '../../lib/indicators'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { formatPercent, formatPrice } from '../../lib/format'
import { TrendPill } from './TrendPill'

type CoinSummaryCardProps = {
  market: Market
  analysis: TechnicalAnalysis
  /** Live WebSocket price, when available. */
  price: number | null
  changePercent: number | null
  selected: boolean
  loading: boolean
  onSelect: () => void
}

/** Compact 1h indicator summary for one coin. */
export function CoinSummaryCard({
  market,
  analysis,
  price,
  changePercent,
  selected,
  loading,
  onSelect,
}: CoinSummaryCardProps) {
  const { trend, indicators } = analysis
  const histogram = indicators.macd?.histogram ?? null

  return (
    <button
      type="button"
      className={`card card--interactive coin-card${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="coin-card__head">
        <span className={`asset__mark ${market.markClass}`} aria-hidden="true">
          {market.base.slice(0, 1)}
        </span>
        <span className="coin-card__ident">
          <span className="coin-card__sym">{market.base}/USDT</span>
          <span className="coin-card__name">{market.name}</span>
        </span>
        {loading ? (
          <Badge tone="neutral" pulse>
            Loading
          </Badge>
        ) : (
          <TrendPill direction={trend.direction} />
        )}
      </div>

      <div className="coin-card__price-row">
        {loading ? (
          <span className="cell-skeleton shimmer" aria-label="Loading analysis" />
        ) : (
          <>
            <span className="coin-card__price mono">
              {price !== null
                ? formatPrice(price)
                : analysis.lastClose !== null
                  ? formatPrice(analysis.lastClose)
                  : '—'}
            </span>
            {changePercent !== null ? (
              <span className={`coin-card__change mono ${changePercent >= 0 ? 'pos' : 'neg'}`}>
                <Icon name={changePercent >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
                {formatPercent(changePercent)}
              </span>
            ) : null}
          </>
        )}
      </div>

      <dl className="coin-card__stats">
        <div>
          <dt>RSI 14</dt>
          <dd className="mono">
            {indicators.rsi14 !== null ? indicators.rsi14.toFixed(1) : '—'}
          </dd>
        </div>
        <div>
          <dt>MACD hist</dt>
          <dd
            className={`mono ${
              histogram === null ? '' : histogram >= 0 ? 'pos' : 'neg'
            }`}
          >
            {histogram !== null ? histogram.toFixed(2) : '—'}
          </dd>
        </div>
        <div>
          <dt>Trend score</dt>
          <dd className="mono">
            {trend.maxScore > 0 ? `${trend.score}/${trend.maxScore}` : '—'}
          </dd>
        </div>
      </dl>

      <div className="coin-card__foot">
        <span>{analysis.candleCount} × 1h candles</span>
        {analysis.insufficient.length > 0 ? (
          <Badge tone="warn">Limited history</Badge>
        ) : (
          <span className="dim">All indicators ready</span>
        )}
      </div>
    </button>
  )
}
