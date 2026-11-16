import { useMemo, useState } from 'react'
import { Card, CardBody, CardFoot, CardHead } from '../ui/Card'
import { Segmented, Button } from '../ui/Controls'
import { CandleChart } from '../ui/CandleChart'
import { EmptyState } from '../ui/Feedback'
import { Icon } from '../ui/Icon'
import { FeedStatusBadge } from '../../market/FeedStatusBadge'
import { useMarketFeed } from '../../market/MarketDataProvider'
import { useKlines } from '../../hooks/useKlines'
import {
  INTERVALS,
  MARKETS,
  marketBySymbol,
  type Interval,
  type MarketSymbol,
} from '../../lib/binance'
import {
  formatClock,
  formatCompact,
  formatPercent,
  formatPrice,
  percentChange,
} from '../../lib/format'

const SYMBOL_OPTIONS = MARKETS.map((market) => ({
  value: market.symbol,
  label: market.base,
}))

/** Dashboard chart area backed by Binance public candles. */
export function MarketChart() {
  const [symbol, setSymbol] = useState<MarketSymbol>('BTCUSDT')
  const [interval, setInterval] = useState<Interval>('15m')

  const { tickers, connection, stale } = useMarketFeed()
  const ticker = tickers[symbol]
  const { candles, status, error, lastUpdated, refresh } = useKlines(symbol, interval)

  const market = marketBySymbol(symbol)

  const displayCandles = useMemo(() => {
    if (!ticker || candles.length === 0) return candles
    const next = candles.slice()
    const last = { ...next[next.length - 1] }
    last.close = ticker.last
    last.high = Math.max(last.high, ticker.last)
    last.low = Math.min(last.low, ticker.last)
    next[next.length - 1] = last
    return next
  }, [candles, ticker])

  const change = ticker ? percentChange(ticker.open, ticker.last) : null
  const hasCandles = displayCandles.length > 1

  return (
    <Card className="animate-in">
      <CardHead
        title={
          <span className="mono">
            {market?.base ?? '—'}/USDT
            <span className="dim" style={{ fontWeight: 500, marginLeft: 8, fontSize: 12 }}>
              {market?.name}
            </span>
          </span>
        }
        badge={<FeedStatusBadge connection={connection} stale={stale} />}
        actions={
          <>
            <Segmented
              ariaLabel="Chart symbol"
              value={symbol}
              onChange={setSymbol}
              options={SYMBOL_OPTIONS}
            />
            <Segmented
              ariaLabel="Chart interval"
              value={interval}
              onChange={setInterval}
              options={INTERVALS.map((value) => ({ value, label: value }))}
            />
          </>
        }
      />

      <CardBody>
        <div className="price-header">
          <span className="price-header__value mono">
            {ticker ? formatPrice(ticker.last) : hasCandles ? formatPrice(displayCandles[displayCandles.length - 1].close) : '—'}
          </span>
          {change !== null ? (
            <span className={`price-header__change mono ${change >= 0 ? 'pos' : 'neg'}`}>
              <Icon name={change >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
              {formatPercent(change)}
            </span>
          ) : null}
          <span className="dim" style={{ fontSize: 11.5 }}>
            24h
          </span>

          <div className="price-header__meta">
            <span>
              H <span className="mono">{formatPrice(ticker?.high)}</span>
            </span>
            <span>
              L <span className="mono">{formatPrice(ticker?.low)}</span>
            </span>
            <span>
              Vol <span className="mono">{ticker ? formatCompact(ticker.volume) : '—'}</span>
            </span>
          </div>
        </div>

        {status === 'loading' && !hasCandles ? (
          <div
            className="chart-skeleton shimmer"
            role="status"
            aria-label="Loading candles"
          />
        ) : status === 'error' && !hasCandles ? (
          <EmptyState
            icon="alert"
            title="Unable to load candles"
            description={error ?? 'The Binance public API did not respond.'}
            action={
              <Button variant="primary" icon={<Icon name="refresh" size={15} />} onClick={refresh}>
                Retry
              </Button>
            }
          />
        ) : (
          <CandleChart
            candles={displayCandles}
            livePrice={ticker?.last ?? null}
            ariaLabel={`${market?.name ?? symbol} ${interval} candlestick chart`}
          />
        )}

        {status === 'error' && hasCandles ? (
          <div className="notice" role="note" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            <div>
              Refresh failed — showing the last loaded candles. {error}
            </div>
          </div>
        ) : null}

        <div className="chart-legend" style={{ marginTop: 14 }}>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--positive-bright)' }} />
            Bullish
          </span>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--negative-bright)' }} />
            Bearish
          </span>
          <span className="legend-item" style={{ marginLeft: 'auto' }}>
            <Icon name="clock" size={12} />
            REST {formatClock(lastUpdated)} · live via WebSocket
          </span>
        </div>
      </CardBody>

      <CardFoot>
        Binance public market data (REST + WebSocket) · {interval} candles · read-only,
        no account access.
      </CardFoot>
    </Card>
  )
}
