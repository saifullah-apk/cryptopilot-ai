import test from 'node:test'
import assert from 'node:assert/strict'

import type { MiniTicker } from '../src/lib/binanceSocket.ts'
import type {
  PaperAccount,
  PaperPosition,
  PaperState,
  TradeSignal,
} from '../src/lib/paperTrading.ts'
import {
  DEFAULT_PREFERENCES,
  dedupeNotifications,
  deliverBrowser,
  evaluateAlerts,
  getBrowserPermission,
  initialAlertState,
  loadPreferences,
  requestBrowserPermission,
  savePreferences,
  utcDay,
  validatePreferences,
  type AlertState,
  type AppNotification,
  type MarketSnapshot,
  type NotificationPreferences,
  type PaperSnapshot,
} from '../src/lib/notifications.ts'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const T0 = Date.parse('2026-11-13T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function ticker(symbol: string, last: number, overrides: Partial<MiniTicker> = {}): MiniTicker {
  return {
    symbol,
    last,
    open: last,
    high: last,
    low: last,
    volume: 1,
    eventTime: T0,
    ...overrides,
  }
}

function market(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    tickers: {
      BTCUSDT: ticker('BTCUSDT', 100),
      ETHUSDT: ticker('ETHUSDT', 10),
      SOLUSDT: ticker('SOLUSDT', 1),
    },
    connection: 'open',
    stale: false,
    ...overrides,
  }
}

function account(overrides: Partial<PaperAccount> = {}): PaperAccount {
  return {
    startingBalance: 10_000,
    cash: 10_000,
    equity: 10_000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    openPositionsCount: 0,
    maxOpenPositions: 3,
    riskPerTradePct: 1,
    maxRiskPerTradePct: 1,
    dailyPnl: 0,
    dailyLoss: 0,
    dailyLossLimit: 300,
    dailyLossLimitPct: 3,
    paused: false,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    ...overrides,
  }
}

function paperState(overrides: Partial<PaperState> = {}): PaperState {
  return {
    account: account(),
    signals: [],
    openPositions: [],
    closedPositions: [],
    orders: [],
    serverTime: T0,
    priceSource: 'binance-public',
    priceError: null,
    ...overrides,
  }
}

function snapshot(state: PaperState | null, error: string | null = null): PaperSnapshot {
  return { state, error }
}

function signal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: 'sig-1',
    symbol: 'BTCUSDT',
    interval: '15m',
    action: 'BUY',
    side: 'long',
    marketPrice: 100,
    technicalReasoning: ['rsi neutral'],
    aiExplanation: 'rule-based',
    aiProvider: 'rule-based',
    confidence: 60,
    entry: 100,
    stopLoss: 97,
    takeProfit: 106,
    riskReward: 2,
    riskWarnings: [],
    createdAt: T0,
    expiresAt: T0 + 30 * MINUTE,
    status: 'pending',
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

function openPosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 'pos-1',
    signalId: 'sig-1',
    symbol: 'BTCUSDT',
    interval: '15m',
    side: 'long',
    quantity: 1,
    entryPrice: 100,
    stopLoss: 97,
    takeProfit: 106,
    fees: 0.1,
    openedAt: T0,
    status: 'open',
    exitPrice: null,
    exitReason: null,
    closedAt: null,
    realizedPnl: null,
    currentPrice: 100,
    unrealizedPnl: 0,
    pnlPercent: 0,
    ...overrides,
  }
}

function closedPosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return openPosition({
    status: 'closed',
    exitPrice: 105,
    exitReason: 'take-profit',
    closedAt: T0 + HOUR,
    realizedPnl: 4.9,
    currentPrice: null,
    unrealizedPnl: null,
    pnlPercent: null,
    ...overrides,
  })
}

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'price:BTCUSDT@1#0',
    kind: 'price',
    severity: 'info',
    title: 'Test',
    body: 'Body',
    at: T0,
    key: 'price:BTCUSDT',
    href: null,
    read: false,
    ...overrides,
  }
}

function prefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_PREFERENCES, kinds: { ...DEFAULT_PREFERENCES.kinds }, ...overrides }
}

function seed(
  mkt: MarketSnapshot | null,
  paper: PaperSnapshot | null,
  preferences: NotificationPreferences = prefs(),
  now = T0,
): { notifications: AppNotification[]; state: AlertState } {
  return evaluateAlerts({ market: mkt, paper, prefs: preferences, now, state: initialAlertState() })
}

