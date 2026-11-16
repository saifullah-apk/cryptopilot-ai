import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Candle } from '../src/lib/binance.ts'
import { analyzeCandles } from '../src/lib/indicators.ts'
import {
  applySlippage,
  calculateFee,
  calculatePositionSize,
  calculateRiskReward,
  dailyLossLimitFor,
  DAILY_LOSS_LIMIT_PCT,
  FEE_RATE,
  grossPnl,
  MAX_OPEN_POSITIONS,
  MAX_RISK_PCT,
  MAX_SIGNAL_DRIFT_PCT,
  netRealizedPnl,
  SLIPPAGE_RATE,
  STARTING_BALANCE,
  validateApproveRequest,
  validateGenerateSignalRequest,
  validatePauseRequest,
  type PaperSymbol,
  type TradeSignal,
} from '../src/lib/paperTrading.ts'
import { evaluateSetup, MIN_SIGNAL_CANDLES } from '../src/lib/signals.ts'
import { createPaperStore, type PaperStore } from '../server/paperStore.ts'
import { createPaperService, PaperError, type PriceFeed } from '../server/paperService.ts'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Prefer the approved opencode temp root; fall back to the OS temp dir. */
const TEMP_ROOT = existsSync('C:/Users/HP/AppData/Local/Temp/opencode')
  ? 'C:/Users/HP/AppData/Local/Temp/opencode'
  : tmpdir()

function candle(index: number, close: number, prev: number): Candle {
  const open = prev
  return {
    openTime: index * 60_000,
    open,
    high: Math.max(open, close) + 0.2,
    low: Math.min(open, close) - 0.2,
    close,
    volume: 100 + (index % 7),
    closeTime: index * 60_000 + 59_999,
  }
}

function series(closes: number[]): Candle[] {
  return closes.map((close, index) => candle(index, close, index === 0 ? close : closes[index - 1]))
}

function staircase(count: number, up: boolean): number[] {
  const out: number[] = []
  let price = up ? 100 : 400
  for (let i = 0; i < count; i += 1) {
    price += i % 8 === 7 ? (up ? -3 : 3) : up ? 0.7 : -0.7
    out.push(price)
  }
  return out
}

function makeSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  const now = Date.now()
  return {
    id: randomUUID(),
    symbol: 'BTCUSDT',
    interval: '15m',
    action: 'BUY',
    side: 'long',
    marketPrice: 100,
    technicalReasoning: [
      'Trend is bullish (net weighted score 4/5)',
      'RSI 14 reads 61.0 — bullish momentum',
    ],
    aiExplanation: 'Rule-based explanation of the verified setup.',
    aiProvider: 'rule-based',
    confidence: 58,
    entry: 100,
    stopLoss: 99,
    takeProfit: 102,
    riskReward: 2,
    riskWarnings: ['Confidence 58/100 is a setup score — not a win probability.'],
    createdAt: now,
    expiresAt: now + 30 * 60_000,
    status: 'pending',
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

type World = {
  dir: string
  store: PaperStore
  prices: Map<string, number>
  broken: boolean
  service: ReturnType<typeof createPaperService>
}

const worlds: World[] = []

function makeWorld(): World {
  const dir = mkdtempSync(join(TEMP_ROOT, 'cryptopilot-paper-'))
  const store = createPaperStore(join(dir, 'paper.db'))
  const prices = new Map<string, number>([
    ['BTCUSDT', 100],
    ['ETHUSDT', 100],
    ['SOLUSDT', 100],
  ])

  const world: World = { dir, store, prices, broken: false, service: null as never }
  const fetchPrices: PriceFeed = async (symbols) => {
    if (world.broken) throw new Error('price feed unreachable')
    return symbols.map((symbol) => {
      const price = prices.get(symbol)
      if (price === undefined) throw new Error(`no price for ${symbol}`)
      return {
        symbol,
        lastPrice: price,
        openPrice: price,
        highPrice: price,
        lowPrice: price,
        volume: 0,
        priceChangePercent: 0,
        closeTime: Date.now(),
      }
    })
  }

  world.service = createPaperService({ store, fetchPrices })
  worlds.push(world)
  return world
}

async function expectPaperError(
  fn: () => Promise<unknown>,
  code: string,
  status?: number,
): Promise<PaperError> {
  try {
    await fn()
  } catch (error) {
    assert.ok(error instanceof PaperError, `expected PaperError, got ${String(error)}`)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    return error
  }
  throw new Error(`expected rejection with code "${code}"`)
}

/* ------------------------------------------------------------------ */
/* Signal engine                                                       */
/* ------------------------------------------------------------------ */

test('evaluateSetup: staircase uptrend produces BUY with valid levels', () => {
  const analysis = analyzeCandles(series(staircase(260, true)))
  const draft = evaluateSetup(analysis, '15m')

  assert.ok(draft)
  assert.equal(draft.action, 'BUY')
  assert.equal(draft.side, 'long')
  assert.ok(draft.confidence > 0 && draft.confidence <= 100)
  assert.ok(draft.stopLoss < draft.entry, 'long stop must sit below entry')
  assert.ok(draft.takeProfit > draft.entry, 'long target must sit above entry')
  assert.ok(draft.riskReward > 0)
  assert.equal(
    draft.riskReward,
    Math.round(calculateRiskReward(draft.entry, draft.stopLoss, draft.takeProfit) * 100) / 100,
    'reported R/R must equal the rounded risk-reward ratio',
  )
  assert.ok(draft.technicalReasoning.length > 0)
  assert.ok(draft.riskWarnings.length > 0)
  assert.ok(
    draft.riskWarnings.some((w) => w.toLowerCase().includes('not a win probability')),
    'warnings must state confidence is not a win probability',
  )
  assert.ok(draft.riskWarnings.some((w) => w.toLowerCase().includes('paper')))
})

test('evaluateSetup: staircase downtrend produces SELL with reversed levels', () => {
  const analysis = analyzeCandles(series(staircase(260, false)))
  const draft = evaluateSetup(analysis, '15m')

  assert.ok(draft)
  assert.equal(draft.action, 'SELL')
  assert.equal(draft.side, 'short')
  assert.ok(draft.stopLoss > draft.entry, 'short stop must sit above entry')
  assert.ok(draft.takeProfit < draft.entry, 'short target must sit below entry')
})

test('evaluateSetup: flat market is HOLD, not a trade', () => {
  const analysis = analyzeCandles(series(Array.from({ length: 260 }, () => 100)))
  const draft = evaluateSetup(analysis, '15m')

  assert.ok(draft)
  assert.equal(draft.action, 'HOLD')
})

test('evaluateSetup: extreme volatility blocks entry (NO TRADE)', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + 16 * Math.sin(i / 3))
  const analysis = analyzeCandles(series(closes))
  const draft = evaluateSetup(analysis, '15m')

  assert.ok(draft)
  assert.equal(draft.action, 'NO TRADE')
  assert.ok(draft.riskWarnings.some((w) => w.toLowerCase().includes('no entry')))
})

test('evaluateSetup: insufficient history and RSI extremes block entry', () => {
  const short = analyzeCandles(series(Array.from({ length: 20 }, (_, i) => 100 + i * 0.5)))
  const shortDraft = evaluateSetup(short, '15m')
  assert.ok(shortDraft)
  assert.equal(shortDraft.action, 'NO TRADE')

  const mono = analyzeCandles(series(Array.from({ length: 260 }, (_, i) => 100 + i)))
  const monoDraft = evaluateSetup(mono, '15m')
  assert.ok(monoDraft)
  assert.equal(monoDraft.action, 'NO TRADE')
  assert.ok(short.candleCount < MIN_SIGNAL_CANDLES)
})

test('evaluateSetup: returns null when there is no usable market price', () => {
  const analysis = analyzeCandles(series(staircase(260, true)))
  const broken = { ...analysis, lastClose: null }
  assert.equal(evaluateSetup(broken, '15m'), null)
})

/* ------------------------------------------------------------------ */
/* Math                                                                */
/* ------------------------------------------------------------------ */

