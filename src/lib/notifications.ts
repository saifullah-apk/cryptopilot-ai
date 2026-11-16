/**
 * Smart-alert engine — pure and unit tested.
 *
 * Compares consecutive market/paper snapshots and emits real notifications
 * only from verified data (Binance tickers, paper-account state). Every
 * alert carries a dedupe key plus per-kind cooldowns so the same event can
 * never spam the user.
 *
 * No fabricated prices, no P&L the engine did not observe: daily summaries
 * are computed from tracked equity/closes, and a quiet day advances silently.
 */

import type { ConnectionState, MiniTicker } from './binanceSocket.ts'
import type { PaperState } from './paperTrading.ts'
import { PAPER_SYMBOLS } from './paperTrading.ts'
import { formatMoney, formatPercent, formatPrice, percentChange } from './format.ts'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type NotificationKind =
  | 'price'
  | 'signal'
  | 'pnl'
  | 'stop-loss'
  | 'take-profit'
  | 'volatility'
  | 'disconnect'
  | 'stale'
  | 'daily'

export type NotificationSeverity = 'info' | 'success' | 'warning'

export type AppNotification = {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  title: string
  body: string
  at: number
  /** Dedupe key: alerts sharing a key are cooldown-limited. */
  key: string
  /** Optional in-app route target. */
  href: string | null
  read: boolean
}

export type NotificationPreferences = {
  kinds: Record<NotificationKind, boolean>
  /** Show notifications inside the app (bell + toasts). */
  inApp: boolean
  /** Show OS-level browser notifications (requires permission). */
  browser: boolean
  /** Percent move from the reference price that triggers a price alert. */
  priceMovePct: number
  /** 24h range percent that counts as high volatility. */
  volatilityPct: number
  /** Percent distance to the stop-loss that triggers a warning. */
  stopWarnPct: number
  /** Percent equity drift that triggers a P&L update. */
  equityMovePct: number
}

/** Email alerts require a mail service; none is configured in this build. */
export const EMAIL_NOTIFICATIONS_AVAILABLE = false

export const NOTIFICATION_KINDS = [
  'price',
  'signal',
  'pnl',
  'stop-loss',
  'take-profit',
  'volatility',
  'disconnect',
  'stale',
  'daily',
] as const satisfies readonly NotificationKind[]

export const KIND_LABELS: Record<NotificationKind, string> = {
  price: 'Price alerts',
  signal: 'New AI signals',
  pnl: 'Virtual P&L updates',
  'stop-loss': 'Stop-loss warnings',
  'take-profit': 'Take-profit hits',
  volatility: 'High volatility',
  disconnect: 'API disconnection',
  stale: 'Stale market data',
  daily: 'Daily summary',
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  kinds: {
    price: true,
    signal: true,
    pnl: true,
    'stop-loss': true,
    'take-profit': true,
    volatility: true,
    disconnect: true,
    stale: true,
    daily: true,
  },
  inApp: true,
  browser: false,
  priceMovePct: 1,
  volatilityPct: 4,
  stopWarnPct: 1,
  equityMovePct: 1,
}