function run(
  state: AlertState,
  mkt: MarketSnapshot | null,
  paper: PaperSnapshot | null,
  now: number,
  preferences: NotificationPreferences = prefs(),
): { notifications: AppNotification[]; state: AlertState } {
  return evaluateAlerts({ market: mkt, paper, prefs: preferences, now, state })
}

/* ------------------------------------------------------------------ */
/* Preference validation + storage                                     */
/* ------------------------------------------------------------------ */

test('validatePreferences: garbage falls back to defaults', () => {
  assert.deepEqual(validatePreferences(undefined), DEFAULT_PREFERENCES)
  assert.deepEqual(validatePreferences(null), DEFAULT_PREFERENCES)
  assert.deepEqual(validatePreferences('nope'), DEFAULT_PREFERENCES)
  assert.deepEqual(validatePreferences(42), DEFAULT_PREFERENCES)
})

test('validatePreferences: clamps thresholds into safe ranges', () => {
  const result = validatePreferences({
    priceMovePct: 100,
    volatilityPct: -3,
    stopWarnPct: Number.NaN,
    equityMovePct: 999,
  })
  assert.equal(result.priceMovePct, 25)
  assert.equal(result.volatilityPct, 0.5)
  assert.equal(result.stopWarnPct, DEFAULT_PREFERENCES.stopWarnPct)
  assert.equal(result.equityMovePct, 25)
})

test('validatePreferences: keeps explicit kind toggles, coerces bad ones', () => {
  const result = validatePreferences({
    kinds: { price: false, signal: 'yes', bogus: true },
    inApp: false,
    browser: true,
  })
  assert.equal(result.kinds.price, false)
  assert.equal(result.kinds.signal, true) // non-boolean → default
  assert.equal(result.kinds.daily, true)
  assert.ok(!('bogus' in result.kinds))
  assert.equal(result.inApp, false)
  assert.equal(result.browser, true)
})

test('preferences: load/save round-trips through localStorage', () => {
  const store = new Map<string, string>()
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
  const global = globalThis as { localStorage?: unknown }
  const hadLocalStorage = 'localStorage' in global
  const original = global.localStorage
  global.localStorage = fake

  try {
    // Nothing stored yet → defaults.
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES)

    const custom = prefs({ priceMovePct: 2.5, browser: true })
    custom.kinds.signal = false
    savePreferences(custom)

    const loaded = loadPreferences()
    assert.equal(loaded.priceMovePct, 2.5)
    assert.equal(loaded.browser, true)
    assert.equal(loaded.kinds.signal, false)

    // Corrupt JSON → defaults instead of throwing.
    store.set('cryptopilot.notifications.prefs', '{broken')
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES)
  } finally {
    if (hadLocalStorage) global.localStorage = original
    else delete global.localStorage
  }
})

test('preferences: without localStorage everything degrades to defaults', () => {
  const global = globalThis as { localStorage?: unknown }
  const hadLocalStorage = 'localStorage' in global
  const original = global.localStorage
  delete global.localStorage
  try {
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES)
    assert.doesNotThrow(() => savePreferences(DEFAULT_PREFERENCES))
  } finally {
    if (hadLocalStorage) global.localStorage = original
  }
})

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

test('first run seeds silently: no notifications, refs captured', () => {
  const paper = snapshot(
    paperState({
      account: account({ equity: 10_250 }),
      signals: [signal()],
      closedPositions: [closedPosition()],
    }),
  )
  const result = seed(market(), paper)

  assert.equal(result.notifications.length, 0)
  assert.equal(result.state.seeded, true)
  assert.equal(result.state.priceRefs.BTCUSDT, 100)
  assert.equal(result.state.priceRefs.ETHUSDT, 10)
  assert.equal(result.state.priceRefs.SOLUSDT, 1)
  assert.equal(result.state.equityRef, 10_250)
  assert.equal(result.state.dayStartEquity, 10_250)
  assert.deepEqual(result.state.seenSignals, ['sig-1'])
  assert.deepEqual(result.state.closedSeen, ['pos-1'])
  assert.equal(result.state.lastSummaryDay, utcDay(T0))
  assert.equal(result.state.connectionDown, false)
  assert.equal(result.state.staleFlag, false)
  assert.equal(result.state.priceErrorFlag, false)
})

test('seeding does not mutate the input state object', () => {
  const fresh = initialAlertState()
  seed(market(), snapshot(paperState()), prefs(), T0)
  assert.equal(fresh.seeded, false)
  assert.deepEqual(fresh.priceRefs, {})
})

