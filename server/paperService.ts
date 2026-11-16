/**
 * Paper trading service — approval workflow, virtual execution, risk
 * controls and stop-loss / take-profit simulation.
 *
 * Every price used here comes from an injected `PriceFeed` (the Binance
 * public ticker in production, a fake in tests). No exchange order
 * endpoints, no credentials, no real money.
 */

import { randomUUID } from 'node:crypto'

import { fetchTickers24h, type Ticker24h } from '../src/lib/binance.ts'
import {
  DEFAULT_RISK_PCT,
  MAX_OPEN_POSITIONS,
  MAX_RISK_PCT,
  MAX_SIGNAL_DRIFT_PCT,
  applySlippage,
  calculateFee,
  calculatePositionSize,
  dailyLossLimitFor,
  grossPnl,
  isExecutableAction,
  netRealizedPnl,
  round,
  type ExitReason,
  type PaperAccount,
  type PaperOrder,
  type PaperPosition,
  type PaperState,
  type TradeSignal,
} from '../src/lib/paperTrading.ts'
import { isSignalExpired } from '../src/lib/signals.ts'
import type { PaperStore } from './paperStore.ts'

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export class PaperError extends Error {
  status: number
  code: string

  constructor(message: string, status = 409, code = 'rejected') {
    super(message)
    this.name = 'PaperError'
    this.status = status
    this.code = code
  }
}

export class MarketPriceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketPriceError'
  }
}

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

export type PriceFeed = (symbols: readonly string[]) => Promise<Ticker24h[]>

export type PaperServiceDeps = {
  store: PaperStore
  fetchPrices?: PriceFeed
}

export type ApproveResult = {
  signal: TradeSignal
  position: PaperPosition
  state: PaperState
}

export type PaperService = {
  getState(): Promise<PaperState>
  approve(signalId: string, riskPct: number): Promise<ApproveResult>
  reject(signalId: string, note: string | null): Promise<PaperState>
  closePosition(positionId: string): Promise<PaperState>
  setPaused(paused: boolean): Promise<PaperState>
}

const defaultFeed: PriceFeed = (symbols) => fetchTickers24h(symbols)