/** Per-kind duplicate protection windows (milliseconds). */
export const NOTIFICATION_COOLDOWNS: Record<NotificationKind, number> = {
  price: 15 * 60_000,
  signal: 0, // ids are unique; seen-set already prevents repeats
  pnl: 30 * 60_000,
  'stop-loss': 30 * 60_000,
  'take-profit': 0, // one notification per closed position
  volatility: 0, // hysteresis flag prevents flapping
  disconnect: 5 * 60_000,
  stale: 30 * 60_000,
  daily: 0, // at most one per UTC day
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                          */
/* ------------------------------------------------------------------ */

/** Structural view of the live ticker feed the engine consumes. */
export type MarketSnapshot = {
  tickers: Record<string, MiniTicker>
  connection: ConnectionState
  stale: boolean
}

/** Structural view of the paper-trading state the engine consumes. */
export type PaperSnapshot = {
  state: PaperState | null
  /** Non-fatal poll error from the paper API. */
  error: string | null
}

/* ------------------------------------------------------------------ */
/* Alert state                                                        */
/* ------------------------------------------------------------------ */

export type AlertState = {
  seeded: boolean
  /** Symbol → reference price for move alerts (updated on crossings). */
  priceRefs: Record<string, number>
  /** Equity reference for P&L drift alerts. */
  equityRef: number | null
  /** Signal ids already notified (bounded). */
  seenSignals: string[]
  /** Closed position ids already notified (bounded). */
  closedSeen: string[]
  /** Symbol → whether high volatility is currently latched. */
  volAbove: Record<string, boolean>
  connectionDown: boolean
  staleFlag: boolean
  priceErrorFlag: boolean
  /** UTC day key of the last daily summary (or seed). */
  lastSummaryDay: string | null
  dayStartEquity: number | null
  dayClosedCount: number
  dayWins: number
  dayRealized: number
  /** key → timestamp of the last emitted notification (cooldowns). */
  lastAt: Record<string, number>
}

export function initialAlertState(): AlertState {
  return {
    seeded: false,
    priceRefs: {},
    equityRef: null,
    seenSignals: [],
    closedSeen: [],
    volAbove: {},
    connectionDown: false,
    staleFlag: false,
    priceErrorFlag: false,
    lastSummaryDay: null,
    dayStartEquity: null,
    dayClosedCount: 0,
    dayWins: 0,
    dayRealized: 0,
    lastAt: {},
  }
}

/** UTC calendar day key, e.g. `2026-11-13`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* Preference validation                                               */
/* ------------------------------------------------------------------ */

const PREF_RANGES = {
  priceMovePct: [0.1, 25],
  volatilityPct: [0.5, 50],
  stopWarnPct: [0.1, 10],
  equityMovePct: [0.1, 25],
} as const

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Coerces arbitrary stored JSON into safe preferences (never throws). */
export function validatePreferences(raw: unknown): NotificationPreferences {
  const source = (raw ?? {}) as Record<string, unknown>
  const rawKinds = (source.kinds ?? {}) as Record<string, unknown>

  const kinds = {} as Record<NotificationKind, boolean>
  for (const kind of NOTIFICATION_KINDS) {
    kinds[kind] =
      typeof rawKinds[kind] === 'boolean'
        ? rawKinds[kind]
        : DEFAULT_PREFERENCES.kinds[kind]
  }

  return {
    kinds,
    inApp:
      typeof source.inApp === 'boolean'
        ? source.inApp
        : DEFAULT_PREFERENCES.inApp,
    browser:
      typeof source.browser === 'boolean'
        ? source.browser
        : DEFAULT_PREFERENCES.browser,
    priceMovePct: clamp(
      source.priceMovePct,
      PREF_RANGES.priceMovePct[0],
      PREF_RANGES.priceMovePct[1],
      DEFAULT_PREFERENCES.priceMovePct,
    ),
    volatilityPct: clamp(
      source.volatilityPct,
      PREF_RANGES.volatilityPct[0],
      PREF_RANGES.volatilityPct[1],
      DEFAULT_PREFERENCES.volatilityPct,
    ),
    stopWarnPct: clamp(
      source.stopWarnPct,
      PREF_RANGES.stopWarnPct[0],
      PREF_RANGES.stopWarnPct[1],
      DEFAULT_PREFERENCES.stopWarnPct,
    ),
    equityMovePct: clamp(
      source.equityMovePct,
      PREF_RANGES.equityMovePct[0],
      PREF_RANGES.equityMovePct[1],
      DEFAULT_PREFERENCES.equityMovePct,
    ),
  }
}

const PREFS_STORAGE_KEY = 'cryptopilot.notifications.prefs'

export function loadPreferences(): NotificationPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFERENCES }
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    return validatePreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(prefs: NotificationPreferences): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* Storage full or blocked — preferences simply won't persist. */
  }
}

/* ------------------------------------------------------------------ */
/* Alert evaluation                                                    */
/* ------------------------------------------------------------------ */