test('seed while the feed is already down stays silent', () => {
  const result = seed(
    market({ connection: 'reconnecting', stale: true }),
    snapshot(paperState({ priceError: 'Binance 503' })),
  )
  assert.equal(result.notifications.length, 0)
  assert.equal(result.state.connectionDown, true)
  assert.equal(result.state.staleFlag, true)
  assert.equal(result.state.priceErrorFlag, true)

  // Recovery is silent too; only a *new* drop notifies.
  const recovered = run(result.state, market(), snapshot(paperState()), T0 + MINUTE)
  assert.equal(recovered.notifications.length, 0)
  assert.equal(recovered.state.connectionDown, false)
  assert.equal(recovered.state.staleFlag, false)
  assert.equal(recovered.state.priceErrorFlag, false)
})

/* ------------------------------------------------------------------ */
/* Price alerts                                                        */
/* ------------------------------------------------------------------ */

test('price alert fires on threshold crossing and resets its reference', () => {
  const first = seed(market(), snapshot(paperState()))
  assert.equal(first.notifications.length, 0)

  const moved = run(
    first.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 101.5),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0,
  )
  const price = moved.notifications.find((n) => n.kind === 'price')
  assert.ok(price, 'expected a price notification')
  assert.equal(price.key, 'price:BTCUSDT')
  assert.match(price.title, /BTC up 1\.50%/)
  assert.match(price.body, /101\.50/)
  assert.match(price.body, /from 100\.00/)
  assert.equal(price.href, '/markets')
  assert.equal(moved.state.priceRefs.BTCUSDT, 101.5)

  // Same price again → no move from the new reference.
  const same = run(
    moved.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 101.5),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0 + MINUTE,
  )
  assert.equal(same.notifications.filter((n) => n.kind === 'price').length, 0)
})

test('price alerts are cooldown-limited and the reference survives the block', () => {
  const first = seed(market(), snapshot(paperState()))
  const alerted = run(
    first.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 101.5),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0,
  )
  assert.equal(alerted.notifications.filter((n) => n.kind === 'price').length, 1)

  // 5 minutes later price is +3% from the old ref, but inside the 15m window.
  const blocked = run(
    alerted.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 103),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0 + 5 * MINUTE,
  )
  assert.equal(blocked.notifications.length, 0)
  assert.equal(blocked.state.priceRefs.BTCUSDT, 101.5) // ref not advanced

  // After the window the sustained move is reported.
  const later = run(
    blocked.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 103),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0 + 16 * MINUTE,
  )
  assert.equal(later.notifications.filter((n) => n.kind === 'price').length, 1)
  assert.equal(later.state.priceRefs.BTCUSDT, 103)
})

test('disabled price kind advances the reference silently', () => {
  const off = prefs()
  off.kinds.price = false

  const first = seed(market(), snapshot(paperState()), off)
  const moved = run(
    first.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 101.5),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0,
    off,
  )
  assert.equal(moved.notifications.length, 0)
  assert.equal(moved.state.priceRefs.BTCUSDT, 101.5) // acknowledged, not replayed later

  // Re-enable: no backlog alert; only a fresh move from the new ref counts.
  const backOn = run(
    moved.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 101.5),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0 + MINUTE,
    prefs(),
  )
  assert.equal(backOn.notifications.length, 0)
})

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

test('a new AI signal is notified exactly once', () => {
  const first = seed(market(), snapshot(paperState()))
  const withSignal = run(
    first.state,
    market(),
    snapshot(paperState({ signals: [signal()] })),
    T0 + MINUTE,
  )
  const news = withSignal.notifications.filter((n) => n.kind === 'signal')
  assert.equal(news.length, 1)
  assert.equal(news[0].key, 'signal:sig-1')
  assert.match(news[0].title, /New BUY signal · BTC 15m/)
  assert.match(news[0].body, /not a win probability/)

  // Same signal on the next poll → nothing.
  const again = run(
    withSignal.state,
    market(),
    snapshot(paperState({ signals: [signal()] })),
    T0 + 2 * MINUTE,
  )
  assert.equal(again.notifications.length, 0)
})

