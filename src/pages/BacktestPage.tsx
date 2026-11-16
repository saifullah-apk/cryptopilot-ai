import { useCallback, useEffect, useState } from 'react'

import { Badge } from '../components/ui/Badge'
import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { AreaChart } from '../components/ui/Chart'
import { Button, Segmented } from '../components/ui/Controls'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import {
  BACKTEST_INTERVALS,
  BACKTEST_SYMBOLS,
  DEFAULT_MIN_CONFIDENCE,
  MAX_BACKTEST_RANGE_DAYS,
  type BacktestRequest,
  type BacktestRunSummary,
  type BacktestTrade,
  type StoredBacktestRun,
} from '../lib/backtest'
import {
  BacktestApiError,
  fetchBacktestRun,
  fetchBacktestRuns,
  runBacktestRequest,
} from '../lib/backtestApi'
import type { Interval, MarketSymbol } from '../lib/binance'
import { formatClock, formatMoney, formatPercent, formatPrice } from '../lib/format'
import { pnlTone } from '../lib/paperTrading'

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dateStartUtc(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`)
}

function dateEndUtc(value: string): number {
  return Date.parse(`${value}T23:59:59.999Z`)
}

function formatDateRange(startTime: number, endTime: number): string {
  const start = new Date(startTime).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const end = new Date(endTime).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${start} → ${end}`
}

function exitTone(reason: string): 'pos' | 'neg' | 'neutral' {
  if (reason === 'take-profit') return 'pos'
  if (reason === 'stop-loss') return 'neg'
  return 'neutral'
}

const QUICK_RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '180d' },
] as const

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