export type EvaluateInput = {
  market: MarketSnapshot | null
  paper: PaperSnapshot | null
  prefs: NotificationPreferences
  now: number
  state: AlertState
}

export type EvaluateResult = {
  notifications: AppNotification[]
  state: AlertState
}

const MAX_SET_SIZE = 300
const LAST_AT_MAX_AGE = 24 * 60 * 60_000

function baseOf(symbol: string): string {
  return symbol.replace(/USDT$/, '')
}

function pushBounded(list: string[], id: string): void {
  list.push(id)
  if (list.length > MAX_SET_SIZE) list.splice(0, list.length - MAX_SET_SIZE)
}

/**
 * Runs one evaluation pass. Emits nothing on the first (seeding) pass and
 * nothing for kinds the user disabled — but state always advances so
 * enabling a kind later never replays old events.
 */
export function evaluateAlerts(input: EvaluateInput): EvaluateResult {
  const { market, paper, prefs, now } = input
  const state = cloneState(input.state)
  const notifications: AppNotification[] = []
  let seq = 0

  const cooldownActive = (kind: NotificationKind, key: string): boolean => {
    const window = NOTIFICATION_COOLDOWNS[kind]
    if (window === 0) return false
    const last = state.lastAt[key]
    return last !== undefined && now - last < window
  }

  /**
   * Returns true when the caller may advance its reference value (i.e. the
   * event is acknowledged — either delivered, disabled-by-preference, or
   * genuinely new). Returns false while a cooldown suppresses the alert,
   * so the reference stays put and the alert fires once the window opens.
   */
  const notify = (
    kind: NotificationKind,
    key: string,
    build: () => Omit<AppNotification, 'id' | 'key' | 'at' | 'read' | 'kind'>,
  ): boolean => {
    if (cooldownActive(kind, key)) return false
    if (prefs.kinds[kind]) {
      const partial = build()
      notifications.push({
        ...partial,
        kind,
        id: `${key}@${now}#${seq++}`,
        key,
        at: now,
        read: false,
      })
      state.lastAt[key] = now
    }
    return true
  }

  /* ---------------------- first run: seed silently ---------------------- */

  if (!state.seeded) {
    for (const symbol of PAPER_SYMBOLS) {
      const ticker = market?.tickers[symbol]
      if (ticker && Number.isFinite(ticker.last) && ticker.last > 0) {
        state.priceRefs[symbol] = ticker.last
      }
      const sessionPct = volatilityPct(ticker)
      state.volAbove[symbol] =
        sessionPct !== null && sessionPct >= prefs.volatilityPct
    }
    state.equityRef = paper?.state?.account.equity ?? null
    state.dayStartEquity = paper?.state?.account.equity ?? null
    for (const signal of paper?.state?.signals ?? []) {
      pushBounded(state.seenSignals, signal.id)
    }
    for (const position of paper?.state?.closedPositions ?? []) {
      pushBounded(state.closedSeen, position.id)
    }
    state.connectionDown = (market?.connection ?? 'open') !== 'open'
    state.staleFlag = market?.stale ?? false
    state.priceErrorFlag = priceErrorOf(paper) !== null
    state.lastSummaryDay = utcDay(now)
    state.seeded = true

    pruneLastAt(state, now)
    return { notifications, state }
  }

  /* ---------------------------- market rules --------------------------- */

  if (market) {
    // BTC/ETH/SOL move alerts.
    for (const symbol of PAPER_SYMBOLS) {
      const ticker = market.tickers[symbol]
      if (!ticker || !Number.isFinite(ticker.last) || ticker.last <= 0) continue

      const ref = state.priceRefs[symbol]
      if (ref === undefined) {
        state.priceRefs[symbol] = ticker.last
        continue
      }

      const move = percentChange(ref, ticker.last)
      if (move === null || Math.abs(move) < prefs.priceMovePct) continue

      const acknowledged = notify('price', `price:${symbol}`, () => ({
        severity: move > 0 ? 'success' : 'warning',
        title: `${baseOf(symbol)} ${move > 0 ? 'up' : 'down'} ${Math.abs(move).toFixed(2)}%`,
        body: `${baseOf(symbol)} is at ${formatPrice(ticker.last)} — ${formatPercent(move)} from ${formatPrice(ref)} (alert threshold ${prefs.priceMovePct.toFixed(2)}%).`,
        href: '/markets',
      }))
      if (acknowledged) state.priceRefs[symbol] = ticker.last
    }

    // 24h-range volatility with latch/hysteresis (re-arms below threshold).
    for (const symbol of PAPER_SYMBOLS) {
      const ticker = market.tickers[symbol]
      if (!ticker) continue
      const sessionPct = volatilityPct(ticker)
      if (sessionPct === null) continue

      const above = sessionPct >= prefs.volatilityPct
      if (above && !state.volAbove[symbol]) {
        state.volAbove[symbol] = true
        notify('volatility', `vol:${symbol}`, () => ({
          severity: 'warning',
          title: `High volatility · ${baseOf(symbol)}`,
          body: `24h range ${formatPrice(ticker.low)}–${formatPrice(ticker.high)} = ${sessionPct.toFixed(2)}% (threshold ${prefs.volatilityPct.toFixed(2)}%). Volatility raises stop-out risk.`,
          href: '/markets',
        }))
      } else if (!above) {
        state.volAbove[symbol] = false
      }
    }

    // Feed disconnection (transition only; recovery resets silently).
    const down = market.connection !== 'open'
    if (down && !state.connectionDown) {
      state.connectionDown = true
      notify('disconnect', 'connection', () => ({
        severity: 'warning',
        title: 'Market feed disconnected',
        body: 'The Binance WebSocket dropped and is reconnecting automatically. Prices may be incomplete until it recovers.',
        href: '/markets',
      }))
    } else if (!down) {
      state.connectionDown = false
    }

    // Stale feed (transition only, cooldown-limited).
    if (market.stale && !state.staleFlag) {
      state.staleFlag = true
      notify('stale', 'stale', () => ({
        severity: 'warning',
        title: 'Market data is stale',
        body: 'No ticker updates for over 20 seconds. Prices on screen may be out of date.',
        href: '/markets',
      }))
    } else if (!market.stale) {
      state.staleFlag = false
    }
  }

  /* ----------------------------- paper rules --------------------------- */

  const paperState = paper?.state ?? null

  // Price API / paper API failure (transition only).
  const apiError = priceErrorOf(paper)
  if (apiError !== null && !state.priceErrorFlag) {
    state.priceErrorFlag = true
    notify('disconnect', 'price-error', () => ({
      severity: 'warning',
      title: 'Price API unavailable',
      body: apiError,
      href: '/paper-trading',
    }))
  } else if (apiError === null) {
    state.priceErrorFlag = false
  }

  if (paperState) {
    // New AI signals — once per signal id, regardless of kind toggles.
    for (const signal of paperState.signals) {
      if (state.seenSignals.includes(signal.id)) continue
      pushBounded(state.seenSignals, signal.id)
      notify('signal', `signal:${signal.id}`, () => ({
        severity: 'info',
        title: `New ${signal.action} signal · ${baseOf(signal.symbol)} ${signal.interval}`,
        body: `Setup score ${signal.confidence}/100 · entry ${formatPrice(signal.marketPrice)} · stop ${formatPrice(signal.stopLoss)} · target ${formatPrice(signal.takeProfit)}. Review before approving — a score is not a win probability.`,
        href: '/paper-trading',
      }))
    }

    // Closed positions → stop-loss / take-profit / manual P&L notices.
    for (const position of paperState.closedPositions) {
      if (state.closedSeen.includes(position.id)) continue
      pushBounded(state.closedSeen, position.id)

      const realized = position.realizedPnl
      const pnlText =
        realized === null ? 'P&L unavailable' : `Realized P&L ${formatMoney(realized)} (fees included)`
      const side = position.side === 'long' ? 'Long' : 'Short'

      state.dayClosedCount += 1
      if (realized !== null && realized > 0) state.dayWins += 1
      if (realized !== null) state.dayRealized += realized

      if (position.exitReason === 'stop-loss') {
        notify('stop-loss', `close:${position.id}`, () => ({
          severity: 'warning',
          title: `Stop-loss hit · ${baseOf(position.symbol)}`,
          body: `${side} closed at ${formatPrice(position.exitPrice)}. ${pnlText}.`,
          href: '/paper-trading',
        }))
      } else if (position.exitReason === 'take-profit') {
        notify('take-profit', `close:${position.id}`, () => ({
          severity: 'success',
          title: `Take-profit hit · ${baseOf(position.symbol)}`,
          body: `${side} closed at ${formatPrice(position.exitPrice)}. ${pnlText}.`,
          href: '/paper-trading',
        }))
      } else {
        notify('pnl', `close:${position.id}`, () => ({
          severity: 'info',
          title: `Position closed · ${baseOf(position.symbol)}`,
          body: `${side} closed at ${formatPrice(position.exitPrice)}. ${pnlText}.`,
          href: '/paper-trading',
        }))
      }
    }

    // Open positions nearing their stop-loss.
    for (const position of paperState.openPositions) {
      const mark =
        position.currentPrice ?? market?.tickers[position.symbol]?.last ?? null
      if (mark === null || !Number.isFinite(mark) || mark <= 0) continue

      const distancePct =
        position.side === 'long'
          ? ((mark - position.stopLoss) / position.entryPrice) * 100
          : ((position.stopLoss - mark) / position.entryPrice) * 100
      if (distancePct > prefs.stopWarnPct) continue

      const near =
        distancePct >= 0
          ? `Price ${formatPrice(mark)} is within ${distancePct.toFixed(2)}% of your stop ${formatPrice(position.stopLoss)}.`
          : `Price ${formatPrice(mark)} has moved through your stop ${formatPrice(position.stopLoss)} — it will close at the next verified mark.`
      notify('stop-loss', `stop:${position.id}`, () => ({
        severity: 'warning',
        title: `Stop-loss near · ${baseOf(position.symbol)}`,
        body: `${near} Stops close positions automatically; they are not guarantees of exit price.`,
        href: '/paper-trading',
      }))
    }

    // Virtual equity drift.
    const equity = paperState.account.equity
    if (Number.isFinite(equity)) {
      if (state.dayStartEquity === null) state.dayStartEquity = equity
      if (state.equityRef === null) {
        state.equityRef = equity
      } else {
        const drift = percentChange(state.equityRef, equity)
        if (drift !== null && Math.abs(drift) >= prefs.equityMovePct) {
          const acknowledged = notify('pnl', 'equity', () => ({
            severity: drift > 0 ? 'success' : 'warning',
            title: `Virtual equity ${drift > 0 ? 'up' : 'down'} ${Math.abs(drift).toFixed(2)}%`,
            body: `Equity ${formatMoney(equity)} from ${formatMoney(state.equityRef)} — paper account only, no real funds involved.`,
            href: '/paper-trading',
          }))
          if (acknowledged) state.equityRef = equity
        }
      }
    }
  }

  /* --------------------------- daily summary --------------------------- */

  const day = utcDay(now)
  if (state.lastSummaryDay === null) {
    state.lastSummaryDay = day
  } else if (day !== state.lastSummaryDay) {
    const equity = paperState?.account.equity ?? null
    const dayPnl =
      equity !== null && state.dayStartEquity !== null
        ? equity - state.dayStartEquity
        : null
    const hadActivity =
      state.dayClosedCount > 0 || (dayPnl !== null && Math.abs(dayPnl) >= 0.01)

    if (hadActivity) {
      const pnlPart =
        dayPnl === null ? '' : ` · session change ${formatMoney(dayPnl)}`
      notify('daily', `daily:${state.lastSummaryDay}`, () => ({
        severity: 'info',
        title: 'Daily performance summary',
        body: `${state.lastSummaryDay} UTC · equity ${formatMoney(equity)}${pnlPart} · ${state.dayClosedCount} closed (${state.dayWins} wins) · realized ${formatMoney(state.dayRealized)}. Paper results only — past results do not predict future performance.`,
        href: '/',
      }))
    }

    // Quiet day: advance the marker without emitting anything.
    state.lastSummaryDay = day
    state.dayStartEquity = equity ?? state.dayStartEquity
    state.dayClosedCount = 0
    state.dayWins = 0
    state.dayRealized = 0
  }

  pruneLastAt(state, now)
  return { notifications, state }
}