test('disabled signal kind still marks ids seen (no replay on enable)', () => {
  const off = prefs()
  off.kinds.signal = false

  const first = seed(market(), snapshot(paperState()), off)
  const withSignal = run(
    first.state,
    market(),
    snapshot(paperState({ signals: [signal()] })),
    T0 + MINUTE,
    off,
  )
  assert.equal(withSignal.notifications.length, 0)
  assert.deepEqual(withSignal.state.seenSignals, ['sig-1'])

  const backOn = run(
    withSignal.state,
    market(),
    snapshot(paperState({ signals: [signal()] })),
    T0 + 2 * MINUTE,
    prefs(),
  )
  assert.equal(backOn.notifications.length, 0)
})

/* ------------------------------------------------------------------ */
/* Exits: stop-loss / take-profit / manual                             */
/* ------------------------------------------------------------------ */

test('closed positions notify by exit reason', () => {
  const first = seed(market(), snapshot(paperState({ openPositions: [openPosition()] })))

  const cases = [
    { reason: 'stop-loss' as const, kind: 'stop-loss', title: /Stop-loss hit · BTC/ },
    { reason: 'take-profit' as const, kind: 'take-profit', title: /Take-profit hit · BTC/ },
    { reason: 'manual' as const, kind: 'pnl', title: /Position closed · BTC/ },
  ]

  for (const entry of cases) {
    const result = run(
      first.state,
      market(),
      snapshot(
        paperState({
          closedPositions: [
            closedPosition({ exitReason: entry.reason, realizedPnl: 4.9 }),
          ],
        }),
      ),
      T0 + MINUTE,
    )
    const hit = result.notifications.find((n) => n.key === 'close:pos-1')
    assert.ok(hit, `expected a close notification for ${entry.reason}`)
    assert.equal(hit.kind, entry.kind)
    assert.match(hit.title, entry.title)
    assert.match(hit.body, /Realized P&L \$4\.90/)
  }
})

test('close notifications never repeat for the same position', () => {
  const first = seed(market(), snapshot(paperState({ openPositions: [openPosition()] })))
  const closed = snapshot(
    paperState({ closedPositions: [closedPosition({ exitReason: 'stop-loss' })] }),
  )
  const once = run(first.state, market(), closed, T0 + MINUTE)
  assert.equal(once.notifications.filter((n) => n.key === 'close:pos-1').length, 1)

  const twice = run(once.state, market(), closed, T0 + 2 * MINUTE)
  assert.equal(twice.notifications.filter((n) => n.key === 'close:pos-1').length, 0)
  assert.deepEqual(twice.state.closedSeen, ['pos-1'])
})

/* ------------------------------------------------------------------ */
/* Stop-loss proximity warning                                         */
/* ------------------------------------------------------------------ */

test('stop-loss warning fires inside the band and respects its cooldown', () => {
  const far = openPosition({ currentPrice: 100 }) // 3% above stop
  const first = seed(market(), snapshot(paperState({ openPositions: [far] })))
  assert.equal(first.notifications.length, 0)

  const near = openPosition({ currentPrice: 97.9 }) // 0.9% above stop
  const warned = run(
    first.state,
    market(),
    snapshot(paperState({ openPositions: [near] })),
    T0 + MINUTE,
  )
  const warning = warned.notifications.find((n) => n.key === 'stop:pos-1')
  assert.ok(warning, 'expected a stop-loss proximity warning')
  assert.equal(warning.kind, 'stop-loss')
  assert.match(warning.title, /Stop-loss near · BTC/)
  assert.match(warning.body, /within 0\.90% of your stop/)

  // Still near 10 minutes later → 30m cooldown blocks a repeat.
  const repeat = run(
    warned.state,
    market(),
    snapshot(paperState({ openPositions: [near] })),
    T0 + 11 * MINUTE,
  )
  assert.equal(repeat.notifications.filter((n) => n.key === 'stop:pos-1').length, 0)

  // Still near 31 minutes after the warning → allowed again.
  const later = run(
    repeat.state,
    market(),
    snapshot(paperState({ openPositions: [near] })),
    T0 + 32 * MINUTE,
  )
  assert.equal(later.notifications.filter((n) => n.key === 'stop:pos-1').length, 1)
})

test('stop-loss warning stays quiet while price is far from the stop', () => {
  const first = seed(market(), snapshot(paperState({ openPositions: [openPosition()] })))
  const still = run(
    first.state,
    market(),
    snapshot(paperState({ openPositions: [openPosition({ currentPrice: 99 })] })),
    T0 + MINUTE,
  )
  assert.equal(still.notifications.length, 0)
})

/* ------------------------------------------------------------------ */
/* Equity / P&L updates                                                */
/* ------------------------------------------------------------------ */