test('fees and slippage are applied in the conservative direction', () => {
  assert.equal(calculateFee(1000), 1000 * FEE_RATE)
  assert.ok(applySlippage(100, 'buy') > 100, 'buy fills higher than the quoted price')
  assert.ok(applySlippage(100, 'sell') < 100, 'sell fills lower than the quoted price')
  assert.ok(SLIPPAGE_RATE > 0)
})

test('P&L: long profit and short profit are computed net of both fees', () => {
  const entry = 100
  const exit = 110
  const qty = 2
  const entryFee = calculateFee(qty * entry)
  const exitFee = calculateFee(qty * exit)

  const longGross = grossPnl('long', entry, exit, qty)
  assert.equal(longGross, 20)

  const longNet = netRealizedPnl('long', entry, exit, qty, entryFee, exitFee)
  assert.ok(longNet < longGross, 'net P&L must include fees')
  assert.ok(longNet > 0)

  const shortNet = netRealizedPnl('short', entry, exit, qty, entryFee, exitFee)
  assert.ok(shortNet < 0, 'a short loses when price rises')
})

test('position sizing: risk-based with a hard cash cap', () => {
  const size = calculatePositionSize({
    equity: 10_000,
    cash: 10_000,
    riskPct: 1,
    entryPrice: 100,
    stopLoss: 99,
  })
  assert.ok(size.quantity > 0)
  assert.ok(size.riskAmount <= 10_000 * (MAX_RISK_PCT / 100) + 0.001)
  assert.ok(size.actualRisk <= size.riskAmount + 0.01, 'actual risk must not exceed the budget')

  const broke = calculatePositionSize({
    equity: 10_000,
    cash: 0,
    riskPct: 1,
    entryPrice: 100,
    stopLoss: 99,
  })
  assert.equal(broke.quantity, 0)

  const noStop = calculatePositionSize({
    equity: 10_000,
    cash: 10_000,
    riskPct: 1,
    entryPrice: 100,
    stopLoss: 100,
  })
  assert.equal(noStop.quantity, 0, 'a zero stop distance must not size a position')
})

test('daily loss limit is 3% of the starting balance', () => {
  assert.equal(dailyLossLimitFor(STARTING_BALANCE), STARTING_BALANCE * (DAILY_LOSS_LIMIT_PCT / 100))
  assert.equal(dailyLossLimitFor(10_000), 300)
})

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

test('validators: symbol/interval whitelist, risk cap, pause shape', () => {
  const badSymbol = validateGenerateSignalRequest({ symbol: 'DOGEUSDT', interval: '15m' })
  assert.equal(badSymbol.ok, false)

  const good = validateGenerateSignalRequest({ symbol: 'ETHUSDT', interval: '1h' })
  assert.ok(good.ok)
  assert.deepEqual(good.value, { symbol: 'ETHUSDT', interval: '1h' })

  const overRisk = validateApproveRequest({ riskPct: 2 })
  assert.equal(overRisk.ok, false, 'risk above 1% must be rejected')

  const zeroRisk = validateApproveRequest({ riskPct: 0 })
  assert.equal(zeroRisk.ok, false)

  const defaultRisk = validateApproveRequest(undefined)
  assert.ok(defaultRisk.ok)
  assert.equal(defaultRisk.value.riskPct, MAX_RISK_PCT)

  assert.equal(validatePauseRequest({ paused: 'yes' }).ok, false)
  const pause = validatePauseRequest({ paused: true })
  assert.ok(pause.ok)
  assert.equal(pause.value.paused, true)
})

/* ------------------------------------------------------------------ */
/* Approval workflow and risk controls                                 */
/* ------------------------------------------------------------------ */

test('fresh state: $10,000 account, empty books', async () => {
  const world = makeWorld()
  const state = await world.service.getState()

  assert.equal(state.account.startingBalance, STARTING_BALANCE)
  assert.equal(state.account.cash, STARTING_BALANCE)
  assert.equal(state.account.equity, STARTING_BALANCE)
  assert.equal(state.account.unrealizedPnl, 0)
  assert.equal(state.account.openPositionsCount, 0)
  assert.equal(state.account.paused, false)
  assert.equal(state.signals.length, 0)
  assert.equal(state.priceError, null)
  assert.equal(state.priceSource, 'binance-public')
})

