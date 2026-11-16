import { Link } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { AreaChart } from '../components/ui/Chart'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { analyticsFromPaperPositions, type PerformanceBreakdown } from '../lib/analytics'
import { formatClock, formatMoney, formatPercent } from '../lib/format'
import { pnlTone, STARTING_BALANCE } from '../lib/paperTrading'
import { usePaperState } from '../paper/PaperStateProvider'

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function BreakdownTable({
  title,
  icon,
  rows,
  emptyLabel,
}: {
  title: string
  icon: string
  rows: PerformanceBreakdown[]
  emptyLabel: string
}) {
  return (
    <Card className="animate-in">
      <CardHead
        title={title}
        icon={<Icon name={icon} size={16} />}
        badge={<Badge tone="neutral">{rows.length} groups</Badge>}
      />
      <CardBody flush>
        {rows.length === 0 ? (
          <EmptyState icon="chart" title="No closed trades" description={emptyLabel} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{title.replace('Performance by ', '')}</th>
                  <th>Trades</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Win rate</th>
                  <th>Net P&L</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.key}</strong>
                    </td>
                    <td className="mono">{row.trades}</td>
                    <td className="mono pos">{row.wins}</td>
                    <td className="mono neg">{row.losses}</td>
                    <td className="mono">{row.winRate === null ? '—' : `${row.winRate}%`}</td>
                    <td className={`mono ${pnlTone(row.netPnl)}`}>{formatMoney(row.netPnl)}</td>
                    <td className={`mono ${pnlTone(row.avgPnl)}`}>
                      {row.avgPnl === null ? '—' : formatMoney(row.avgPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function AnalyticsPage() {
  const { state, loading, error } = usePaperState()

  const report = state
    ? analyticsFromPaperPositions(state.closedPositions, state.account.startingBalance)
    : null

  const curve = report?.equityCurve ?? []
  const chartData = curve.map((point) => point.equity)
  const labels =
    curve.length >= 2
      ? [formatDate(curve[0].at), formatDate(curve[curve.length - 1].at)]
      : []
  const chartTone = (report?.netPnl ?? 0) < 0 ? 'neg' : 'pos'

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Intelligence</div>
          <h1 style={{ marginTop: 4 }}>Analytics</h1>
          <p>
            Performance of the virtual paper portfolio only. These numbers are calculated from closed
            simulated trades, net of fees and slippage. They are not live or real-account results.
          </p>
        </div>
        <Notice tone="ai" icon="flask">
          Paper analytics · starting balance {formatMoney(STARTING_BALANCE)} · confidence is a setup
          score, never a win probability.
        </Notice>
      </div>

      {loading && !state ? (
        <Card className="animate-in">
          <CardBody>
            <p className="dim">Loading paper analytics…</p>
          </CardBody>
        </Card>
      ) : null}

      {error && !state ? (
        <Card className="animate-in">
          <CardBody>
            <Notice icon="alert">{error}</Notice>
          </CardBody>
        </Card>
      ) : null}

      {report ? (
        <>
          <div className="stat-grid stagger">
            <StatCard
              label="Total simulated trades"
              value={String(report.totalTrades)}
              delta={`${report.wins} wins · ${report.losses} losses`}
              note={
                report.breakEven > 0
                  ? `${report.breakEven} break-even trade${report.breakEven === 1 ? '' : 's'}`
                  : 'Closed virtual trades only'
              }
              icon="activity"
              iconTone="ai"
              badge={<Badge tone="neutral">Paper</Badge>}
            />
            <StatCard
              label="Win rate"
              value={report.winRate === null ? null : `${report.winRate}%`}
              delta={report.totalTrades > 0 ? `${report.wins} of ${report.totalTrades}` : 'no trades yet'}
              deltaTone={report.winRate === null ? 'neutral' : report.winRate >= 50 ? 'pos' : 'neg'}
              note="Wins ÷ closed trades — a small sample is not predictive"
              icon="trend"
            />
            <StatCard
              label="Average P&L / trade"
              value={report.averagePnl === null ? null : formatMoney(report.averagePnl)}
              delta={
                report.averageWin === null && report.averageLoss === null
                  ? null
                  : `avg win ${report.averageWin === null ? '—' : formatMoney(report.averageWin)} · avg loss ${report.averageLoss === null ? '—' : formatMoney(report.averageLoss)}`
              }
              deltaTone={pnlTone(report.averagePnl)}
              note="Net of entry and exit fees"
              icon="chart"
            />
            <StatCard
              label="Profit factor"
              value={report.profitFactor === null ? null : report.profitFactor.toFixed(2)}
              delta={`gross profit ${formatMoney(report.grossProfit)} · gross loss ${formatMoney(report.grossLoss)}`}
              deltaTone={report.profitFactor !== null && report.profitFactor >= 1 ? 'pos' : 'neutral'}
              note={
                report.profitFactor === null
                  ? 'Undefined without at least one losing trade'
                  : 'Gross profit ÷ gross loss'
              }
              icon="shield"
            />
            <StatCard
              label="Maximum drawdown"
              value={formatMoney(report.maxDrawdown)}
              delta={formatPercent(-report.maxDrawdownPct)}
              deltaTone={report.maxDrawdown > 0 ? 'neg' : 'neutral'}
              note={`Peak equity ${formatMoney(report.peakEquity)} · peak-to-trough on closed trades`}
              icon="arrowDown"
            />
            <StatCard
              label="Net P&L"
              value={formatMoney(report.netPnl)}
              delta={`${formatPercent(report.startingBalance > 0 ? (report.netPnl / report.startingBalance) * 100 : 0)} of starting balance`}
              deltaTone={pnlTone(report.netPnl)}
              note={`Ending equity ${formatMoney(report.endingEquity)}`}
              icon="wallet"
              iconTone="ai"
            />
          </div>

          <Card className="animate-in">
            <CardHead
              title="Equity curve"
              icon={<Icon name="chart" size={16} />}
              badge={<Badge tone={chartTone === 'pos' ? 'pos' : 'neg'}>{report.totalTrades} closed</Badge>}
            />
            <CardBody>
              {chartData.length < 2 ? (
                <EmptyState
                  icon="chart"
                  title="Not enough closed trades"
                  description="The equity curve needs at least one closed trade. Approve and close a paper position to build a history."
                  action={
                    <Link className="btn btn--sm" to="/paper-trading">
                      Open paper trading
                    </Link>
                  }
                />
              ) : (
                <>
                  <AreaChart
                    data={chartData}
                    labels={labels}
                    tone={chartTone}
                    ariaLabel="Paper portfolio equity curve from closed trades"
                  />
                  <div className="curve-meta">
                    <span>
                      <span className="dim">Start</span>{' '}
                      <strong className="mono">{formatMoney(report.startingBalance)}</strong>
                    </span>
                    <span>
                      <span className="dim">End</span>{' '}
                      <strong className="mono">{formatMoney(report.endingEquity)}</strong>
                    </span>
                    <span>
                      <span className="dim">Peak</span>{' '}
                      <strong className="mono">{formatMoney(report.peakEquity)}</strong>
                    </span>
                    <span>
                      <span className="dim">Max drawdown</span>{' '}
                      <strong className="mono neg">{formatPercent(-report.maxDrawdownPct)}</strong>
                    </span>
                  </div>
                </>
              )}
            </CardBody>
            <CardFoot>
              The curve reconstructs equity from realised P&L in close order, starting at the paper
              account&apos;s initial balance. Open positions are not included.
            </CardFoot>
          </Card>

          {report.bestTrade || report.worstTrade ? (
            <div className="dash-grid">
              <Card className="animate-in">
                <CardHead
                  title="Best trade"
                  icon={<Icon name="arrowUp" size={16} />}
                  badge={<Badge tone="pos">Best</Badge>}
                />
                <CardBody>
                  {report.bestTrade ? (
                    <div className="highlight-trade">
                      <strong className="mono">
                        {report.bestTrade.symbol} {report.bestTrade.side}
                      </strong>
                      <span className={`mono ${pnlTone(report.bestTrade.pnl)}`}>
                        {formatMoney(report.bestTrade.pnl)}
                      </span>
                      <span className="dim">
                        {report.bestTrade.exitReason} · closed {formatClock(report.bestTrade.closedAt)}
                      </span>
                    </div>
                  ) : (
                    <p className="dim">No trades.</p>
                  )}
                </CardBody>
              </Card>
              <Card className="animate-in">
                <CardHead
                  title="Worst trade"
                  icon={<Icon name="arrowDown" size={16} />}
                  badge={<Badge tone="neg">Worst</Badge>}
                />
                <CardBody>
                  {report.worstTrade ? (
                    <div className="highlight-trade">
                      <strong className="mono">
                        {report.worstTrade.symbol} {report.worstTrade.side}
                      </strong>
                      <span className={`mono ${pnlTone(report.worstTrade.pnl)}`}>
                        {formatMoney(report.worstTrade.pnl)}
                      </span>
                      <span className="dim">
                        {report.worstTrade.exitReason} · closed {formatClock(report.worstTrade.closedAt)}
                      </span>
                    </div>
                  ) : (
                    <p className="dim">No trades.</p>
                  )}
                </CardBody>
              </Card>
            </div>
          ) : null}

          <div className="dash-grid">
            <BreakdownTable
              title="Performance by asset"
              icon="wallet"
              rows={report.bySymbol}
              emptyLabel="Closed paper trades grouped by symbol appear here."
            />
            <BreakdownTable
              title="Performance by timeframe"
              icon="clock"
              rows={report.byTimeframe}
              emptyLabel="Closed paper trades grouped by timeframe appear here."
            />
          </div>

          <Card className="animate-in">
            <CardHead
              title="Closed virtual trades"
              icon={<Icon name="activity" size={16} />}
              badge={<Badge tone="neutral">{report.totalTrades} trades</Badge>}
            />
            <CardBody flush>
              {report.totalTrades === 0 ? (
                <EmptyState
                  icon="clock"
                  title="No closed trades yet"
                  description="Approved paper positions appear here after they exit at a stop, target or manual close."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>TF</th>
                        <th>Side</th>
                        <th>Exit</th>
                        <th>Closed</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(state?.closedPositions ?? [])]
                        .filter((position) => position.realizedPnl !== null)
                        .sort(
                          (a, b) =>
                            (b.closedAt ?? 0) - (a.closedAt ?? 0),
                        )
                        .map((position) => (
                          <tr key={position.id}>
                            <td>
                              <strong>{position.symbol}</strong>
                            </td>
                            <td>{position.interval}</td>
                            <td>{position.side}</td>
                            <td>{position.exitReason ?? '—'}</td>
                            <td className="mono">
                              {position.closedAt ? formatClock(position.closedAt) : '—'}
                            </td>
                            <td className={`mono ${pnlTone(position.realizedPnl)}`}>
                              {formatMoney(position.realizedPnl)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
            <CardFoot>
              Past paper performance does not guarantee future results. No real order was placed.
            </CardFoot>
          </Card>
        </>
      ) : null}
    </>
  )
}