test('equity drift beyond the threshold notifies and re-anchors', () => {
  const first = seed(market(), snapshot(paperState()))
  const drifted = run(
    first.state,
    market(),
    snapshot(paperState({ account: account({ equity: 10_150 }) })),
    T0 + MINUTE,
  )
  const pnl = drifted.notifications.find((n) => n.key === 'equity')
  assert.ok(pnl, 'expected an equity drift notification')
  assert.equal(pnl.kind, 'pnl')
  assert.match(pnl.title, /Virtual equity up 1\.50%/)
  assert.match(pnl.body, /\$10,150\.00 from \$10,000\.00/)
  assert.match(pnl.body, /paper account only/)
  assert.equal(drifted.state.equityRef, 10_150)

  // Small wiggle under the threshold → nothing.
  const small = run(
    drifted.state,
    market(),
    snapshot(paperState({ account: account({ equity: 10_200 }) })),
    T0 + 2 * MINUTE,
  )
  assert.equal(small.notifications.filter((n) => n.key === 'equity').length, 0)
})

test('equity drift down is severity warning', () => {
  const first = seed(market(), snapshot(paperState({ account: account({ equity: 9_900 }) })))
  const down = run(
    first.state,
    market(),
    snapshot(paperState({ account: account({ equity: 9_700 }) })),
    T0 + MINUTE,
  )
  const pnl = down.notifications.find((n) => n.key === 'equity')
  assert.ok(pnl)
  assert.equal(pnl.severity, 'warning')
  assert.match(pnl.title, /Virtual equity down/)
})

/* ------------------------------------------------------------------ */
/* Volatility                                                          */
/* ------------------------------------------------------------------ */

test('volatility latch: fires once per episode, re-arms below threshold', () => {
  const calm = market({
    tickers: {
      BTCUSDT: ticker('BTCUSDT', 100, { high: 101, low: 100, open: 100 }),
      ETHUSDT: ticker('ETHUSDT', 10),
      SOLUSDT: ticker('SOLUSDT', 1),
    },
  })
  const first = seed(calm, snapshot(paperState()))

  const hotTickers = {
    BTCUSDT: ticker('BTCUSDT', 100, { high: 106, low: 100, open: 100 }), // 6% range
    ETHUSDT: ticker('ETHUSDT', 10),
    SOLUSDT: ticker('SOLUSDT', 1),
  }

  const hot = run(first.state, market({ tickers: hotTickers }), snapshot(paperState()), T0 + MINUTE)
  const vol = hot.notifications.find((n) => n.kind === 'volatility')
  assert.ok(vol, 'expected a volatility warning')
  assert.equal(vol.key, 'vol:BTCUSDT')
  assert.match(vol.body, /6\.00%/)
  assert.equal(hot.state.volAbove.BTCUSDT, true)

  // Still hot → latched, no repeat.
  const stillHot = run(
    hot.state,
    market({ tickers: hotTickers }),
    snapshot(paperState()),
    T0 + 2 * MINUTE,
  )
  assert.equal(stillHot.notifications.filter((n) => n.kind === 'volatility').length, 0)

  // Cools down → latch re-arms silently.
  const cooled = run(
    stillHot.state,
    market({
      tickers: {
        BTCUSDT: ticker('BTCUSDT', 100, { high: 101, low: 100, open: 100 }),
        ETHUSDT: ticker('ETHUSDT', 10),
        SOLUSDT: ticker('SOLUSDT', 1),
      },
    }),
    snapshot(paperState()),
    T0 + 3 * MINUTE,
  )
  assert.equal(cooled.notifications.length, 0)
  assert.equal(cooled.state.volAbove.BTCUSDT, false)

  // Heats up again → a fresh warning.
  const reheated = run(
    cooled.state,
    market({ tickers: hotTickers }),
    snapshot(paperState()),
    T0 + 4 * MINUTE,
  )
  assert.equal(reheated.notifications.filter((n) => n.kind === 'volatility').length, 1)
})

/* ------------------------------------------------------------------ */
/* Connectivity: disconnect / stale / price error                      */
/* ------------------------------------------------------------------ */