function priceErrorOf(paper: PaperSnapshot | null): string | null {
  if (!paper) return null
  return paper.state?.priceError ?? paper.error
}

function volatilityPct(ticker: MiniTicker | undefined): number | null {
  if (!ticker) return null
  if (!Number.isFinite(ticker.open) || ticker.open <= 0) return null
  if (!Number.isFinite(ticker.high) || !Number.isFinite(ticker.low)) return null
  return ((ticker.high - ticker.low) / ticker.open) * 100
}

function cloneState(state: AlertState): AlertState {
  return {
    ...state,
    priceRefs: { ...state.priceRefs },
    seenSignals: [...state.seenSignals],
    closedSeen: [...state.closedSeen],
    volAbove: { ...state.volAbove },
    lastAt: { ...state.lastAt },
  }
}

function pruneLastAt(state: AlertState, now: number): void {
  for (const [key, at] of Object.entries(state.lastAt)) {
    if (now - at > LAST_AT_MAX_AGE) delete state.lastAt[key]
  }
}

/* ------------------------------------------------------------------ */
/* Duplicate protection across passes                                  */
/* ------------------------------------------------------------------ */

/**
 * Second-line dedupe: drops candidates whose key was already delivered
 * within the per-kind cooldown window (and exact key repeats inside one
 * batch). Used by the provider against its delivered-notification list.
 */
