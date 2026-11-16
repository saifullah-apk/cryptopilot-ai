/**
 * Portfolio calculations.
 *
 * The virtual portfolio is derived exclusively from the paper-trading state:
 * cash plus net open-position exposure marked at verified prices. The real
 * account types below are READ-ONLY snapshots and are never mixed into the
 * virtual numbers.
 */

import {
  round,
  type PaperState,
  type PaperSymbol,
} from './paperTrading.ts'

/* ------------------------------------------------------------------ */
/* Virtual paper portfolio                                            */
/* ------------------------------------------------------------------ */

export type VirtualAssetBalance = {
  symbol: PaperSymbol
  base: string
  /** Signed net quantity: long is positive, short is negative. */
  netQuantity: number
  longQuantity: number
  shortQuantity: number
  markPrice: number | null
  /** Signed mark-to-market value in USDT; null when a mark is missing. */
  value: number | null
  /** Absolute share of the gross portfolio. Null when valuation is incomplete. */
  allocationPct: number | null
  unrealizedPnl: number | null
  positions: number
}

export type VirtualPortfolio = {
  startingBalance: number
  cash: number
  equity: number
  realizedPnl: number
  unrealizedPnl: number | null
  totalPnl: number
  totalPnlPct: number
  feesPaid: number
  /** Sum of absolute open-position mark values. */
  exposure: number
  cashAllocationPct: number | null
  assets: VirtualAssetBalance[]
  openPositions: number
  /** True only when every non-zero asset quantity has a verified mark. */
  allocationComplete: boolean
  priceError: string | null
}

const BASE_BY_SYMBOL: Record<PaperSymbol, string> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  SOLUSDT: 'SOL',
}

export function virtualPortfolioFromPaperState(state: PaperState): VirtualPortfolio {
  const symbols = new Set<PaperSymbol>()
  for (const position of state.openPositions) symbols.add(position.symbol)

  const assets: VirtualAssetBalance[] = []
  let exposure = 0
  let allocationComplete = true

  for (const symbol of symbols) {
    const positions = state.openPositions.filter((position) => position.symbol === symbol)
    const longQuantity = positions
      .filter((position) => position.side === 'long')
      .reduce((sum, position) => sum + position.quantity, 0)
    const shortQuantity = positions
      .filter((position) => position.side === 'short')
      .reduce((sum, position) => sum + position.quantity, 0)
    const netQuantity = longQuantity - shortQuantity

    const markPrice = positions.find((position) => position.currentPrice !== null)?.currentPrice ?? null
    const value = markPrice === null ? null : netQuantity * markPrice
    if (value === null) allocationComplete = false
    else exposure += Math.abs(value)

    const unrealizedValues = positions.map((position) => position.unrealizedPnl)
    const unrealizedPnl = unrealizedValues.some((value) => value === null)
      ? null
      : unrealizedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)

    assets.push({
      symbol,
      base: BASE_BY_SYMBOL[symbol] ?? symbol.replace('USDT', ''),
      netQuantity: round(netQuantity, 6),
      longQuantity: round(longQuantity, 6),
      shortQuantity: round(shortQuantity, 6),
      markPrice,
      value: value === null ? null : round(value, 2),
      allocationPct: null,
      unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl, 2),
      positions: positions.length,
    })
  }

  const cash = Math.max(0, state.account.cash)
  const denominator = cash + exposure
  const cashAllocationPct = denominator > 0 ? round((cash / denominator) * 100, 1) : null

  for (const asset of assets) {
    asset.allocationPct =
      allocationComplete && denominator > 0 && asset.value !== null
        ? round((Math.abs(asset.value) / denominator) * 100, 1)
        : null
  }

  assets.sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))

  const totalPnl = state.account.equity - state.account.startingBalance

  return {
    startingBalance: round(state.account.startingBalance, 2),
    cash: round(state.account.cash, 2),
    equity: round(state.account.equity, 2),
    realizedPnl: round(state.account.realizedPnl, 2),
    unrealizedPnl:
      state.account.unrealizedPnl === null ? null : round(state.account.unrealizedPnl, 2),
    totalPnl: round(totalPnl, 2),
    totalPnlPct:
      state.account.startingBalance > 0
        ? round((totalPnl / state.account.startingBalance) * 100, 2)
        : 0,
    feesPaid: round(state.account.feesPaid, 2),
    exposure: round(exposure, 2),
    cashAllocationPct,
    assets,
    openPositions: state.openPositions.length,
    allocationComplete,
    priceError: state.priceError,
  }
}

/* ------------------------------------------------------------------ */
/* Real account snapshot (read-only)                                  */
/* ------------------------------------------------------------------ */

export type RealAssetBalance = {
  asset: string
  free: number
  locked: number
  total: number
  /** USDT mark value; null when no verified public price is available. */
  usdtValue: number | null
}

export type RealAccountSnapshot = {
  source: 'binance-read-only'
  fetchedAt: number
  accountType: string | null
  canTrade: boolean
  canWithdraw: boolean
  canDeposit: boolean
  balances: RealAssetBalance[]
  /** Sum of balances that could be valued. Never presented as full equity. */
  valuedSubtotal: number | null
  unpricedAssets: string[]
  /** Non-null when the key itself reports trading/withdrawal permissions. */
  permissionWarning: string | null
}

export type BinancePortfolioStatus = {
  configured: boolean
  connected: boolean
  readOnly: true
  connectedAt: number | null
  /** Last four characters of the API key — never the key itself. */
  keyHint: string | null
  snapshot: RealAccountSnapshot | null
  message: string
}

export function emptyBinanceStatus(message: string): BinancePortfolioStatus {
  return {
    configured: true,
    connected: false,
    readOnly: true,
    connectedAt: null,
    keyHint: null,
    snapshot: null,
    message,
  }
}
