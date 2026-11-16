import { useEffect, useState } from 'react'
import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { FeedStatusBadge } from '../../market/FeedStatusBadge'
import { useMarketFeed } from '../../market/MarketDataProvider'
import { MARKETS } from '../../lib/binance'
import {
  formatClock,
  formatCompact,
  formatPercent,
  formatPrice,
  percentChange,
} from '../../lib/format'

/** How long to show skeletons before declaring the feed unavailable. */
const GIVE_UP_MS = 12_000

/**
 * BTC / ETH / SOL watchlist backed by the Binance public WebSocket.
 * Renders skeletons while loading and an explicit unavailable state if the
 * feed never produces a first tick.
 */
export function MarketWatchlist() {
  const { tickers, connection, stale, lastMessageAt, reconnect } = useMarketFeed()
  const [timedOut, setTimedOut] = useState(false)

  const hasAnyTicker = Object.keys(tickers).length > 0

  useEffect(() => {
    if (hasAnyTicker) {
      setTimedOut(false)
      return
    }
    const timer = window.setTimeout(() => setTimedOut(true), GIVE_UP_MS)
    return () => window.clearTimeout(timer)
  }, [hasAnyTicker])

  const unavailable = timedOut && !hasAnyTicker

  return (
    <Card className="animate-in">
      <CardHead
        title="Market watchlist"
        badge={<FeedStatusBadge connection={connection} stale={stale} />}
        actions={<Badge tone="neutral">BTC · ETH · SOL</Badge>}
      />
      <CardBody flush>
        <div className="watch-head" aria-hidden="true">
          <span>Asset</span>
          <span>Last price</span>
          <span>24h change</span>
          <span>24h volume</span>
        </div>

        <ul>
          {MARKETS.map((market) => {
            const ticker = tickers[market.symbol]
            const change = ticker ? percentChange(ticker.open, ticker.last) : null

            return (
              <li
                className={`watch-row${ticker && stale ? ' is-stale' : ''}`}
                key={market.symbol}
              >
                <div className="asset">
                  <span className={`asset__mark ${market.markClass}`} aria-hidden="true">
                    {market.base.slice(0, 1)}
                  </span>
                  <span>
                    <span className="asset__name">{market.name}</span>
                    <br />
                    <span className="asset__sym">{market.base}/USDT</span>
                  </span>
                </div>

                <div>
                  <span className="cell-label">Last price</span>
                  {ticker ? (
                    <span className="price-cell mono">{formatPrice(ticker.last)}</span>
                  ) : unavailable ? (
                    <span className="na-value">
                      <Icon name="lock" size={12} />
                      Unavailable
                    </span>
                  ) : (
                    <span className="cell-skeleton shimmer" aria-label="Loading price" />
                  )}
                </div>

                <div>
                  <span className="cell-label">24h change</span>
                  {ticker && change !== null ? (
                    <span className={`change-cell mono ${change >= 0 ? 'pos' : 'neg'}`}>
                      <Icon name={change >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
                      {formatPercent(change)}
                    </span>
                  ) : unavailable ? (
                    <span className="na-value">Unavailable</span>
                  ) : (
                    <span className="cell-skeleton shimmer" aria-label="Loading change" />
                  )}
                </div>

                <div className="watch-row__vol">
                  <span className="cell-label">24h volume</span>
                  {ticker ? (
                    <span className="mono muted">{formatCompact(ticker.volume)}</span>
                  ) : unavailable ? (
                    <span className="na-value">—</span>
                  ) : (
                    <span className="cell-skeleton shimmer" aria-label="Loading volume" />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardBody>
      <CardFoot>
        {unavailable ? (
          <span className="foot-row">
            Binance data is unavailable right now.
            <button type="button" className="link-btn" onClick={reconnect}>
              <Icon name="refresh" size={12} /> Reconnect
            </button>
          </span>
        ) : (
          <span className="foot-row">
            Live public Binance market data · last tick {formatClock(lastMessageAt)}
            {stale ? ' · feed stale' : ''}
          </span>
        )}
      </CardFoot>
    </Card>
  )
}
