import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '../components/ui/Badge'
import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { Button } from '../components/ui/Controls'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { formatClock, formatMoney, formatPercent, formatPrice } from '../lib/format'
import { pnlTone } from '../lib/paperTrading'
import {
  virtualPortfolioFromPaperState,
  type BinancePortfolioStatus,
  type VirtualPortfolio,
} from '../lib/portfolio'
import {
  connectBinanceRequest,
  disconnectBinanceRequest,
  fetchBinancePortfolioStatus,
  PortfolioApiError,
  refreshBinanceRequest,
} from '../lib/portfolioApi'
import { usePaperState } from '../paper/PaperStateProvider'

/* ------------------------------------------------------------------ */
/* Virtual portfolio                                                  */
/* ------------------------------------------------------------------ */

function AllocationRow({
  label,
  value,
  pct,
  desaturated,
}: {
  label: string
  value: string
  pct: number | null
  desaturated?: boolean
}) {
  return (
    <div className="alloc-row">
      <span className="alloc-row__label">{label}</span>
      <span className={`alloc-bar${desaturated ? ' alloc-bar--cash' : ''}`} aria-hidden="true">
        <span style={{ width: `${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      <span className="alloc-row__value mono">{value}</span>
      <span className="alloc-row__pct mono">{pct === null ? '—' : `${pct.toFixed(1)}%`}</span>
    </div>
  )
}

function VirtualPortfolioCard({ portfolio }: { portfolio: VirtualPortfolio }) {
  const tone = pnlTone(portfolio.totalPnl)

  return (
    <>
      <div className="stat-grid stagger">
        <StatCard
          label="Virtual equity"
          value={formatMoney(portfolio.equity)}
          delta={`${formatMoney(portfolio.totalPnl)} since start`}
          deltaTone={tone}
          note={`Starting balance ${formatMoney(portfolio.startingBalance)} · virtual only`}
          icon="wallet"
          iconTone="ai"
          badge={<Badge tone="live">Paper</Badge>}
        />
        <StatCard
          label="Cash"
          value={formatMoney(portfolio.cash)}
          delta={portfolio.cashAllocationPct === null ? 'allocation unavailable' : `${portfolio.cashAllocationPct}% of gross`}
          note="Uncommitted USDT in the virtual account"
          icon="shield"
        />
        <StatCard
          label="Realised P&L"
          value={formatMoney(portfolio.realizedPnl)}
          deltaTone={pnlTone(portfolio.realizedPnl)}
          note="Closed virtual trades, net of fees and slippage"
          icon="trend"
        />
        <StatCard
          label="Unrealised P&L"
          value={portfolio.unrealizedPnl === null ? null : formatMoney(portfolio.unrealizedPnl)}
          note={
            portfolio.unrealizedPnl === null
              ? 'At least one open position has no verified mark'
              : `Marked with verified prices · exposure ${formatMoney(portfolio.exposure)}`
          }
          icon="activity"
        />
      </div>

      <div className="dash-grid">
        <div className="span-2">
          <Card className="animate-in">
            <CardHead
              title="Allocation"
              icon={<Icon name="chart" size={16} />}
              badge={<Badge tone="neutral">Virtual</Badge>}
            />
            <CardBody>
              {portfolio.assets.length === 0 ? (
                <EmptyState
                  icon="wallet"
                  title="No open exposure"
                  description="All virtual capital is in cash. Approve a paper trade to see asset allocation here."
                  action={
                    <Link className="btn btn--sm" to="/paper-trading">
                      Open paper trading
                    </Link>
                  }
                />
              ) : (
                <div className="alloc-list">
                  <AllocationRow
                    label="USDT cash"
                    value={formatMoney(portfolio.cash)}
                    pct={portfolio.cashAllocationPct}
                    desaturated
                  />
                  {portfolio.assets.map((asset) => (
                    <AllocationRow
                      key={asset.symbol}
                      label={`${asset.base} ${asset.netQuantity >= 0 ? 'long' : 'short'}`}
                      value={asset.value === null ? 'unpriced' : formatMoney(Math.abs(asset.value))}
                      pct={asset.allocationPct}
                    />
                  ))}
                </div>
              )}

              {!portfolio.allocationComplete ? (
                <Notice icon="alert">
                  Allocation percentages are hidden because at least one open position has no
                  verified mark price. Values are never estimated.
                </Notice>
              ) : null}

              <p className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>
                Gross allocation = cash + absolute open-position value. Short exposure is shown as a
                negative quantity but counted by its absolute value. No leverage.
              </p>
            </CardBody>
          </Card>

          <Card className="animate-in">
            <CardHead
              title="Asset balances"
              icon={<Icon name="wallet" size={16} />}
              badge={<Badge tone="neutral">{portfolio.assets.length} assets</Badge>}
            />
            <CardBody flush>
              {portfolio.assets.length === 0 ? (
                <EmptyState
                  icon="wallet"
                  title="No virtual asset balances"
                  description="Open paper positions appear here with their net quantity and mark value."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Net qty</th>
                        <th>Mark</th>
                        <th>Value</th>
                        <th>Allocation</th>
                        <th>Unrealised</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.assets.map((asset) => (
                        <tr key={asset.symbol}>
                          <td>
                            <strong>{asset.base}</strong>{' '}
                            <span className="dim">{asset.symbol}</span>
                          </td>
                          <td className="mono">{asset.netQuantity}</td>
                          <td className="mono">
                            {asset.markPrice === null ? '—' : formatPrice(asset.markPrice)}
                          </td>
                          <td className="mono">
                            {asset.value === null ? 'unpriced' : formatMoney(asset.value)}
                          </td>
                          <td className="mono">
                            {asset.allocationPct === null ? '—' : `${asset.allocationPct}%`}
                          </td>
                          <td className={`mono ${pnlTone(asset.unrealizedPnl)}`}>
                            {asset.unrealizedPnl === null ? '—' : formatMoney(asset.unrealizedPnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
            <CardFoot>
              These are virtual paper balances derived from approved signals. No exchange balance
              is included.
            </CardFoot>
          </Card>
        </div>

        <Card className="animate-in">
          <CardHead
            title="Virtual P&L"
            icon={<Icon name="trend" size={16} />}
            badge={<Badge tone={tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'neutral'}>{formatPercent(portfolio.totalPnlPct)}</Badge>}
          />
          <CardBody>
            <ul className="rule-list">
              <li>
                Realised <strong>{formatMoney(portfolio.realizedPnl)}</strong> across closed virtual
                trades.
              </li>
              <li>
                Unrealised{' '}
                <strong>
                  {portfolio.unrealizedPnl === null ? 'unavailable' : formatMoney(portfolio.unrealizedPnl)}
                </strong>{' '}
                from {portfolio.openPositions} open position{portfolio.openPositions === 1 ? '' : 's'}.
              </li>
              <li>
                Fees paid <strong>{formatMoney(portfolio.feesPaid)}</strong> (0.1% per side plus
                simulated slippage).
              </li>
              <li>
                Total return from paper start: <strong>{formatPercent(portfolio.totalPnlPct)}</strong>.
                Past paper results do not predict live results.
              </li>
            </ul>
            {portfolio.priceError ? <Notice icon="alert">{portfolio.priceError}</Notice> : null}
            <Link className="btn btn--sm" to="/analytics">
              View analytics
            </Link>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Open positions                                                     */
/* ------------------------------------------------------------------ */

function OpenPositionsCard() {
  const { state } = usePaperState()
  const open = state?.openPositions ?? []

  return (
    <Card className="animate-in">
      <CardHead
        title="Open virtual positions"
        icon={<Icon name="candles" size={16} />}
        badge={<Badge tone="live">{open.length} open</Badge>}
        actions={
          <Link className="btn btn--sm btn--ghost" to="/paper-trading">
            Manage
          </Link>
        }
      />
      <CardBody flush>
        {open.length === 0 ? (
          <EmptyState
            icon="flask"
            title="No open positions"
            description="Approved paper signals appear here with their stop, target and unrealised P&L."
          />
        ) : (
          <ul>
            {open.map((position) => (
              <li className="position-row" key={position.id}>
                <div className="signal-row__top">
                  <span className="signal-row__pair mono">{position.symbol}</span>
                  <Badge tone={position.side === 'long' ? 'pos' : 'neg'}>
                    {position.side} {position.interval}
                  </Badge>
                  <span className="dim" style={{ fontSize: 11.5 }}>
                    qty {position.quantity}
                  </span>
                  <span className={`mono ${pnlTone(position.unrealizedPnl)}`} style={{ marginLeft: 'auto' }}>
                    {position.unrealizedPnl === null ? 'unavailable' : formatMoney(position.unrealizedPnl)}
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Real read-only account                                             */
/* ------------------------------------------------------------------ */

function RealAccountCard() {
  const [status, setStatus] = useState<BinancePortfolioStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const next = await fetchBinancePortfolioStatus()
        if (mounted) setStatus(next)
      } catch (caught) {
        if (mounted) {
          setError(caught instanceof PortfolioApiError ? caught.message : 'Unable to load portfolio status.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const run = async (fn: () => Promise<BinancePortfolioStatus>, clearForm = false) => {
    setBusy(true)
    setError(null)
    try {
      const next = await fn()
      setStatus(next)
      if (clearForm) {
        setApiKey('')
        setSecret('')
      }
    } catch (caught) {
      setError(caught instanceof PortfolioApiError ? caught.message : 'The request failed.')
    } finally {
      setBusy(false)
    }
  }

  const onConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (apiKey.trim().length === 0 || secret.trim().length === 0) {
      setError('Both the API key and secret are required.')
      return
    }
    void run(() => connectBinanceRequest(apiKey, secret), true)
  }

  const snapshot = status?.snapshot ?? null

  return (
    <Card className="animate-in">
      <CardHead
        title="Binance account"
        icon={<Icon name="lock" size={16} />}
        badge={
          status?.connected ? (
            <Badge tone="live">Read-only connected</Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )
        }
      />
      <CardBody>
        <Notice tone="ai" icon="shield">
          <strong>Read-only by construction.</strong> The server only calls{' '}
          <span className="mono">GET /api/v3/account</span>. There are no order, transfer or
          withdrawal endpoints in this app. Use a Binance key with reading enabled and trading and
          withdrawals disabled. Keys are held in server memory only — never stored, never logged,
          and lost on restart.
        </Notice>

        {error ? <Notice icon="alert">{error}</Notice> : null}

        {loading ? <p className="dim">Checking connection…</p> : null}

        {!loading && !status?.connected ? (
          <form className="form-grid" onSubmit={onConnect}>
            <label className="field">
              <span>API key</span>
              <input
                className="field__input"
                type="text"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Public API key"
              />
            </label>
            <label className="field">
              <span>API secret</span>
              <input
                className="field__input"
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Secret is sent only to this local server"
              />
            </label>
            <div className="form-actions">
              <Button type="submit" variant="primary" icon={<Icon name="lock" size={14} />}>
                {busy ? 'Connecting…' : 'Connect read-only'}
              </Button>
              <span className="dim" style={{ fontSize: 11.5 }}>
                Never share a key with withdrawal permission. IP-restrict it in Binance if possible.
              </span>
            </div>
          </form>
        ) : null}

        {status?.connected ? (
          <>
            <div className="account-meta">
              <span>
                <span className="dim">Key</span> <strong className="mono">{status.keyHint ?? '—'}</strong>
              </span>
              <span>
                <span className="dim">Connected</span>{' '}
                <strong>{status.connectedAt ? formatClock(status.connectedAt) : '—'}</strong>
              </span>
              <span>
                <span className="dim">Account type</span>{' '}
                <strong>{snapshot?.accountType ?? 'not reported'}</strong>
              </span>
              <span>
                <span className="dim">Key permissions</span>{' '}
                <strong>
                  {snapshot
                    ? `trade ${snapshot.canTrade ? 'ON' : 'OFF'} · withdraw ${snapshot.canWithdraw ? 'ON' : 'OFF'}`
                    : 'unknown'}
                </strong>
              </span>
            </div>

            {snapshot?.permissionWarning ? (
              <Notice icon="alert">{snapshot.permissionWarning}</Notice>
            ) : null}

            <div className="form-actions">
              <Button
                icon={<Icon name="refresh" size={14} />}
                onClick={() => void run(refreshBinanceRequest)}
              >
                {busy ? 'Refreshing…' : 'Refresh balances'}
              </Button>
              <Button variant="ghost" onClick={() => void run(disconnectBinanceRequest)}>
                Disconnect
              </Button>
            </div>

            {snapshot && snapshot.balances.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="No non-zero balances"
                description="Binance returned an account with no free or locked balances."
              />
            ) : null}

            {snapshot && snapshot.balances.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Free</th>
                        <th>Locked</th>
                        <th>Total</th>
                        <th>USDT value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.balances.map((balance) => (
                        <tr key={balance.asset}>
                          <td>
                            <strong>{balance.asset}</strong>
                          </td>
                          <td className="mono">{balance.free}</td>
                          <td className="mono">{balance.locked}</td>
                          <td className="mono">{balance.total}</td>
                          <td className="mono">
                            {balance.usdtValue === null ? 'unpriced' : formatMoney(balance.usdtValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Valued subset: <strong>{formatMoney(snapshot.valuedSubtotal)}</strong>
                  {snapshot.unpricedAssets.length > 0
                    ? ` · unpriced: ${snapshot.unpricedAssets.join(', ')}. No price was invented for these assets.`
                    : ' · every non-zero balance is valued with a verified public price.'}{' '}
                  Fetched {formatClock(snapshot.fetchedAt)}.
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {!status?.connected && !loading ? (
          <p className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>
            {status?.message ?? 'Binance account access is available once a read-only key is added.'}
          </p>
        ) : null}
      </CardBody>
      <CardFoot>
        Real balances are displayed separately from the virtual portfolio below. CryptoPilot cannot
        trade, transfer or withdraw with this connection.
      </CardFoot>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export function PortfolioPage() {
  const { state, loading, error } = usePaperState()
  const virtual = state ? virtualPortfolioFromPaperState(state) : null

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Trading</div>
          <h1 style={{ marginTop: 4 }}>Portfolio</h1>
          <p>
            Two separate views: a read-only snapshot of a connected Binance account, and the virtual
            paper portfolio built only from approved simulated trades. They are never mixed.
          </p>
        </div>
        <Notice tone="ai" icon="lock">
          Real account access is read-only. The virtual portfolio is simulated and never touches
          real money.
        </Notice>
      </div>

      <div className="section-label">
        <span className="eyebrow">Real account</span>
        <span className="dim">Read-only · GET /api/v3/account only</span>
      </div>
      <RealAccountCard />

      <div className="section-label">
        <span className="eyebrow">Virtual paper portfolio</span>
        <span className="dim">Simulated · no real funds</span>
      </div>

      {loading && !state ? (
        <Card className="animate-in">
          <CardBody>
            <p className="dim">Loading the virtual portfolio…</p>
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

      {virtual ? <VirtualPortfolioCard portfolio={virtual} /> : null}
      <OpenPositionsCard />
    </>
  )
}