test('feed disconnection notifies on transition, recovery resets it', () => {
  const first = seed(market(), snapshot(paperState()))

  const dropped = run(
    first.state,
    market({ connection: 'reconnecting' }),
    snapshot(paperState()),
    T0 + MINUTE,
  )
  const disconnect = dropped.notifications.find((n) => n.key === 'connection')
  assert.ok(disconnect, 'expected a disconnect notification')
  assert.equal(disconnect.kind, 'disconnect')
  assert.equal(dropped.state.connectionDown, true)

  // Still down → no repeat.
  const stillDown = run(
    dropped.state,
    market({ connection: 'closed' }),
    snapshot(paperState()),
    T0 + 2 * MINUTE,
  )
  assert.equal(stillDown.notifications.filter((n) => n.key === 'connection').length, 0)

  // Recovery resets the flag silently.
  const back = run(stillDown.state, market(), snapshot(paperState()), T0 + 3 * MINUTE)
  assert.equal(back.notifications.length, 0)
  assert.equal(back.state.connectionDown, false)

  // A second drop right away is inside the 5m cooldown → suppressed.
  const again = run(
    back.state,
    market({ connection: 'reconnecting' }),
    snapshot(paperState()),
    T0 + 4 * MINUTE,
  )
  assert.equal(again.notifications.filter((n) => n.key === 'connection').length, 0)

  // Recovery, then a drop after the cooldown window → notified.
  const recovered = run(again.state, market(), snapshot(paperState()), T0 + 5 * MINUTE)
  const laterDrop = run(
    recovered.state,
    market({ connection: 'reconnecting' }),
    snapshot(paperState()),
    T0 + 7 * MINUTE,
  )
  assert.equal(laterDrop.notifications.filter((n) => n.key === 'connection').length, 1)
})

test('stale feed notifies once per episode with a 30m cooldown', () => {
  const first = seed(market(), snapshot(paperState()))

  const staleNow = run(first.state, market({ stale: true }), snapshot(paperState()), T0 + MINUTE)
  const staleNotice = staleNow.notifications.find((n) => n.kind === 'stale')
  assert.ok(staleNotice, 'expected a stale-data notification')
  assert.match(staleNotice.body, /20 seconds/)

  const stillStale = run(
    staleNow.state,
    market({ stale: true }),
    snapshot(paperState()),
    T0 + 2 * MINUTE,
  )
  assert.equal(stillStale.notifications.filter((n) => n.kind === 'stale').length, 0)

  const fresh = run(stillStale.state, market(), snapshot(paperState()), T0 + 3 * MINUTE)
  assert.equal(fresh.state.staleFlag, false)

  // Re-stales inside the 30m window → suppressed; after it → notified.
  const quickRelapse = run(fresh.state, market({ stale: true }), snapshot(paperState()), T0 + 4 * MINUTE)
  assert.equal(quickRelapse.notifications.filter((n) => n.kind === 'stale').length, 0)

  const recovered = run(quickRelapse.state, market(), snapshot(paperState()), T0 + 5 * MINUTE)
  const lateRelapse = run(
    recovered.state,
    market({ stale: true }),
    snapshot(paperState()),
    T0 + 36 * MINUTE,
  )
  assert.equal(lateRelapse.notifications.filter((n) => n.kind === 'stale').length, 1)
})

test('paper price-error transitions notify with the real error text', () => {
  const first = seed(market(), snapshot(paperState()))

  const broken = run(
    first.state,
    market(),
    snapshot(paperState({ priceError: 'Binance HTTP 503' })),
    T0 + MINUTE,
  )
  const notice = broken.notifications.find((n) => n.key === 'price-error')
  assert.ok(notice, 'expected a price-error notification')
  assert.equal(notice.kind, 'disconnect')
  assert.match(notice.body, /Binance HTTP 503/)
  assert.equal(broken.state.priceErrorFlag, true)

  // Repeats while broken → nothing.
  const stillBroken = run(
    broken.state,
    market(),
    snapshot(paperState({ priceError: 'Binance HTTP 503' })),
    T0 + 2 * MINUTE,
  )
  assert.equal(stillBroken.notifications.filter((n) => n.key === 'price-error').length, 0)

  // Paper API poll failure surfaces the same way (after the 5m cooldown).
  const recovered = run(stillBroken.state, market(), snapshot(paperState()), T0 + 3 * MINUTE)
  assert.equal(recovered.state.priceErrorFlag, false)
  const pollFailed = run(recovered.state, market(), snapshot(null, 'Paper API unreachable'), T0 + 7 * MINUTE)
  assert.equal(
    pollFailed.notifications.filter((n) => n.key === 'price-error').length,
    1,
  )
})

/* ------------------------------------------------------------------ */
/* Daily summary                                                       */
/* ------------------------------------------------------------------ */

