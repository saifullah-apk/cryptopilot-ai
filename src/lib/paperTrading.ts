/**
 * Paper trading domain — shared by the client and the backend.
 *
 * Everything here is deterministic and uses only verified market prices that
 * are passed in. No real orders, no exchange credentials, no withdrawals.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const STARTING_BALANCE = 10_000
export const DEFAULT_RISK_PCT = 1
export const MAX_RISK_PCT = 1
export const MAX_OPEN_POSITIONS = 3
export const DAILY_LOSS_LIMIT_PCT = 3
export const FEE_RATE = 0.001
export const SLIPPAGE_RATE = 0.0005
export const MAX_SIGNAL_DRIFT_PCT = 0.75
export const SIGNAL_TTL_MS: Record<PaperInterval, number> = {
  '15m': 30 * 60_000,
  '1h': 60 * 60_000,
}

export const PAPER_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const
export type PaperSymbol = (typeof PAPER_SYMBOLS)[number]

export const PAPER_INTERVALS = ['15m', '1h'] as const
export type PaperInterval = (typeof PAPER_INTERVALS)[number]

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'NO TRADE'
export type SignalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type TradeSide = 'long' | 'short'
export type AiProvider = 'gemini' | 'rule-based'
export type ExitReason = 'manual' | 'stop-loss' | 'take-profit'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type TradeSignal = {
  id: string
  symbol: PaperSymbol
  interval: PaperInterval
  action: SignalAction
  /** Reference direction used to build the levels. */
  side: TradeSide
  marketPrice: number
  technicalReasoning: string[]
  aiExplanation: string
  aiProvider: AiProvider
  /** 0–100 setup score. Never a win probability. */
  confidence: number
  entry: number
  stopLoss: number
  takeProfit: number
  riskReward: number
  riskWarnings: string[]
  createdAt: number
  expiresAt: number
  status: SignalStatus
  decidedAt: number | null
  decisionNote: string | null
}

export type PaperPosition = {
  id: string
  signalId: string
  symbol: PaperSymbol
  interval: PaperInterval
  side: TradeSide
  quantity: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  /** Total fees paid so far (entry + exit once closed). */
  fees: number
  openedAt: number
  status: 'open' | 'closed'
  exitPrice: number | null
  exitReason: ExitReason | null
  closedAt: number | null
  realizedPnl: number | null
  currentPrice: number | null
  unrealizedPnl: number | null
  pnlPercent: number | null
}

export type PaperOrder = {
  id: string
  signalId: string
  positionId: string
  symbol: PaperSymbol
  side: 'buy' | 'sell'
  quantity: number
  requestedPrice: number
  fillPrice: number
  fee: number
  slippageCost: number
  createdAt: number
}

export type PaperAccount = {
  startingBalance: number
  cash: number
  equity: number
  realizedPnl: number
  /** Null when at least one open position could not be marked with a verified price. */
  unrealizedPnl: number | null
  feesPaid: number
  openPositionsCount: number
  maxOpenPositions: number
  riskPerTradePct: number
  maxRiskPerTradePct: number
  dailyPnl: number
  dailyLoss: number
  dailyLossLimit: number
  dailyLossLimitPct: number
  paused: boolean
  closedTrades: number
  wins: number
  losses: number
  winRate: number | null
}

export type PaperState = {
  account: PaperAccount
  signals: TradeSignal[]
  openPositions: PaperPosition[]
  closedPositions: PaperPosition[]
  orders: PaperOrder[]
  serverTime: number
  priceSource: 'binance-public'
  priceError: string | null
}

export type PaperStatePayload = {
  ok: true
  state: PaperState
}

/* ------------------------------------------------------------------ */
/* Numeric helpers                                                    */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Paper quantities are floored, never rounded up. */
export function roundQuantity(quantity: number): number {
  return Math.floor(quantity * 1_000_000) / 1_000_000
}

export function signalSide(action: SignalAction): TradeSide {
  return action === 'SELL' ? 'short' : 'long'
}

export function isExecutableAction(action: SignalAction): boolean {
  return action === 'BUY' || action === 'SELL'
}

/* ------------------------------------------------------------------ */
/* Fees, slippage, P&L                                                */
/* ------------------------------------------------------------------ */

export function applySlippage(price: number, side: 'buy' | 'sell'): number {
  return side === 'buy'
    ? price * (1 + SLIPPAGE_RATE)
    : price * (1 - SLIPPAGE_RATE)
}

export function calculateFee(notional: number, feeRate = FEE_RATE): number {
  return Math.abs(notional) * feeRate
}

export function grossPnl(
  side: TradeSide,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
): number {
  return side === 'long'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity
}

export function netRealizedPnl(
  side: TradeSide,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  entryFee: number,
  exitFee: number,
): number {
  return grossPnl(side, entryPrice, exitPrice, quantity) - entryFee - exitFee
}