function BacktestReportView({ stored }: { stored: StoredBacktestRun }) {
  const { report } = stored
  const { metrics } = report
  const returnPct =
    report.params.initialCapital > 0
      ? (metrics.netPnl / report.params.initialCapital) * 100
      : 0
  const curve = metrics.equityCurve
  const chartData = curve.map((point) => point.equity)
  const labels =
    curve.length >= 2
      ? [
          new Date(curve[0].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          new Date(curve[curve.length - 1].at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
        ]
      : []
  const tone = metrics.netPnl < 0 ? 'neg' : 'pos'
  const stopExits = report.trades.filter((trade) => trade.exitReason === 'stop-loss').length
  const targetExits = report.trades.filter((trade) => trade.exitReason === 'take-profit').length
  const openExits = report.trades.filter((trade) => trade.exitReason === 'end-of-data').length

  return (
    <>
      <Notice icon="alert">
        <strong>Historical simulation — not actual performance.</strong> This report replays past
        Binance candles with fees and slippage. It is not live trading, not your paper-account record,
        and not a promise of future profit.
      </Notice>

      <div className="stat-grid stagger">
        <StatCard
          label="Net P&L"
          value={formatMoney(metrics.netPnl)}
          delta={`${formatPercent(returnPct)} on ${formatMoney(report.params.initialCapital)}`}
          deltaTone={pnlTone(metrics.netPnl)}
          note={`Ending simulated equity ${formatMoney(metrics.endingEquity)}`}
          icon="wallet"
          iconTone="ai"
          badge={<Badge tone="neutral">Simulated</Badge>}
        />
        <StatCard
          label="Simulated trades"
          value={String(metrics.totalTrades)}
          delta={`${metrics.wins} wins · ${metrics.losses} losses`}
          note={`${stopExits} stops · ${targetExits} targets · ${openExits} end-of-data`}
          icon="activity"
        />
        <StatCard
          label="Win rate"
          value={metrics.winRate === null ? null : `${metrics.winRate}%`}
          delta={
            metrics.totalTrades > 0 ? `${metrics.wins} of ${metrics.totalTrades}` : 'no trades'
          }
          deltaTone={
            metrics.winRate === null ? 'neutral' : metrics.winRate >= 50 ? 'pos' : 'neg'
          }
          note="A historical sample is not predictive"
          icon="trend"
        />
        <StatCard
          label="Profit factor"
          value={metrics.profitFactor === null ? null : metrics.profitFactor.toFixed(2)}
          delta={`gross +${formatMoney(metrics.grossProfit)} / ${formatMoney(metrics.grossLoss)}`}
          deltaTone={
            metrics.profitFactor !== null && metrics.profitFactor >= 1 ? 'pos' : 'neutral'
          }
          note={
            metrics.profitFactor === null
              ? 'Undefined without a losing trade'
              : 'Gross profit ÷ gross loss'
          }
          icon="shield"
        />
        <StatCard
          label="Max drawdown"
          value={formatMoney(metrics.maxDrawdown)}
          delta={formatPercent(-metrics.maxDrawdownPct)}
          deltaTone={metrics.maxDrawdown > 0 ? 'neg' : 'neutral'}
          note={`Peak simulated equity ${formatMoney(metrics.peakEquity)}`}
          icon="arrowDown"
        />
        <StatCard
          label="Candles evaluated"
          value={String(report.candlesEvaluated)}
          delta={`${report.executableSignals} executable signals · ${report.skippedSignals} skipped`}
          note={`${report.candlesAvailable} candles available · look-ahead safe`}
          icon="candles"
          badge={<Badge tone="ai">Look-ahead safe</Badge>}
        />
      </div>

      <Card className="animate-in">
        <CardHead
          title="Simulated equity curve"
          icon={<Icon name="chart" size={16} />}
          badge={
            <Badge tone={tone === 'pos' ? 'pos' : 'neg'}>{formatPercent(returnPct)}</Badge>
          }
        />
        <CardBody>
          {chartData.length < 2 ? (
            <EmptyState
              icon="flask"
              title="No trades in this range"
              description="The strategy produced no executable trades in the selected window. Try a wider range, a lower confidence threshold or the other timeframe."
            />
          ) : (
            <>
              <AreaChart
                data={chartData}
                labels={labels}
                tone={tone}
                ariaLabel="Backtest simulated equity curve"
              />
              <div className="curve-meta">
                <span>
                  <span className="dim">Start</span>{' '}
                  <strong className="mono">{formatMoney(metrics.startingBalance)}</strong>
                </span>
                <span>
                  <span className="dim">End</span>{' '}
                  <strong className="mono">{formatMoney(metrics.endingEquity)}</strong>
                </span>
                <span>
                  <span className="dim">Range</span>{' '}
                  <strong>{formatDateRange(report.startTime, report.endTime)}</strong>
                </span>
                <span>
                  <span className="dim">Candles</span>{' '}
                  <strong className="mono">{report.interval}</strong>
                </span>
              </div>
            </>
          )}
        </CardBody>
        <CardFoot>
          Built from {report.symbol} {report.interval} public candles · generated{' '}
          {formatClock(report.generatedAt)} · run {stored.summary.id.slice(0, 8)}
        </CardFoot>
      </Card>

      <div className="dash-grid">
        <div className="span-2">
          <Card className="animate-in">
            <CardHead
              title="Historical trade results"
              icon={<Icon name="activity" size={16} />}
              badge={<Badge tone="neutral">{report.trades.length} trades</Badge>}
            />
            <CardBody flush>
              {report.trades.length === 0 ? (
                <EmptyState
                  icon="candles"
                  title="No simulated fills"
                  description="No setup met the confidence threshold with valid stop and target levels in this range."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Side</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>Qty</th>
                        <th>Exit reason</th>
                        <th>Conf.</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.trades.map((trade: BacktestTrade) => (
                        <tr key={trade.id}>
                          <td>
                            <Badge tone={trade.side === 'long' ? 'pos' : 'neg'}>
                              {trade.action}
                            </Badge>
                          </td>
                          <td className="mono">
                            {formatPrice(trade.entryPrice)}
                            <br />
                            <span className="dim" style={{ fontSize: 10.5 }}>
                              {new Date(trade.openedAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                          </td>
                          <td className="mono">
                            {formatPrice(trade.exitPrice)}
                            <br />
                            <span className="dim" style={{ fontSize: 10.5 }}>
                              {new Date(trade.closedAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                          </td>
                          <td className="mono">{trade.quantity}</td>
                          <td>
                            <Badge tone={exitTone(trade.exitReason)}>{trade.exitReason}</Badge>
                          </td>
                          <td className="mono">{trade.confidence}</td>
                          <td className={`mono ${pnlTone(trade.pnl)}`}>
                            {formatMoney(trade.pnl)}
                            <br />
                            <span className="dim" style={{ fontSize: 10.5 }}>
                              {formatPercent(trade.pnlPercent)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
            <CardFoot>
              One position at a time. Entry fills at the next candle open with adverse slippage;
              stops fill with slippage and targets fill at their limit.
            </CardFoot>
          </Card>
        </div>

        <Card className="animate-in">
          <CardHead
            title="Methodology"
            icon={<Icon name="info" size={16} />}
            badge={<Badge tone="ai">Transparent</Badge>}
          />
          <CardBody>
            <ul className="rule-list">
              {report.methodology.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="method-note">
              <strong>Look-ahead prevention:</strong> signals are computed only from the candle
              window ending at bar <span className="mono">i</span>, and the fill happens at bar{' '}
              <span className="mono">i + 1</span> open. No future candle is read while producing a
              signal.
            </div>
            <ul className="rule-list" style={{ marginTop: 12 }}>
              {report.disclaimers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export function BacktestPage() {
  const now = Date.now()
  const [symbol, setSymbol] = useState<MarketSymbol>('BTCUSDT')
  const [interval, setInterval] = useState<Interval>('1h')
  const [startDate, setStartDate] = useState(toDateInput(now - 90 * 86_400_000))
  const [endDate, setEndDate] = useState(toDateInput(now))
  const [capital, setCapital] = useState('10000')
  const [riskPct, setRiskPct] = useState('1')
  const [minConfidence, setMinConfidence] = useState(String(DEFAULT_MIN_CONFIDENCE))
  const [feePct, setFeePct] = useState('0.1')
  const [slippagePct, setSlippagePct] = useState('0.05')

  const [stored, setStored] = useState<StoredBacktestRun | null>(null)
  const [history, setHistory] = useState<BacktestRunSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      setHistory(await fetchBacktestRuns())
    } catch {
      // History is secondary; the run result still matters if it succeeds.
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const applyQuickRange = (days: number) => {
    setStartDate(toDateInput(Date.now() - days * 86_400_000))
    setEndDate(toDateInput(Date.now()))
  }

  const onRun = async () => {
    setError(null)

    const startTime = dateStartUtc(startDate)
    const endTime = dateEndUtc(endDate)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      setError('Choose valid start and end dates.')
      return
    }

    const params: BacktestRequest = {
      symbol,
      interval,
      startTime,
      endTime,
      initialCapital: Number(capital),
      riskPct: Number(riskPct),
      minConfidence: Number(minConfidence),
      feeRate: Number(feePct) / 100,
      slippageRate: Number(slippagePct) / 100,
    }

    setBusy(true)
    try {
      const next = await runBacktestRequest(params)
      setStored(next)
      await loadHistory()
    } catch (caught) {
      setError(
        caught instanceof BacktestApiError ? caught.message : 'The backtest failed. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const loadRun = async (id: string) => {
    setError(null)
    setBusy(true)
    try {
      setStored(await fetchBacktestRun(id))
    } catch (caught) {
      setError(caught instanceof BacktestApiError ? caught.message : 'Unable to load that run.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Intelligence</div>
          <h1 style={{ marginTop: 4 }}>Backtesting</h1>
          <p>
            Replay the app&apos;s indicator rules on historical Binance candles with fees and
            slippage. A backtest is a controlled experiment on the past — it is not live trading and
            not a forecast.
          </p>
        </div>
        <Notice tone="ai" icon="flask">
          Historical simulation · public Binance candles · fees + slippage · look-ahead prevented ·
          no real orders.
        </Notice>
      </div>

      <Card className="animate-in">
        <CardHead
          title="Run a backtest"
          icon={<Icon name="candles" size={16} />}
          badge={<Badge tone="neutral">Public data</Badge>}
        />
        <CardBody>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void onRun()
            }}
          >
            <div className="generator-row">
              <div className="generator-field">
                <span className="dim">Symbol</span>
                <Segmented
                  ariaLabel="Backtest symbol"
                  value={symbol}
                  onChange={(value) => setSymbol(value)}
                  options={BACKTEST_SYMBOLS.map((value) => ({
                    value,
                    label: value.replace('USDT', ''),
                  }))}
                />
              </div>
              <div className="generator-field">
                <span className="dim">Timeframe</span>
                <Segmented
                  ariaLabel="Backtest timeframe"
                  value={interval}
                  onChange={(value) => setInterval(value)}
                  options={BACKTEST_INTERVALS.map((value) => ({ value, label: value }))}
                />
              </div>
              <div className="generator-field">
                <span className="dim">Quick range</span>
                <div className="quick-range">
                  {QUICK_RANGES.map((range) => (
                    <Button key={range.days} size="sm" variant="ghost" onClick={() => applyQuickRange(range.days)}>
                      {range.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-grid form-grid--wide" style={{ marginTop: 16 }}>
              <label className="field">
                <span>Start date (UTC)</span>
                <input
                  className="field__input"
                  type="date"
                  value={startDate}
                  max={toDateInput(Date.now())}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>End date (UTC)</span>
                <input
                  className="field__input"
                  type="date"
                  value={endDate}
                  max={toDateInput(Date.now())}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Initial capital (USDT)</span>
                <input
                  className="field__input"
                  type="number"
                  min={100}
                  max={1_000_000}
                  step={100}
                  value={capital}
                  onChange={(event) => setCapital(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Risk per trade (%)</span>
                <input
                  className="field__input"
                  type="number"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={riskPct}
                  onChange={(event) => setRiskPct(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Minimum confidence</span>
                <input
                  className="field__input"
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  value={minConfidence}
                  onChange={(event) => setMinConfidence(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Fee per side (%)</span>
                <input
                  className="field__input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={feePct}
                  onChange={(event) => setFeePct(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Slippage (%)</span>
                <input
                  className="field__input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={slippagePct}
                  onChange={(event) => setSlippagePct(event.target.value)}
                />
              </label>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <Button
                type="submit"
                variant="ai"
                icon={<Icon name="flask" size={14} />}
              >
                {busy ? 'Running backtest…' : 'Run backtest'}
              </Button>
              <span className="dim" style={{ fontSize: 11.5 }}>
                Ranges up to {MAX_BACKTEST_RANGE_DAYS} days. One position at a time, mandatory
                stop-loss, no leverage. Confidence is a setup score, not a win probability.
              </span>
            </div>
          </form>

          {error ? <Notice icon="alert">{error}</Notice> : null}

          <p className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>
            Dates are interpreted in UTC. The server fetches public candles plus a warm-up window so
            indicators are fully formed before the first in-range signal.
          </p>
        </CardBody>
      </Card>

      {stored ? <BacktestReportView stored={stored} /> : null}

      <Card className="animate-in">
        <CardHead
          title="Saved backtest runs"
          icon={<Icon name="clock" size={16} />}
          badge={<Badge tone="neutral">{history.length} stored</Badge>}
          actions={
            <Button size="sm" variant="ghost" onClick={() => void loadHistory()}>
              Refresh list
            </Button>
          }
        />
        <CardBody flush>
          {loadingHistory && history.length === 0 ? (
            <p className="dim" style={{ padding: '14px var(--space-5)' }}>
              Loading saved runs…
            </p>
          ) : history.length === 0 ? (
            <EmptyState
              icon="flask"
              title="No saved runs"
              description="Run a backtest and its report is stored in the local database for later review."
            />
          ) : (
            <ul>
              {history.map((run) => (
                <li className="activity-row" key={run.id}>
                  <span className="activity__icon activity__icon--neutral">
                    <Icon name="chart" size={16} />
                  </span>
                  <span className="activity__body">
                    <span className="activity__title">
                      {run.symbol} {run.interval} ·{' '}
                      <span className={`mono ${pnlTone(run.netPnl)}`}>{formatMoney(run.netPnl)}</span>
                    </span>
                    <br />
                    <span className="activity__sub">
                      {formatDateRange(run.startTime, run.endTime)} · {run.trades} trades · win rate{' '}
                      {run.winRate === null ? '—' : `${run.winRate}%`} · max DD {run.maxDrawdownPct}%
                    </span>
                  </span>
                  <span className="activity__time">
                    {formatClock(run.createdAt)}
                    <br />
                    <Button size="sm" variant="ghost" onClick={() => void loadRun(run.id)}>
                      Load
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
        <CardFoot>
          Saved reports live in <span className="mono">data/paper.db</span> alongside paper-trading
          state. They are simulations — never actual account performance.
        </CardFoot>
      </Card>
    </>
  )
}
