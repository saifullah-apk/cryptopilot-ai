import { useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { Button, Segmented } from '../components/ui/Controls'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { SignalCard } from '../components/paper/SignalCard'
import { usePaperState } from '../paper/PaperStateProvider'
import { formatClock, formatMoney, formatPercent, formatPrice } from '../lib/format'
import {
  MAX_OPEN_POSITIONS,
  PAPER_INTERVALS,
  PAPER_SYMBOLS,
  pnlTone,
  type PaperInterval,
  type PaperPosition,
  type PaperSymbol,
} from '../lib/paperTrading'

function PositionRow({
  position,
  busy,
  onClose,
}: {
  position: PaperPosition
  busy: boolean
  onClose: (id: string) => void
}) {
  const tone = pnlTone(position.unrealizedPnl)
  return (
    <li className="position-row">
      <div className="signal-row__top">
        <span className="signal-row__pair mono">{position.symbol}</span>
        <Badge tone={position.side === 'long' ? 'pos' : 'neg'}>
          {position.side} {position.interval}
        </Badge>
        <span className="dim" style={{ fontSize: 11.5 }}>
          qty {position.quantity}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Button size="sm" variant="ghost" onClick={() => onClose(position.id)}>
            {busy ? 'Closing…' : 'Close'}
          </Button>
        </span>
      </div>

      <div className="position-grid">
        <span>
          <span className="dim">Entry</span>{' '}
          <strong className="mono">{formatPrice(position.entryPrice)}</strong>
        </span>
        <span>
          <span className="dim">Mark</span>{' '}
          <strong className="mono">
            {position.currentPrice === null ? '—' : formatPrice(position.currentPrice)}
          </strong>
        </span>
        <span>
          <span className="dim">Stop</span>{' '}
          <strong className="mono">{formatPrice(position.stopLoss)}</strong>
        </span>
        <span>
          <span className="dim">Target</span>{' '}
          <strong className="mono">{formatPrice(position.takeProfit)}</strong>
        </span>
        <span>
          <span className="dim">Unrealised</span>{' '}
          <strong className={`mono ${tone}`}>
            {position.unrealizedPnl === null ? 'unavailable' : formatMoney(position.unrealizedPnl)}
          </strong>
        </span>
        <span>
          <span className="dim">Fees</span>{' '}
          <strong className="mono">{formatMoney(position.fees)}</strong>
        </span>
      </div>
    </li>
  )
}

export function PaperTradingPage() {
  const {
    state,
    loading,
    error,
    notice,
    busy,
    generate,
    approve,
    reject,
    close,
    setPaused,
    refresh,
  } = usePaperState()

  const [symbol, setSymbol] = useState<PaperSymbol>('BTCUSDT')
  const [interval, setIntervalChoice] = useState<PaperInterval>('15m')

  const account = state?.account ?? null
  const pendingSignals = (state?.signals ?? []).filter((signal) => signal.status === 'pending')
  const decidedSignals = (state?.signals ?? []).filter((signal) => signal.status !== 'pending')
  const openPositions = state?.openPositions ?? []
  const closedPositions = state?.closedPositions ?? []
  const orders = state?.orders ?? []

  const dailyUsagePct =
    account && account.dailyLossLimit > 0
      ? Math.min(100, (account.dailyLoss / account.dailyLossLimit) * 100)
      : 0

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Trading</div>
          <h1 style={{ marginTop: 4 }}>Paper trading</h1>
          <p>
            Signals are generated from verified Binance public data, reviewed by you, and only
            approved signals open virtual positions. No real money, no exchange account, no
            withdrawals.
          </p>
        </div>
        <Notice tone="ai" icon="flask">
          Virtual account only · $10,000 simulated starting balance · 0.1% fee, 0.05% slippage.
        </Notice>
      </div>

      {loading && !state ? (
        <Card className="animate-in">
          <CardBody>
            <p className="dim">Loading paper-trading state…</p>
          </CardBody>
        </Card>
      ) : null}

      {error && !state ? (
        <Card className="animate-in">
          <CardBody>
            <Notice icon="alert">{error}</Notice>
            <Button icon={<Icon name="refresh" size={14} />} onClick={() => void refresh()}>
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {state && account ? (
        <>
          {notice ? (
            <Notice icon={notice.tone === 'neg' ? 'alert' : 'info'} tone={notice.tone === 'ai' ? 'ai' : 'default'}>
              {notice.text}
            </Notice>
          ) : null}

          {state.priceError ? <Notice icon="alert">{state.priceError}</Notice> : null}

          <div className="stat-grid stagger">
            <StatCard
              label="Equity"
              value={formatMoney(account.equity)}
              delta={
                account.unrealizedPnl === null
                  ? 'marks unavailable'
                  : `${formatMoney(account.equity - account.startingBalance)} overall`
              }
              deltaTone={
                account.unrealizedPnl === null
                  ? 'neutral'
                  : account.equity >= account.startingBalance
                    ? 'pos'
                    : 'neg'
              }
              note={`Starting balance ${formatMoney(account.startingBalance)} · cash ${formatMoney(account.cash)}`}
              icon="wallet"
              iconTone="ai"
              badge={<Badge tone="live">Live paper</Badge>}
            />
            <StatCard
              label="Realised P&L"
              value={formatMoney(account.realizedPnl)}
              delta={`${account.closedTrades} closed · ${account.wins}W / ${account.losses}L`}
              deltaTone={pnlTone(account.realizedPnl)}
              note={
                account.winRate === null
                  ? 'Win rate appears after the first closed trade'
                  : `Win rate ${account.winRate}% — past results do not predict future ones`
              }
              icon="trend"
            />
            <StatCard
              label="Unrealised P&L"
              value={account.unrealizedPnl === null ? null : formatMoney(account.unrealizedPnl)}
              delta={`${account.openPositionsCount}/${account.maxOpenPositions} open positions`}
              note={
                account.unrealizedPnl === null
                  ? 'At least one position could not be marked with a verified price'
                  : 'Marked with live Binance public prices'
              }
              icon="activity"
            />
            <StatCard
              label="Daily loss used"
              value={`${formatMoney(account.dailyLoss)} / ${formatMoney(account.dailyLossLimit)}`}
              delta={formatPercent((account.dailyLoss / account.startingBalance) * 100)}
              deltaTone={dailyUsagePct >= 80 ? 'neg' : 'neutral'}
              note={`${account.dailyLossLimitPct}% of starting balance · resets 00:00 UTC`}
              icon="shield"
              badge={account.paused ? <Badge tone="warn">Paused</Badge> : undefined}
            />
          </div>

          <div className="dash-grid">
            <div className="span-2">
              <Card className="animate-in">
                <CardHead
                  title="Generate signal"
                  icon={<Icon name="spark" size={16} />}
                  badge={<Badge tone="ai">AI + rules</Badge>}
                />
                <CardBody>
                  <div className="generator-row">
                    <div className="generator-field">
                      <span className="dim">Symbol</span>
                      <Segmented
                        ariaLabel="Symbol"
                        value={symbol}
                        onChange={(value) => setSymbol(value)}
                        options={PAPER_SYMBOLS.map((value) => ({ value, label: value.replace('USDT', '') }))}
                      />
                    </div>
                    <div className="generator-field">
                      <span className="dim">Timeframe</span>
                      <Segmented
                        ariaLabel="Timeframe"
                        value={interval}
                        onChange={(value) => setIntervalChoice(value)}
                        options={PAPER_INTERVALS.map((value) => ({ value, label: value }))}
                      />
                    </div>
                    <div className="generator-field">
                      <span className="dim">Action</span>
                      <Button
                        variant="ai"
                        icon={<Icon name="send" size={14} />}
                        onClick={() => void generate(symbol, interval)}
                      >
                        {busy ? 'Generating…' : 'Generate signal'}
                      </Button>
                    </div>
                  </div>
                  <p className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>
                    One pending signal per symbol+timeframe. BUY/SELL can be approved into a virtual
                    trade; HOLD and NO TRADE are educational only. Confidence is a setup score, not a
                    win probability.
                  </p>
                </CardBody>
              </Card>

              <Card className="animate-in">
                <CardHead
                  title="Risk controls"
                  icon={<Icon name="shield" size={16} />}
                  badge={
                    account.paused ? <Badge tone="warn">Emergency pause ON</Badge> : <Badge tone="live">Active</Badge>
                  }
                />
                <CardBody>
                  <ul className="rule-list">
                    <li>
                      Max <strong>1%</strong> of equity risked per trade (mandatory stop-loss, no
                      exceptions).
                    </li>
                    <li>
                      Max <strong>{MAX_OPEN_POSITIONS}</strong> open positions · one position per
                      symbol (duplicate orders blocked).
                    </li>
                    <li>
                      Daily loss limit <strong>{formatMoney(account.dailyLossLimit)}</strong> (
                      {account.dailyLossLimitPct}% of starting balance), realised P&L only, resets
                      00:00 UTC.
                    </li>
                    <li>
                      Signals expire (15m → 30 min, 1h → 60 min) and cannot execute if price drifted
                      more than 0.75% from the signal's market price.
                    </li>
                  </ul>

                  <div className="meter" aria-label="Daily loss usage">
                    <span
                      className={`meter__fill${dailyUsagePct >= 80 ? ' meter__fill--warn' : ''}`}
                      style={{ width: `${dailyUsagePct}%` }}
                    />
                  </div>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {dailyUsagePct.toFixed(1)}% of the daily loss budget used today.
                  </div>

                  <div className="signal-actions" style={{ marginTop: 14 }}>
                    <Button
                      variant={account.paused ? 'primary' : 'ghost'}
                      onClick={() => void setPaused(!account.paused)}
                    >
                      {account.paused ? 'Resume paper trading' : 'Emergency pause'}
                    </Button>
                    <span className="dim" style={{ fontSize: 11.5 }}>
                      {account.paused
                        ? 'New approvals are blocked. Generation and position closing still work.'
                        : 'Pause blocks approvals only — open positions can still be closed.'}
                    </span>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card className="animate-in">
              <CardHead
                title="Pending signals"
                icon={<Icon name="bell" size={16} />}
                badge={<Badge tone="neutral">{pendingSignals.length} awaiting review</Badge>}
              />
              <CardBody>
                {pendingSignals.length === 0 ? (
                  <EmptyState
                    icon="flask"
                    title="No pending signals"
                    description="Generate one on the left. You review every signal before it can become a trade."
                  />
                ) : (
                  <div className="signal-stack">
                    {pendingSignals.map((signal) => (
                      <SignalCard
                        key={signal.id}
                        signal={signal}
                        busy={busy}
                        onApprove={(id) => void approve(id, 1)}
                        onReject={(id) => void reject(id)}
                      />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <div className="span-3">
              <Card className="animate-in">
                <CardHead
                  title="Open positions"
                  icon={<Icon name="candles" size={16} />}
                  badge={<Badge tone="live">{openPositions.length} open</Badge>}
                />
                <CardBody flush>
                  {openPositions.length === 0 ? (
                    <EmptyState
                      icon="flask"
                      title="No open positions"
                      description="Approve a BUY or SELL signal to open a virtual position with a mandatory stop-loss."
                    />
                  ) : (
                    <ul>
                      {openPositions.map((position) => (
                        <PositionRow
                          key={position.id}
                          position={position}
                          busy={busy}
                          onClose={(id) => void close(id)}
                        />
                      ))}
                    </ul>
                  )}
                </CardBody>
                <CardFoot>
                  SL/TP are simulated against verified prices on every poll: stops fill with adverse
                  slippage, targets fill at the limit level.
                </CardFoot>
              </Card>
            </div>

            <div className="span-3">
              <Card className="animate-in">
                <CardHead
                  title="Trade history"
                  icon={<Icon name="activity" size={16} />}
                  badge={<Badge tone="neutral">{closedPositions.length} closed</Badge>}
                />
                <CardBody flush>
                  {closedPositions.length === 0 ? (
                    <EmptyState
                      icon="clock"
                      title="No closed trades yet"
                      description="Realised P&L, wins and losses appear here once a position exits."
                    />
                  ) : (
                    <ul>
                      {closedPositions.map((position) => (
                        <li className="activity-row" key={position.id}>
                          <span
                            className={`activity__icon activity__icon--${
                              pnlTone(position.realizedPnl) === 'pos'
                                ? 'pos'
                                : pnlTone(position.realizedPnl) === 'neg'
                                  ? 'neg'
                                  : 'neutral'
                            }`}
                          >
                            <Icon
                              name={
                                (position.realizedPnl ?? 0) >= 0 ? 'arrowUp' : 'arrowDown'
                              }
                              size={16}
                            />
                          </span>
                          <span className="activity__body">
                            <span className="activity__title">
                              {position.symbol} {position.side} closed ·{' '}
                              <span className={`mono ${pnlTone(position.realizedPnl)}`}>
                                {formatMoney(position.realizedPnl)}
                              </span>
                            </span>
                            <br />
                            <span className="activity__sub">
                              {position.exitReason ?? 'exit'} @ {formatPrice(position.exitPrice)} ·
                              fees {formatMoney(position.fees)}
                            </span>
                          </span>
                          <span className="activity__time">
                            {position.closedAt ? formatClock(position.closedAt) : '—'}
                            <br />
                            <span className="dim">paper</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>

            <div className="span-3">
              <Card className="animate-in">
                <CardHead
                  title="Order fills"
                  icon={<Icon name="send" size={16} />}
                  badge={<Badge tone="neutral">{orders.length} simulated</Badge>}
                />
                <CardBody flush>
                  {orders.length === 0 ? (
                    <EmptyState
                      icon="flask"
                      title="No fills yet"
                      description="Every simulated fill records requested price, fill price, fee and slippage."
                    />
                  ) : (
                    <ul>
                      {orders.map((order) => (
                        <li className="activity-row" key={order.id}>
                          <span
                            className={`activity__icon activity__icon--${
                              order.side === 'buy' ? 'pos' : 'neg'
                            }`}
                          >
                            <Icon name={order.side === 'buy' ? 'arrowUp' : 'arrowDown'} size={16} />
                          </span>
                          <span className="activity__body">
                            <span className="activity__title">
                              {order.side.toUpperCase()} {order.quantity} {order.symbol} @{' '}
                              <span className="mono">{formatPrice(order.fillPrice)}</span>
                            </span>
                            <br />
                            <span className="activity__sub">
                              requested {formatPrice(order.requestedPrice)} · fee{' '}
                              {formatMoney(order.fee)} · slippage{' '}
                              {formatMoney(order.slippageCost)}
                            </span>
                          </span>
                          <span className="activity__time">
                            {formatClock(order.createdAt)}
                            <br />
                            <span className="dim">simulated</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
                <CardFoot>
                  These are simulated fills produced by the paper engine — no exchange order was
                  ever sent.
                </CardFoot>
              </Card>
            </div>

            {decidedSignals.length > 0 ? (
              <div className="span-3">
                <Card className="animate-in">
                  <CardHead
                    title="Signal history"
                    icon={<Icon name="clock" size={16} />}
                    badge={<Badge tone="neutral">{decidedSignals.length} decided</Badge>}
                  />
                  <CardBody>
                    <div className="signal-stack">
                      {decidedSignals.map((signal) => (
                        <SignalCard key={signal.id} signal={signal} now={state.serverTime} />
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  )
}