export function positionUnrealizedPnl(
  side: TradeSide,
  entryPrice: number,
  currentPrice: number,
  quantity: number,
  entryFee: number,
): number {
  return grossPnl(side, entryPrice, currentPrice, quantity) - entryFee
}

export function calculateRiskReward(
  entry: number,
  stopLoss: number,
  takeProfit: number,
): number {
  const risk = Math.abs(entry - stopLoss)
  if (risk <= 0) return 0
  return Math.abs(takeProfit - entry) / risk
}

/* ------------------------------------------------------------------ */
/* Position sizing                                                    */
/* ------------------------------------------------------------------ */

export type PositionSizeInput = {
  equity: number
  cash: number
  riskPct: number
  entryPrice: number
  stopLoss: number
  feeRate?: number
}

export type PositionSizeResult = {
  quantity: number
  notional: number
  fee: number
  riskAmount: number
  actualRisk: number
  cappedByCash: boolean
}

/**
 * Risk-based sizing with a hard cash cap (no leverage).
 * quantity = (equity × risk%) / distance-to-stop, capped by available cash.
 */
export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const feeRate = input.feeRate ?? FEE_RATE
  const riskAmount = Math.max(0, input.equity * (input.riskPct / 100))
  const riskPerUnit = Math.abs(input.entryPrice - input.stopLoss)

  if (
    input.entryPrice <= 0 ||
    input.cash <= 0 ||
    riskPerUnit <= 0 ||
    riskAmount <= 0
  ) {
    return {
      quantity: 0,
      notional: 0,
      fee: 0,
      riskAmount,
      actualRisk: 0,
      cappedByCash: false,
    }
  }

  const quantityByRisk = riskAmount / riskPerUnit
  const quantityByCash = input.cash / (input.entryPrice * (1 + feeRate))
  const cappedByCash = quantityByRisk > quantityByCash
  const quantity = roundQuantity(Math.min(quantityByRisk, quantityByCash))

  if (quantity <= 0) {
    return {
      quantity: 0,
      notional: 0,
      fee: 0,
      riskAmount,
      actualRisk: 0,
      cappedByCash,
    }
  }

  const notional = quantity * input.entryPrice
  return {
    quantity,
    notional,
    fee: calculateFee(notional, feeRate),
    riskAmount,
    actualRisk: quantity * riskPerUnit,
    cappedByCash,
  }
}

export function dailyLossLimitFor(
  startingBalance: number,
  pct = DAILY_LOSS_LIMIT_PCT,
): number {
  return startingBalance * (pct / 100)
}

/* ------------------------------------------------------------------ */
/* Request validation                                                 */
/* ------------------------------------------------------------------ */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateGenerateSignalRequest(
  value: unknown,
): ValidationResult<{ symbol: PaperSymbol; interval: PaperInterval }> {
  if (!isRecord(value)) return { ok: false, error: 'Body must be an object.' }

  const symbol = value.symbol ?? 'BTCUSDT'
  if (typeof symbol !== 'string' || !PAPER_SYMBOLS.includes(symbol as PaperSymbol)) {
    return { ok: false, error: `Symbol must be one of ${PAPER_SYMBOLS.join(', ')}.` }
  }

  const interval = value.interval ?? '15m'
  if (typeof interval !== 'string' || !PAPER_INTERVALS.includes(interval as PaperInterval)) {
    return { ok: false, error: `Interval must be one of ${PAPER_INTERVALS.join(', ')}.` }
  }

  return {
    ok: true,
    value: { symbol: symbol as PaperSymbol, interval: interval as PaperInterval },
  }
}

export function validateApproveRequest(
  value: unknown,
): ValidationResult<{ riskPct: number }> {
  if (value === undefined || value === null) return { ok: true, value: { riskPct: DEFAULT_RISK_PCT } }
  if (!isRecord(value)) return { ok: false, error: 'Body must be an object.' }

  const raw = value.riskPct ?? DEFAULT_RISK_PCT
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw <= 0 ||
    raw > MAX_RISK_PCT
  ) {
    return {
      ok: false,
      error: `riskPct must be greater than 0 and at most ${MAX_RISK_PCT}.`,
    }
  }

  return { ok: true, value: { riskPct: raw } }
}

export function validatePauseRequest(value: unknown): ValidationResult<{ paused: boolean }> {
  if (!isRecord(value) || typeof value.paused !== 'boolean') {
    return { ok: false, error: 'Body must include a boolean "paused".' }
  }
  return { ok: true, value: { paused: value.paused } }
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                    */
/* ------------------------------------------------------------------ */

export function pnlTone(value: number | null | undefined): 'pos' | 'neg' | 'neutral' {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return 'neutral'
  }
  return value > 0 ? 'pos' : 'neg'
}

export function actionTone(action: SignalAction): 'pos' | 'neg' | 'neutral' | 'warn' {
  if (action === 'BUY') return 'pos'
  if (action === 'SELL') return 'neg'
  if (action === 'HOLD') return 'neutral'
  return 'warn'
}