test('approve: opens a virtual position, moves cash, records the fill', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())

  const signal = world.store.listSignals(1)[0]
  const result = await world.service.approve(signal.id, 1)

  assert.equal(result.signal.status, 'approved')
  assert.equal(result.position.status, 'open')
  assert.equal(result.position.side, 'long')

  const fill = applySlippage(100, 'buy')
  const expectedNotional = result.position.quantity * fill
  const expectedCash = STARTING_BALANCE - expectedNotional - result.position.fees

  assert.ok(Math.abs(result.position.entryPrice - fill) < 1e-9)
  assert.ok(Math.abs(result.state.account.cash - expectedCash) < 0.01)
  assert.equal(result.state.account.openPositionsCount, 1)

  // Risk budget respected.
  const stopRisk = result.position.quantity * Math.abs(result.position.entryPrice - result.position.stopLoss)
  assert.ok(stopRisk <= STARTING_BALANCE * 0.01 + 0.01, 'risk must stay within 1% of equity')

  // Fill record with fee + slippage detail.
  const order = result.state.orders.find((o) => o.positionId === result.position.id)
  assert.ok(order)
  assert.equal(order.side, 'buy')
  assert.equal(order.requestedPrice, 100)
  assert.ok(order.fee > 0)
  assert.ok(order.slippageCost > 0)

  // Signal is decided and persisted.
  const stored = world.store.getSignal(signal.id)
  assert.ok(stored)
  assert.equal(stored.status, 'approved')
  assert.ok(stored.decidedAt !== null)
})

test('reject: signal is decided, no position is opened', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]

  const state = await world.service.reject(signal.id, 'Did not like the setup')
  assert.equal(state.signals[0].status, 'rejected')
  assert.equal(state.signals[0].decisionNote, 'Did not like the setup')
  assert.equal(state.account.openPositionsCount, 0)
  assert.equal(state.account.cash, STARTING_BALANCE)

  await expectPaperError(() => world.service.reject(signal.id, null), 'already-decided', 409)
})

test('approve rejects: missing signal, HOLD, expired, already-decided', async () => {
  const world = makeWorld()

  await expectPaperError(() => world.service.approve('nope', 1), 'not-found', 404)

  world.store.insertSignal(makeSignal({ action: 'HOLD' }))
  const hold = world.store.listSignals(1)[0]
  await expectPaperError(() => world.service.approve(hold.id, 1), 'not-executable', 409)

  world.store.insertSignal(makeSignal({ expiresAt: Date.now() - 1_000 }))
  const expired = world.store
    .listSignals(5)
    .find((s) => s.action === 'BUY' && s.expiresAt < Date.now())
  assert.ok(expired)
  await expectPaperError(() => world.service.approve(expired.id, 1), 'expired', 409)
  assert.equal(world.store.getSignal(expired.id)?.status, 'expired')

  world.store.insertSignal(makeSignal())
  const pending = world.store
    .listSignals(5)
    .find((s) => s.status === 'pending' && s.action === 'BUY')
  assert.ok(pending)
  await world.service.approve(pending.id, 1)
  await expectPaperError(() => world.service.approve(pending.id, 1), 'already-decided', 409)
})

test('duplicate order protection: one open position per symbol', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const first = world.store.listSignals(1)[0]
  await world.service.approve(first.id, 1)

  world.store.insertSignal(makeSignal({ id: randomUUID() }))
  const second = world.store
    .listSignals(5)
    .find((s) => s.status === 'pending')
  assert.ok(second)
  await expectPaperError(() => world.service.approve(second.id, 1), 'duplicate', 409)
})