test('daily summary advances silently on a quiet day', () => {
  const first = seed(market(), snapshot(paperState()))
  const nextDay = run(first.state, market(), snapshot(paperState()), Date.parse('2026-11-14T00:00:01Z'))
  assert.equal(nextDay.notifications.length, 0)
  assert.equal(nextDay.state.lastSummaryDay, '2026-11-14')
})

test('daily summary advances silently when no paper data exists yet', () => {
  const first = seed(market(), null)
  const nextDay = run(first.state, market(), null, Date.parse('2026-11-14T00:00:01Z'))
  assert.equal(nextDay.notifications.length, 0)
  assert.equal(nextDay.state.lastSummaryDay, '2026-11-14')
})

test('daily summary reports real tracked numbers after activity', () => {
  const first = seed(market(), snapshot(paperState()))

  // Roll into day 2 quietly — nothing has happened yet.
  const dayTwo = run(
    first.state,
    market(),
    snapshot(paperState()),
    Date.parse('2026-11-14T00:00:01Z'),
  )
  assert.equal(dayTwo.notifications.length, 0)
  assert.equal(dayTwo.state.lastSummaryDay, '2026-11-14')

  // Mid-day: a position closes for +$40 realized and equity moves to 10,040.
  const dayTwoClose = run(
    dayTwo.state,
    market(),
    snapshot(
      paperState({
        account: account({ equity: 10_040, realizedPnl: 40, closedTrades: 1, wins: 1 }),
        closedPositions: [closedPosition({ exitReason: 'manual', realizedPnl: 40 })],
      }),
    ),
    Date.parse('2026-11-14T12:00:00Z'),
  )
  assert.equal(
    dayTwoClose.notifications.filter((n) => n.kind === 'daily').length,
    0,
    'summary only fires at the day boundary',
  )
  assert.equal(dayTwoClose.state.dayClosedCount, 1)
  assert.equal(dayTwoClose.state.dayRealized, 40)

  // Day 3 boundary → summary built from what was actually tracked.
  const dayThree = run(
    dayTwoClose.state,
    market(),
    snapshot(
      paperState({
        account: account({ equity: 10_040, realizedPnl: 40, closedTrades: 1, wins: 1 }),
        closedPositions: [closedPosition({ exitReason: 'manual', realizedPnl: 40 })],
      }),
    ),
    Date.parse('2026-11-15T00:00:01Z'),
  )
  const summary = dayThree.notifications.find((n) => n.kind === 'daily')
  assert.ok(summary, 'expected a daily summary')
  assert.equal(summary.title, 'Daily performance summary')
  assert.match(summary.body, /2026-11-14 UTC/)
  assert.match(summary.body, /\$10,040\.00/)
  assert.match(summary.body, /session change \$40\.00/)
  assert.match(summary.body, /1 closed \(1 wins\)/)
  assert.match(summary.body, /realized \$40\.00/)
  assert.match(summary.body, /do not predict future performance/)

  // Counters reset for the new day.
  assert.equal(dayThree.state.dayClosedCount, 0)
  assert.equal(dayThree.state.dayRealized, 0)
  assert.equal(dayThree.state.lastSummaryDay, '2026-11-15')
})

/* ------------------------------------------------------------------ */
/* Duplicate protection (cross-pass)                                   */
/* ------------------------------------------------------------------ */

test('dedupeNotifications: price window is 15 minutes per key', () => {
  const now = T0
  const candidate = notification({ key: 'price:BTCUSDT', kind: 'price', at: now })

  const recentBlock = [notification({ key: 'price:BTCUSDT', kind: 'price', at: now - 10 * MINUTE })]
  assert.deepEqual(dedupeNotifications([candidate], recentBlock, now), [])

  const recentExpired = [notification({ key: 'price:BTCUSDT', kind: 'price', at: now - 20 * MINUTE })]
  assert.equal(dedupeNotifications([candidate], recentExpired, now).length, 1)

  const otherSymbol = [notification({ key: 'price:ETHUSDT', kind: 'price', at: now - MINUTE })]
  assert.equal(dedupeNotifications([candidate], otherSymbol, now).length, 1)
})