export function dedupeNotifications(
  candidates: readonly AppNotification[],
  recent: readonly AppNotification[],
  now: number,
): AppNotification[] {
  const kept: AppNotification[] = []
  for (const candidate of candidates) {
    const window = NOTIFICATION_COOLDOWNS[candidate.kind]
    const duplicatedInBatch = kept.some((n) => n.key === candidate.key)
    if (duplicatedInBatch) continue
    if (window > 0) {
      const blocked = recent.some(
        (n) => n.key === candidate.key && now - n.at < window,
      )
      if (blocked) continue
    }
    kept.push(candidate)
  }
  return kept
}

/* ------------------------------------------------------------------ */
/* Browser channel                                                     */
/* ------------------------------------------------------------------ */

export type BrowserCtor = new (
  title: string,
  options?: { body?: string; tag?: string },
) => unknown

export type BrowserDeliveryResult =
  | 'sent'
  | 'muted'
  | 'denied'
  | 'unsupported'
  | 'error'

/** Reads the current browser notification permission safely. */
export function getBrowserPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Requests OS notification permission (must follow a user gesture). */
export async function requestBrowserPermission(): Promise<
  'granted' | 'denied' | 'unsupported'
> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    const result = await Notification.requestPermission()
    return result === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/**
 * Delivers one notification through the browser channel. `tag` is the
 * dedupe key so the OS replaces (never stacks) duplicates.
 */
export function deliverBrowser(
  notification: AppNotification,
  prefs: NotificationPreferences,
  permission: NotificationPermission | 'unsupported',
  ctor: BrowserCtor | null,
): BrowserDeliveryResult {
  if (!prefs.browser || !prefs.kinds[notification.kind]) return 'muted'
  if (permission === 'unsupported' || ctor === null) return 'unsupported'
  if (permission !== 'granted') return 'denied'
  try {
    new ctor(notification.title, {
      body: notification.body,
      tag: notification.key,
    })
    return 'sent'
  } catch {
    return 'error'
  }
}