test('max open positions: third approval is blocked at the fourth', async () => {
  const world = makeWorld()
  const symbols: PaperSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  for (const symbol of symbols) {
    // Wider stops so three positions fit inside the available cash.
    world.store.insertSignal(makeSignal({ id: randomUUID(), symbol, stopLoss: 95, takeProfit: 105 }))
  }
  for (const signal of world.store.listSignals(10)) {
    await world.service.approve(signal.id, 1)
  }
  assert.equal((await world.service.getState()).account.openPositionsCount, MAX_OPEN_POSITIONS)

  // A brand-new pending signal still cannot open a fourth position.
  world.store.insertSignal(makeSignal({ id: randomUUID(), symbol: 'ETHUSDT', stopLoss: 95, takeProfit: 105 }))
  const fourth = world.store.listSignals(10).find((s) => s.status === 'pending')
  assert.ok(fourth)
  await expectPaperError(() => world.service.approve(fourth.id, 1), 'max-positions', 409)
})

test('emergency pause blocks approvals but not closing', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  await world.service.approve(signal.id, 1)

  const paused = await world.service.setPaused(true)
  assert.equal(paused.account.paused, true)

  world.store.insertSignal(makeSignal({ id: randomUUID() }))
  const pending = world.store.listSignals(5).find((s) => s.status === 'pending')
  assert.ok(pending)
  await expectPaperError(() => world.service.approve(pending.id, 1), 'paused', 409)

  // Closing the open position still works while paused.
  const position = (await world.service.getState()).openPositions[0]
  const closed = await world.service.closePosition(position.id)
  assert.equal(closed.account.openPositionsCount, 0)

  const resumed = await world.service.setPaused(false)
  assert.equal(resumed.account.paused, false)
})

test('price drift beyond 0.75% invalidates the signal', async () => {
  const world = makeWorld()
  world.prices.set('BTCUSDT', 101) // 1% above the signal market price
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]

  await expectPaperError(() => world.service.approve(signal.id, 1), 'stale-price', 409)
  assert.equal(world.store.getSignal(signal.id)?.status, 'expired')
  assert.equal((await world.service.getState()).account.openPositionsCount, 0)
  assert.ok(MAX_SIGNAL_DRIFT_PCT < 1)
})

test('mandatory stop-loss: a stop already at/through price blocks approval', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal({ stopLoss: 101, takeProfit: 105 }))
  const signal = world.store.listSignals(1)[0]

  await expectPaperError(() => world.service.approve(signal.id, 1), 'invalid-stop', 409)
  assert.equal(world.store.getSignal(signal.id)?.status, 'expired')
})

test('daily loss limit: locked once realised losses reach 3% today', async () => {
  const world = makeWorld()
  const now = Date.now()

  // Seed a closed trade lost today beyond the $300 limit.
  world.store.insertPosition({
    id: randomUUID(),
    signalId: randomUUID(),
    symbol: 'BTCUSDT',
    interval: '15m',
    side: 'long',
    quantity: 1,
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 102,
    fees: 0,
    openedAt: now - 60_000,
    status: 'closed',
    exitPrice: 90,
    exitReason: 'stop-loss',
    closedAt: now - 30_000,
    realizedPnl: -350,
    currentPrice: null,
    unrealizedPnl: null,
    pnlPercent: null,
  })

  const state = await world.service.getState()
  assert.ok(state.account.dailyLoss >= state.account.dailyLossLimit)

  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  await expectPaperError(() => world.service.approve(signal.id, 1), 'daily-loss-limit', 409)
})