function startOfUtcDay(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function createPaperService(deps: PaperServiceDeps): PaperService {
  const store = deps.store
  const fetchPrices = deps.fetchPrices ?? defaultFeed

  /* ---- price marks ---------------------------------------------------- */

  async function loadMarks(
    extraSymbols: readonly string[] = [],
  ): Promise<{ marks: Map<string, number>; error: string | null }> {
    const symbols = new Set<string>(extraSymbols)
    for (const position of store.listOpenPositions()) symbols.add(position.symbol)
    if (symbols.size === 0) return { marks: new Map(), error: null }

    try {
      const tickers = await fetchPrices([...symbols])
      const marks = new Map<string, number>()
      for (const ticker of tickers) marks.set(ticker.symbol, ticker.lastPrice)
      return { marks, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Market prices are unavailable.'
      return { marks: new Map(), error: `Unable to refresh market prices: ${message}` }
    }
  }

  function costBasisValue(position: PaperPosition): number {
    const notional = position.quantity * position.entryPrice
    return position.side === 'long' ? notional : -notional
  }

  function markValue(position: PaperPosition, marks: Map<string, number>): number | null {
    const mark = marks.get(position.symbol)
    if (mark === undefined || !Number.isFinite(mark)) return null
    const notional = position.quantity * mark
    return position.side === 'long' ? notional : -notional
  }

  function decorate(position: PaperPosition, marks: Map<string, number>): PaperPosition {
    if (position.status === 'closed') {
      const notional = position.quantity * position.entryPrice
      return {
        ...position,
        currentPrice: null,
        unrealizedPnl: null,
        pnlPercent:
          position.realizedPnl !== null && notional > 0
            ? round((position.realizedPnl / notional) * 100, 2)
            : null,
      }
    }

    const mark = marks.get(position.symbol)
    if (mark === undefined || !Number.isFinite(mark)) {
      return { ...position, currentPrice: null, unrealizedPnl: null, pnlPercent: null }
    }

    const unrealized = grossPnl(position.side, position.entryPrice, mark, position.quantity) - position.fees
    const notional = position.quantity * position.entryPrice
    return {
      ...position,
      currentPrice: mark,
      unrealizedPnl: round(unrealized, 2),
      pnlPercent: notional > 0 ? round((unrealized / notional) * 100, 2) : null,
    }
  }

  /* ---- account -------------------------------------------------------- */

  function buildAccount(
    marks: Map<string, number>,
    open: PaperPosition[],
    closed: PaperPosition[],
  ): { account: PaperAccount; allMarked: boolean } {
    const row = store.getAccount()
    const dailySince = startOfUtcDay(Date.now())

    let unrealizedSum = 0
    let allMarked = true
    for (const position of open) {
      const value = markValue(position, marks)
      if (value === null) {
        allMarked = false
        unrealizedSum += costBasisValue(position)
      } else {
        unrealizedSum += value
      }
    }

    const equity = row.cash + unrealizedSum
    const realizedPnl = closed.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0)
    const feesPaid =
      open.reduce((sum, position) => sum + position.fees, 0) +
      closed.reduce((sum, position) => sum + position.fees, 0)

    const dailyPnl = store
      .closedSince(dailySince)
      .reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0)

    const wins = closed.filter((position) => (position.realizedPnl ?? 0) > 0).length
    const losses = closed.filter((position) => (position.realizedPnl ?? 0) < 0).length
    const closedTrades = closed.length

    // Unrealised P&L is only reported when every open position could be
    // marked with a verified price — otherwise the equity falls back to a
    // cost-basis valuation and the caller sees `priceError`.
    const costBasis = open.reduce((sum, position) => sum + costBasisValue(position), 0)
    const unrealizedPnl = allMarked ? unrealizedSum - costBasis : null

    const account: PaperAccount = {
      startingBalance: row.startingBalance,
      cash: round(row.cash, 2),
      equity: round(equity, 2),
      realizedPnl: round(realizedPnl, 2),
      unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl, 2),
      feesPaid: round(feesPaid, 2),
      openPositionsCount: open.length,
      maxOpenPositions: MAX_OPEN_POSITIONS,
      riskPerTradePct: DEFAULT_RISK_PCT,
      maxRiskPerTradePct: MAX_RISK_PCT,
      dailyPnl: round(dailyPnl, 2),
      dailyLoss: round(Math.max(0, -dailyPnl), 2),
      dailyLossLimit: round(dailyLossLimitFor(row.startingBalance), 2),
      dailyLossLimitPct: 3,
      paused: row.paused,
      closedTrades,
      wins,
      losses,
      winRate: closedTrades > 0 ? round((wins / closedTrades) * 100, 1) : null,
    }

    return { account, allMarked }
  }

  /* ---- position closing ---------------------------------------------- */

  function closePositionInternal(
    position: PaperPosition,
    reason: ExitReason,
    marketPrice: number,
    now: number,
  ): void {
    const orderSide = position.side === 'long' ? 'sell' : 'buy'
    // Stop-loss and manual exits are market orders (adverse slippage);
    // a take-profit fills at its limit level.
    const requestedPrice = reason === 'take-profit' ? position.takeProfit : marketPrice
    const fillPrice =
      reason === 'take-profit' ? position.takeProfit : applySlippage(marketPrice, orderSide)

    const exitFee = calculateFee(position.quantity * fillPrice)
    const realized = netRealizedPnl(
      position.side,
      position.entryPrice,
      fillPrice,
      position.quantity,
      position.fees,
      exitFee,
    )
    const cashDelta =
      orderSide === 'sell'
        ? position.quantity * fillPrice - exitFee
        : -(position.quantity * fillPrice + exitFee)

    store.transaction(() => {
      store.setCash(store.getAccount().cash + cashDelta)
      store.closePosition(position.id, {
        exitPrice: fillPrice,
        exitReason: reason,
        closedAt: now,
        realizedPnl: realized,
        fees: position.fees + exitFee,
      })
      store.insertOrder({
        id: randomUUID(),
        signalId: position.signalId,
        positionId: position.id,
        symbol: position.symbol,
        side: orderSide,
        quantity: position.quantity,
        requestedPrice,
        fillPrice,
        fee: exitFee,
        slippageCost: round(Math.abs(fillPrice - requestedPrice) * position.quantity, 6),
        createdAt: now,
      })
    })
  }

  function exitTrigger(
    position: PaperPosition,
    price: number,
  ): { reason: ExitReason; price: number } | null {
    const stopHit =
      position.side === 'long' ? price <= position.stopLoss : price >= position.stopLoss
    if (stopHit) return { reason: 'stop-loss', price }

    const targetHit =
      position.side === 'long' ? price >= position.takeProfit : price <= position.takeProfit
    if (targetHit) return { reason: 'take-profit', price }

    return null
  }

  /* ---- state ---------------------------------------------------------- */

  async function getState(): Promise<PaperState> {
    const now = Date.now()
    store.expireStaleSignals(now)

    const { marks, error } = await loadMarks()

    // Simulate protective exits against verified prices.
    for (const position of store.listOpenPositions()) {
      const price = marks.get(position.symbol)
      if (price === undefined) continue
      const trigger = exitTrigger(position, price)
      if (trigger) closePositionInternal(position, trigger.reason, trigger.price, now)
    }

    const open = store.listOpenPositions()
    const closed = store.listClosedPositions(30)
    const { account } = buildAccount(marks, open, closed)

    return {
      account,
      signals: store.listSignals(30),
      openPositions: open.map((position) => decorate(position, marks)),
      closedPositions: closed.map((position) => decorate(position, marks)),
      orders: store.listOrders(50),
      serverTime: now,
      priceSource: 'binance-public',
      priceError: error,
    }
  }

  /* ---- approval ------------------------------------------------------- */

  async function approve(signalId: string, riskPct: number): Promise<ApproveResult> {
    const now = Date.now()
    const signal = store.getSignal(signalId)
    if (!signal) throw new PaperError('Signal not found.', 404, 'not-found')

    if (signal.status !== 'pending') {
      throw new PaperError(`This signal was already ${signal.status}.`, 409, 'already-decided')
    }

    if (isSignalExpired(signal.expiresAt, now)) {
      store.decideSignal(signal.id, 'expired', 'Expired before review', now)
      throw new PaperError('The signal expired before it was reviewed.', 409, 'expired')
    }

    if (!isExecutableAction(signal.action)) {
      throw new PaperError(
        `${signal.action} signals are educational only and cannot open a virtual trade.`,
        409,
        'not-executable',
      )
    }

    const row = store.getAccount()
    if (row.paused) {
      throw new PaperError('Paper trading is paused. Resume it before approving signals.', 409, 'paused')
    }

    const open = store.listOpenPositions()
    if (open.length >= MAX_OPEN_POSITIONS) {
      throw new PaperError(
        `Maximum ${MAX_OPEN_POSITIONS} open positions allowed — close one before approving another.`,
        409,
        'max-positions',
      )
    }

    const duplicate = open.find((position) => position.symbol === signal.symbol)
    if (duplicate) {
      throw new PaperError(
        `Duplicate order blocked: ${signal.symbol} already has an open virtual position.`,
        409,
        'duplicate',
      )
    }

    const dailySince = startOfUtcDay(now)
    const dailyPnl = store
      .closedSince(dailySince)
      .reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0)
    const dailyLimit = dailyLossLimitFor(row.startingBalance)
    if (-dailyPnl >= dailyLimit) {
      throw new PaperError(
        `Daily loss limit of $${dailyLimit.toFixed(2)} reached — new trades are locked until tomorrow.`,
        409,
        'daily-loss-limit',
      )
    }

    // Verified current price for this symbol (plus marks for equity).
    let current: number
    try {
      const tickers = await fetchPrices([signal.symbol])
      const ticker = tickers.find((item) => item.symbol === signal.symbol)
      if (!ticker || !Number.isFinite(ticker.lastPrice) || ticker.lastPrice <= 0) {
        throw new Error('no usable ticker returned')
      }
      current = ticker.lastPrice
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      throw new MarketPriceError(
        `Unable to verify the current ${signal.symbol} price from Binance public data (${message}).`,
      )
    }

    const driftPct = Math.abs(current - signal.marketPrice) / signal.marketPrice * 100
    if (driftPct > MAX_SIGNAL_DRIFT_PCT) {
      store.decideSignal(
        signal.id,
        'expired',
        `Price moved ${driftPct.toFixed(2)}% since generation — generate a fresh signal.`,
        now,
      )
      throw new PaperError(
        `Price moved ${driftPct.toFixed(2)}% since this signal was generated (limit ${MAX_SIGNAL_DRIFT_PCT}%). Generate a new signal.`,
        409,
        'stale-price',
      )
    }

    const { marks } = await loadMarks([signal.symbol])
    marks.set(signal.symbol, current)
    const { account } = buildAccount(marks, open, store.listClosedPositions(1000))

    const orderSide = signal.side === 'long' ? 'buy' : 'sell'
    const fillPrice = applySlippage(current, orderSide)

    // Mandatory stop-loss must still sit on the correct side of the fill.
    const stopValid =
      Number.isFinite(signal.stopLoss) &&
      signal.stopLoss > 0 &&
      (signal.side === 'long' ? signal.stopLoss < fillPrice : signal.stopLoss > fillPrice)
    const targetValid =
      Number.isFinite(signal.takeProfit) &&
      (signal.side === 'long' ? signal.takeProfit > fillPrice : signal.takeProfit < fillPrice)

    if (!stopValid) {
      store.decideSignal(
        signal.id,
        'expired',
        'The mandatory stop-loss was already reached at the current price.',
        now,
      )
      throw new PaperError(
        'Mandatory stop-loss check failed: the stop is no longer beyond the current price.',
        409,
        'invalid-stop',
      )
    }
    if (!targetValid) {
      store.decideSignal(signal.id, 'expired', 'The take-profit target was already reached.', now)
      throw new PaperError(
        'Take-profit check failed: the target is no longer beyond the current price.',
        409,
        'invalid-target',
      )
    }

    const size = calculatePositionSize({
      equity: account.equity,
      cash: account.cash,
      riskPct,
      entryPrice: fillPrice,
      stopLoss: signal.stopLoss,
    })

    if (size.quantity <= 0) {
      throw new PaperError(
        `Position sizing failed: $${size.riskAmount.toFixed(2)} of allowed risk cannot buy a whole paper unit at this stop distance.`,
        409,
        'size-too-small',
      )
    }

    const position: PaperPosition = {
      id: randomUUID(),
      signalId: signal.id,
      symbol: signal.symbol,
      interval: signal.interval,
      side: signal.side,
      quantity: size.quantity,
      entryPrice: fillPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      fees: size.fee,
      openedAt: now,
      status: 'open',
      exitPrice: null,
      exitReason: null,
      closedAt: null,
      realizedPnl: null,
      currentPrice: fillPrice,
      unrealizedPnl: round(-size.fee, 2),
      pnlPercent: null,
    }

    const order: PaperOrder = {
      id: randomUUID(),
      signalId: signal.id,
      positionId: position.id,
      symbol: signal.symbol,
      side: orderSide,
      quantity: size.quantity,
      requestedPrice: current,
      fillPrice,
      fee: size.fee,
      slippageCost: round(Math.abs(fillPrice - current) * size.quantity, 6),
      createdAt: now,
    }

    const cashDelta =
      orderSide === 'buy'
        ? -(size.notional + size.fee)
        : size.notional - size.fee

    store.transaction(() => {
      store.setCash(store.getAccount().cash + cashDelta)
      store.insertPosition(position)
      store.insertOrder(order)
      store.decideSignal(
        signal.id,
        'approved',
        `Approved at ${riskPct}% risk · fill ${fillPrice} · size ${size.quantity}`,
        now,
      )
    })

    const state = await getState()
    const storedSignal = store.getSignal(signal.id) ?? { ...signal, status: 'approved' as const }
    return { signal: storedSignal, position, state }
  }

  /* ---- other decisions ------------------------------------------------ */

  async function reject(signalId: string, note: string | null): Promise<PaperState> {
    const now = Date.now()
    const signal = store.getSignal(signalId)
    if (!signal) throw new PaperError('Signal not found.', 404, 'not-found')
    if (signal.status !== 'pending') {
      throw new PaperError(`This signal was already ${signal.status}.`, 409, 'already-decided')
    }

    store.decideSignal(signal.id, 'rejected', note ?? 'Rejected by user', now)
    return getState()
  }

  async function closePosition(positionId: string): Promise<PaperState> {
    const now = Date.now()
    const position = store.getPosition(positionId)
    if (!position) throw new PaperError('Position not found.', 404, 'not-found')
    if (position.status !== 'open') {
      throw new PaperError('This position is already closed.', 409, 'already-closed')
    }

    let price: number
    try {
      const tickers = await fetchPrices([position.symbol])
      const ticker = tickers.find((item) => item.symbol === position.symbol)
      if (!ticker || !Number.isFinite(ticker.lastPrice) || ticker.lastPrice <= 0) {
        throw new Error('no usable ticker returned')
      }
      price = ticker.lastPrice
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      throw new MarketPriceError(
        `Unable to verify the current ${position.symbol} price from Binance public data (${message}).`,
      )
    }

    closePositionInternal(position, 'manual', price, now)
    return getState()
  }

  async function setPaused(paused: boolean): Promise<PaperState> {
    store.setPaused(paused)
    return getState()
  }

  return { getState, approve, reject, closePosition, setPaused }
}
