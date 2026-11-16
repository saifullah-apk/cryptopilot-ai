import { useMemo, useState } from 'react'
import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Segmented } from '../components/ui/Controls'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/Controls'
import { FeedStatusBadge } from '../market/FeedStatusBadge'
import { useMarketFeed } from '../market/MarketDataProvider'
import { useKlines } from '../hooks/useKlines'
import { MARKETS, marketBySymbol, type Interval, type MarketSymbol } from '../lib/binance'
import {
  analyzeCandles,
  combineTimeframes,
  type TechnicalAnalysis,
} from '../lib/indicators'
import {
  formatClock,
  formatCandleTime,
  formatPrice,
  percentChange,
} from '../lib/format'
import { CoinSummaryCard } from '../components/markets/CoinSummaryCard'
import { IndicatorsPanel } from '../components/markets/IndicatorsPanel'
import { LevelsPanel } from '../components/markets/LevelsPanel'
import { PatternList } from '../components/markets/PatternList'
import { TrendPill } from '../components/markets/TrendPill'
import { MultiTimeframePanel } from '../components/markets/MultiTimeframePanel'

const CANDLE_LIMIT = 300

type KlineFeed = ReturnType<typeof useKlines>

export function MarketsPage() {
  const [symbol, setSymbol] = useState<MarketSymbol>('BTCUSDT')
  const [detailInterval, setDetailInterval] = useState<Interval>('15m')

  const { tickers, connection, stale } = useMarketFeed()

  // 1h feeds power the per-coin summaries and the higher timeframe.
  const hourlyFeeds: Record<MarketSymbol, KlineFeed> = {
    BTCUSDT: useKlines('BTCUSDT', '1h', CANDLE_LIMIT),
    ETHUSDT: useKlines('ETHUSDT', '1h', CANDLE_LIMIT),
    SOLUSDT: useKlines('SOLUSDT', '1h', CANDLE_LIMIT),
  }

  const intraday = useKlines(symbol, '15m', CANDLE_LIMIT)

  const hourlyAnalyses = useMemo<Record<MarketSymbol, TechnicalAnalysis>>(
    () => ({
      BTCUSDT: analyzeCandles(hourlyFeeds.BTCUSDT.candles),
      ETHUSDT: analyzeCandles(hourlyFeeds.ETHUSDT.candles),
      SOLUSDT: analyzeCandles(hourlyFeeds.SOLUSDT.candles),
    }),
    [
      hourlyFeeds.BTCUSDT.candles,
      hourlyFeeds.ETHUSDT.candles,
      hourlyFeeds.SOLUSDT.candles,
    ],
  )

  const fifteenAnalysis = useMemo(
    () => analyzeCandles(intraday.candles),
    [intraday.candles],
  )

  const hourlyFeed = hourlyFeeds[symbol]
  const detailAnalysis =
    detailInterval === '15m' ? fifteenAnalysis : hourlyAnalyses[symbol]

  const detailStatus = detailInterval === '15m' ? intraday.status : hourlyFeed.status
  const detailError = detailInterval === '15m' ? intraday.error : hourlyFeed.error
  const detailLastUpdated =
    detailInterval === '15m' ? intraday.lastUpdated : hourlyFeed.lastUpdated

  const confluence = combineTimeframes([
    {
      interval: '15m',
      direction: fifteenAnalysis.trend.direction,
      score: fifteenAnalysis.trend.score,
    },
    {
      interval: '1h',
      direction: hourlyAnalyses[symbol].trend.direction,
      score: hourlyAnalyses[symbol].trend.score,
    },
  ])

  const refreshDetail = () => {
    if (detailInterval === '15m') intraday.refresh()
    else hourlyFeed.refresh()
  }

  const market = marketBySymbol(symbol)
  const trend = detailAnalysis.trend

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Markets · Technical analysis</div>
          <h1 style={{ marginTop: 4 }}>Market analysis</h1>
          <p>
            Indicators are calculated from live Binance OHLCV candles. Descriptive
            only — not financial advice.
          </p>
        </div>
        <FeedStatusBadge connection={connection} stale={stale} />
      </div>

      <Notice tone="ai" icon="shield">
        Read-only public market data. Signals describe indicator state; they do not
        place trades.
      </Notice>

      <div className="coin-grid" style={{ marginTop: 16 }}>
        {MARKETS.map((item) => {
          const feed = hourlyFeeds[item.symbol]
          const ticker = tickers[item.symbol]
          return (
            <CoinSummaryCard
              key={item.symbol}
              market={item}
              analysis={hourlyAnalyses[item.symbol]}
              price={ticker ? ticker.last : null}
              changePercent={ticker ? percentChange(ticker.open, ticker.last) : null}
              selected={item.symbol === symbol}
              loading={feed.status === 'loading' && feed.candles.length === 0}
              onSelect={() => setSymbol(item.symbol)}
            />
          )
        })}
      </div>

      <div className="dash-grid" style={{ marginTop: 16 }}>
        <div className="span-2">
          <Card className="animate-in">
            <CardHead
              title={
                <span className="mono">
                  {market?.base ?? symbol}/USDT
                  <span className="dim" style={{ fontWeight: 500, marginLeft: 8, fontSize: 12 }}>
                    {market?.name}
                  </span>
                </span>
              }
              badge={<TrendPill direction={trend.direction} />}
              actions={
                <>
                  <Segmented
                    ariaLabel="Analysis timeframe"
                    value={detailInterval}
                    onChange={setDetailInterval}
                    options={[
                      { value: '15m', label: '15m' },
                      { value: '1h', label: '1h' },
                    ]}
                  />
                  <Button
                    size="sm"
                    icon={<Icon name="refresh" size={14} />}
                    onClick={refreshDetail}
                  >
                    Refresh
                  </Button>
                </>
              }
            />

            <CardBody>
              {detailStatus === 'loading' && detailAnalysis.candleCount === 0 ? (
                <div
                  className="chart-skeleton shimmer"
                  role="status"
                  aria-label="Loading technical analysis"
                />
              ) : detailStatus === 'error' && detailAnalysis.candleCount === 0 ? (
                <EmptyState
                  icon="alert"
                  title="Unable to load candles"
                  description={detailError ?? 'The Binance public API did not respond.'}
                  action={
                    <Button
                      variant="primary"
                      icon={<Icon name="refresh" size={15} />}
                      onClick={refreshDetail}
                    >
                      Retry
                    </Button>
                  }
                />
              ) : (
                <>
                  {detailStatus === 'error' && detailAnalysis.candleCount > 0 ? (
                    <Notice icon="alert">
                      Refresh failed — showing the last loaded candles. {detailError}
                    </Notice>
                  ) : null}

                  <div className="analysis-head">
                    <div>
                      <div className="eyebrow">Last close ({detailInterval})</div>
                      <div className="analysis-price mono">
                        {formatPrice(detailAnalysis.lastClose)}
                      </div>
                    </div>
                    <div className="analysis-meta">
                      <span>{detailAnalysis.candleCount} candles</span>
                      <span>
                        Last candle{' '}
                        {detailAnalysis.lastCandleTime
                          ? formatCandleTime(detailAnalysis.lastCandleTime)
                          : '—'}
                      </span>
                      <span>REST {formatClock(detailLastUpdated)}</span>
                      <span>
                        Trend score {trend.maxScore > 0 ? `${trend.score}/${trend.maxScore}` : '—'}
                      </span>
                    </div>
                  </div>

                  {detailAnalysis.insufficient.length > 0 ? (
                    <Notice icon="info">
                      Limited history: {detailAnalysis.insufficient.join(' · ')}.
                    </Notice>
                  ) : null}

                  {trend.reasons.length > 0 ? (
                    <div className="trend-basis">
                      <span className="eyebrow">Trend basis</span>
                      <div className="chip-row">
                        {trend.reasons.map((reason) => (
                          <span className="chip" key={reason}>
                            <span
                              className={`dot ${reason.toLowerCase().includes('above') || reason.toLowerCase().includes('positive') ? 'pos' : 'neg'}`}
                            />
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <h3 className="subpanel__title" style={{ marginTop: 18 }}>
                    Indicators
                  </h3>
                  <IndicatorsPanel analysis={detailAnalysis} />

                  <div className="analysis-cols">
                    <LevelsPanel
                      levels={detailAnalysis.levels}
                      lastClose={detailAnalysis.lastClose}
                    />
                    <PatternList patterns={detailAnalysis.patterns} />
                  </div>
                </>
              )}
            </CardBody>

            <CardFoot>
              Binance public {detailInterval} OHLCV · RSI 14, MACD (12/26/9), EMA
              9/21/50/200, Bollinger (20,2), ATR 14, VWAP 50, volume 20. Values are
              withheld when history is insufficient.
            </CardFoot>
          </Card>
        </div>

        <MultiTimeframePanel
          confluence={confluence}
          frames={[
            {
              interval: '15m',
              analysis: fifteenAnalysis,
              loading: intraday.status === 'loading' && intraday.candles.length === 0,
            },
            {
              interval: '1h',
              analysis: hourlyAnalyses[symbol],
              loading: hourlyFeed.status === 'loading' && hourlyFeed.candles.length === 0,
            },
          ]}
        />
      </div>

      <div className="page__foot-note">
        <Badge tone="neutral">Source</Badge>
        Binance public REST API · {detailAnalysis.candleCount} candles loaded ·{' '}
        {formatPrice(detailAnalysis.lastClose)} last close · trend labels are
        descriptive summaries, not recommendations.
      </div>
    </>
  )
}