test('stop-loss exit: triggered by verified price, filled with adverse slippage', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  const approved = await world.service.approve(signal.id, 1)
  const cashAfterOpen = approved.state.account.cash

  // Price slices through the stop.
  world.prices.set('BTCUSDT', 98)
  const state = await world.service.getState()

  assert.equal(state.account.openPositionsCount, 0)
  const closed = state.closedPositions.find((p) => p.id === approved.position.id)
  assert.ok(closed)
  assert.equal(closed.exitReason, 'stop-loss')
  assert.ok(closed.realizedPnl !== null && closed.realizedPnl < 0, 'a stopped long must lose')

  const expectedExit = applySlippage(98, 'sell')
  assert.ok(Math.abs((closed.exitPrice ?? 0) - expectedExit) < 1e-9)

  // Cash rises by the sale proceeds minus the exit fee.
  const exitFee = calculateFee(closed.quantity * expectedExit)
  const expectedCash = cashAfterOpen + closed.quantity * expectedExit - exitFee
  assert.ok(Math.abs(state.account.cash - expectedCash) < 0.01)
  assert.ok(state.account.realizedPnl < 0)
  assert.equal(state.account.losses, 1)

  // Exit fill recorded.
  const exitOrder = state.orders.find((o) => o.positionId === closed.id && o.side === 'sell')
  assert.ok(exitOrder)
  assert.ok(exitOrder.fee > 0)
})

test('take-profit exit: fills exactly at the limit with no slippage', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  const approved = await world.service.approve(signal.id, 1)

  world.prices.set('BTCUSDT', 103) // beyond the 102 target
  const state = await world.service.getState()

  const closed = state.closedPositions.find((p) => p.id === approved.position.id)
  assert.ok(closed)
  assert.equal(closed.exitReason, 'take-profit')
  assert.equal(closed.exitPrice, approved.position.takeProfit, 'target fills at its limit level')
  assert.ok((closed.realizedPnl ?? 0) > 0, 'a winning long must be positive')
  assert.equal(state.account.wins, 1)

  const exitOrder = state.orders.find((o) => o.positionId === closed.id && o.side === 'sell')
  assert.ok(exitOrder)
  assert.equal(exitOrder.slippageCost, 0, 'limit fills carry no slippage')
})

test('manual close: realised P&L, equity and win rate update together', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  const approved = await world.service.approve(signal.id, 1)

  world.prices.set('BTCUSDT', 110)
  const state = await world.service.closePosition(approved.position.id)

  const closed = state.closedPositions.find((p) => p.id === approved.position.id)
  assert.ok(closed)
  assert.equal(closed.exitReason, 'manual')
  assert.ok((closed.realizedPnl ?? 0) > 0)

  assert.equal(state.account.openPositionsCount, 0)
  assert.equal(state.account.closedTrades, 1)
  assert.equal(state.account.wins, 1)
  assert.equal(state.account.winRate, 100)
  assert.ok(Math.abs(state.account.realizedPnl - (closed.realizedPnl ?? 0)) < 0.01)

  // Equity = cash + 0 (flat book); it must exceed the starting balance.
  assert.ok(state.account.equity > STARTING_BALANCE)
  assert.equal(state.account.unrealizedPnl, 0)

  await expectPaperError(() => world.service.closePosition(closed.id), 'already-closed', 409)
  await expectPaperError(() => world.service.closePosition('missing'), 'not-found', 404)
})

test('unavailable marks: unrealised P&L becomes null instead of a fake number', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal())
  const signal = world.store.listSignals(1)[0]
  await world.service.approve(signal.id, 1)

  world.broken = true
  const state = await world.service.getState()

  assert.ok(state.priceError, 'a broken feed must surface priceError')
  assert.equal(state.account.unrealizedPnl, null, 'never invent unrealised P&L')
  assert.equal(state.openPositions[0].currentPrice, null)
  assert.equal(state.openPositions[0].unrealizedPnl, null)
  // Equity falls back to a cost-basis valuation, not a guess.
  assert.ok(Number.isFinite(state.account.equity))
})

test('generation: a duplicate pending signal for symbol+timeframe is blocked', async () => {
  const world = makeWorld()
  world.store.insertSignal(makeSignal({ symbol: 'BTCUSDT', interval: '15m' }))

  const { generateSignal } = await import('../server/signalService.ts')
  await expectPaperError(
    () => generateSignal({ store: world.store, apiKey: undefined, model: 'test' }, 'BTCUSDT', '15m'),
    'duplicate-pending',
    409,
  )
})

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

after(() => {
  for (const world of worlds) {
    try {
      world.store.close()
    } catch {
      /* already closed */
    }
    rmSync(world.dir, { recursive: true, force: true })
  }
})