test('dedupeNotifications: cooldown-0 kinds pass through but batch dupes collapse', () => {
  const now = T0
  const signalA = notification({ kind: 'signal', key: 'signal:a', at: now })
  const signalB = notification({ kind: 'signal', key: 'signal:b', at: now })
  const duplicateA = notification({ kind: 'signal', key: 'signal:a', at: now + 1 })

  // Cooldown 0 → a recently delivered signal key is still allowed (ids are unique).
  const recent = [notification({ kind: 'signal', key: 'signal:a', at: now - MINUTE })]
  assert.equal(dedupeNotifications([signalA], recent, now).length, 1)

  // Inside one batch the same key is only emitted once.
  const result = dedupeNotifications([signalA, signalB, duplicateA], [], now)
  assert.deepEqual(
    result.map((n) => n.key),
    ['signal:a', 'signal:b'],
  )
})

test('dedupeNotifications: disconnect window is 5 minutes', () => {
  const now = T0
  const candidate = notification({ kind: 'disconnect', key: 'connection', at: now })
  const recent = [notification({ kind: 'disconnect', key: 'connection', at: now - 4 * MINUTE })]
  assert.deepEqual(dedupeNotifications([candidate], recent, now), [])
  const older = [notification({ kind: 'disconnect', key: 'connection', at: now - 6 * MINUTE })]
  assert.equal(dedupeNotifications([candidate], older, now).length, 1)
})

/* ------------------------------------------------------------------ */
/* Browser delivery                                                    */
/* ------------------------------------------------------------------ */

test('deliverBrowser: respects the channel and kind toggles', () => {
  const item = notification()
  const disabledChannel = prefs({ browser: false })
  assert.equal(
    deliverBrowser(item, disabledChannel, 'granted', class {} as never),
    'muted',
  )

  const disabledKind = prefs({ browser: true })
  disabledKind.kinds.price = false
  assert.equal(
    deliverBrowser(item, disabledKind, 'granted', class {} as never),
    'muted',
  )
})

test('deliverBrowser: reports unsupported / denied without throwing', () => {
  const item = notification()
  const enabled = prefs({ browser: true })
  assert.equal(deliverBrowser(item, enabled, 'unsupported', null), 'unsupported')
  assert.equal(deliverBrowser(item, enabled, 'granted', null), 'unsupported')
  assert.equal(deliverBrowser(item, enabled, 'default', class {} as never), 'denied')
  assert.equal(deliverBrowser(item, enabled, 'denied', class {} as never), 'denied')
})

test('deliverBrowser: sends with the dedupe key as the OS tag', () => {
  const calls: Array<{ title: string; options: { body?: string; tag?: string } }> = []
  class FakeNotification {
    constructor(title: string, options?: { body?: string; tag?: string }) {
      calls.push({ title, options: options ?? {} })
    }
  }

  const item = notification({
    kind: 'stale',
    key: 'stale',
    title: 'Market data is stale',
    body: 'No ticker updates for over 20 seconds.',
  })
  const result = deliverBrowser(item, prefs({ browser: true }), 'granted', FakeNotification as never)

  assert.equal(result, 'sent')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].title, 'Market data is stale')
  assert.equal(calls[0].options.tag, 'stale')
  assert.match(String(calls[0].options.body), /20 seconds/)
})

test('deliverBrowser: a throwing constructor maps to error', () => {
  class ThrowingNotification {
    constructor() {
      throw new Error('blocked by the OS')
    }
  }
  const result = deliverBrowser(
    notification(),
    prefs({ browser: true }),
    'granted',
    ThrowingNotification as never,
  )
  assert.equal(result, 'error')
})

test('browser permission helpers: unsupported in Node, fake grant path', async () => {
  const global = globalThis as { Notification?: unknown }
  const hadNotification = 'Notification' in global
  const original = global.Notification
  delete global.Notification

  try {
    assert.equal(getBrowserPermission(), 'unsupported')
    assert.equal(await requestBrowserPermission(), 'unsupported')
  } finally {
    if (hadNotification) global.Notification = original
  }

  // Fake granted browser.
  const fake = { requested: 0 }
  class FakeNotification {
    static permission: NotificationPermission = 'default'
    static async requestPermission(): Promise<NotificationPermission> {
      fake.requested += 1
      FakeNotification.permission = 'granted'
      return 'granted'
    }
  }
  global.Notification = FakeNotification
  try {
    assert.equal(getBrowserPermission(), 'default')
    assert.equal(await requestBrowserPermission(), 'granted')
    assert.equal(fake.requested, 1)
    assert.equal(getBrowserPermission(), 'granted')
  } finally {
    if (hadNotification) global.Notification = original
    else delete global.Notification
  }
})
