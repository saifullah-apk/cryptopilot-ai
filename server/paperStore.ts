/**
 * SQLite persistence for the paper-trading engine.
 *
 * Uses Node's built-in `node:sqlite` — no external dependency. Only
 * simulated signals, positions, orders and the virtual account are stored.
 * No exchange account, no credentials, no withdrawal data ever touches
 * this database.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STARTING_BALANCE,
  type AiProvider,
  type ExitReason,
  type PaperInterval,
  type PaperOrder,
  type PaperPosition,
  type PaperSymbol,
  type SignalAction,
  type SignalStatus,
  type TradeSide,
  type TradeSignal,
} from '../src/lib/paperTrading.ts'
import type {
  BacktestReport,
  BacktestRunSummary,
  StoredBacktestRun,
} from '../src/lib/backtest.ts'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, 'data/paper.db')

/**
 * SQLite is embedded, so it has no host/username/password. The only
 * connection setting is the database file. `PAPER_DB_PATH` may be absolute
 * or relative to the project root; unset falls back to `data/paper.db`.
 */
export function resolveDatabasePath(): string {
  const configured = process.env.PAPER_DB_PATH?.trim()
  if (!configured) return DEFAULT_DB_PATH
  return resolve(PROJECT_ROOT, configured)
}


/**
 * Canonical DDL lives in `schema/schema.sql` so it can also be imported by
 * hand (sqlite3 CLI) or via `npm run db:init`. Every statement is
 * idempotent, so applying it never drops or overwrites existing data.
 */
export const SCHEMA_PATH = resolve(PROJECT_ROOT, 'schema/schema.sql')
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8')

/* ------------------------------------------------------------------ */
/* Row mapping                                                        */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>

const num = (value: unknown): number => Number(value)
const str = (value: unknown): string => String(value)

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function jsonStrings(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(str(value))
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rowToSignal(row: Row): TradeSignal {
  return {
    id: str(row.id),
    symbol: str(row.symbol) as PaperSymbol,
    interval: str(row.timeframe) as PaperInterval,
    action: str(row.action) as SignalAction,
    side: str(row.side) as TradeSide,
    marketPrice: num(row.market_price),
    technicalReasoning: jsonStrings(row.technical_reasoning),
    aiExplanation: str(row.ai_explanation),
    aiProvider: str(row.ai_provider) as AiProvider,
    confidence: num(row.confidence),
    entry: num(row.entry),
    stopLoss: num(row.stop_loss),
    takeProfit: num(row.take_profit),
    riskReward: num(row.risk_reward),
    riskWarnings: jsonStrings(row.risk_warnings),
    createdAt: num(row.created_at),
    expiresAt: num(row.expires_at),
    status: str(row.status) as SignalStatus,
    decidedAt: nullableNum(row.decided_at),
    decisionNote: nullableStr(row.decision_note),
  }
}

function rowToPosition(row: Row): PaperPosition {
  return {
    id: str(row.id),
    signalId: str(row.signal_id),
    symbol: str(row.symbol) as PaperSymbol,
    interval: str(row.timeframe) as PaperInterval,
    side: str(row.side) as TradeSide,
    quantity: num(row.quantity),
    entryPrice: num(row.entry_price),
    stopLoss: num(row.stop_loss),
    takeProfit: num(row.take_profit),
    fees: num(row.fees),
    openedAt: num(row.opened_at),
    status: str(row.status) as 'open' | 'closed',
    exitPrice: nullableNum(row.exit_price),
    exitReason: nullableStr(row.exit_reason) as ExitReason | null,
    closedAt: nullableNum(row.closed_at),
    realizedPnl: nullableNum(row.realized_pnl),
    // Derived on read — never persisted.
    currentPrice: null,
    unrealizedPnl: null,
    pnlPercent: null,
  }
}

function rowToOrder(row: Row): PaperOrder {
  return {
    id: str(row.id),
    signalId: str(row.signal_id),
    positionId: str(row.position_id),
    symbol: str(row.symbol) as PaperSymbol,
    side: str(row.side) as 'buy' | 'sell',
    quantity: num(row.quantity),
    requestedPrice: num(row.requested_price),
    fillPrice: num(row.fill_price),
    fee: num(row.fee),
    slippageCost: num(row.slippage_cost),
    createdAt: num(row.created_at),
  }
}

function rowToBacktestSummary(row: Row): BacktestRunSummary {
  return {
    id: str(row.id),
    symbol: str(row.symbol) as BacktestRunSummary['symbol'],
    interval: str(row.timeframe) as BacktestRunSummary['interval'],
    startTime: num(row.start_time),
    endTime: num(row.end_time),
    initialCapital: num(row.initial_capital),
    riskPct: num(row.risk_pct),
    minConfidence: num(row.min_confidence),
    trades: num(row.trades),
    netPnl: num(row.net_pnl),
    winRate: nullableNum(row.win_rate),
    maxDrawdownPct: num(row.max_drawdown_pct),
    createdAt: num(row.created_at),
  }
}

function parseReport(value: unknown): BacktestReport | null {
  try {
    const parsed: unknown = JSON.parse(str(value))
    return parsed && typeof parsed === 'object' ? (parsed as BacktestReport) : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export type AccountRow = {
  startingBalance: number
  cash: number
  paused: boolean
}

export type ClosedPositionPatch = {
  exitPrice: number
  exitReason: ExitReason
  closedAt: number
  realizedPnl: number
  fees: number
}

export type PaperStore = {  getAccount(): AccountRow
  setCash(cash: number): void
  setPaused(paused: boolean): void

  insertSignal(signal: TradeSignal): void
  getSignal(id: string): TradeSignal | null
  listSignals(limit?: number): TradeSignal[]
  decideSignal(id: string, status: SignalStatus, note: string | null, at: number): void
  expireStaleSignals(now: number): number

  insertPosition(position: PaperPosition): void
  getPosition(id: string): PaperPosition | null
  listOpenPositions(): PaperPosition[]
  listClosedPositions(limit?: number): PaperPosition[]
  closedSince(since: number): PaperPosition[]
  closePosition(id: string, patch: ClosedPositionPatch): void

  insertOrder(order: PaperOrder): void
  listOrders(limit?: number): PaperOrder[]

  insertBacktestRun(run: StoredBacktestRun): void
  listBacktestRuns(limit?: number): BacktestRunSummary[]
  getBacktestRun(id: string): StoredBacktestRun | null

  transaction<T>(fn: () => T): T
  close(): void
}

export function createPaperStore(dbPath: string = resolveDatabasePath()): PaperStore {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(SCHEMA)

  // Seed the virtual account exactly once.
  db.prepare(
    `INSERT OR IGNORE INTO paper_account (id, starting_balance, cash, paused, created_at)
     VALUES (1, ?, ?, 0, ?)`,
  ).run(STARTING_BALANCE, STARTING_BALANCE, Date.now())

  const getAccount = (): AccountRow => {
    const row = db.prepare('SELECT starting_balance, cash, paused FROM paper_account WHERE id = 1').get() as
      | Row
      | undefined
    if (!row) throw new Error('Paper account row is missing.')
    return {
      startingBalance: num(row.starting_balance),
      cash: num(row.cash),
      paused: num(row.paused) === 1,
    }
  }

  return {
    getAccount,

    setCash(cash: number): void {
      db.prepare('UPDATE paper_account SET cash = ? WHERE id = 1').run(cash)
    },

    setPaused(paused: boolean): void {
      db.prepare('UPDATE paper_account SET paused = ? WHERE id = 1').run(paused ? 1 : 0)
    },

    insertSignal(signal: TradeSignal): void {
      db.prepare(
        `INSERT INTO paper_signals (
           id, symbol, timeframe, action, side, market_price, technical_reasoning,
           ai_explanation, ai_provider, confidence, entry, stop_loss, take_profit,
           risk_reward, risk_warnings, created_at, expires_at, status, decided_at, decision_note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        signal.id,
        signal.symbol,
        signal.interval,
        signal.action,
        signal.side,
        signal.marketPrice,
        JSON.stringify(signal.technicalReasoning),
        signal.aiExplanation,
        signal.aiProvider,
        signal.confidence,
        signal.entry,
        signal.stopLoss,
        signal.takeProfit,
        signal.riskReward,
        JSON.stringify(signal.riskWarnings),
        signal.createdAt,
        signal.expiresAt,
        signal.status,
        signal.decidedAt,
        signal.decisionNote,
      )
    },

    getSignal(id: string): TradeSignal | null {
      const row = db.prepare('SELECT * FROM paper_signals WHERE id = ?').get(id) as Row | undefined
      return row ? rowToSignal(row) : null
    },

    listSignals(limit = 40): TradeSignal[] {
      const rows = db
        .prepare('SELECT * FROM paper_signals ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as Row[]
      return rows.map(rowToSignal)
    },

    decideSignal(id: string, status: SignalStatus, note: string | null, at: number): void {
      db.prepare(
        'UPDATE paper_signals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?',
      ).run(status, at, note, id)
    },

    expireStaleSignals(now: number): number {
      const result = db
        .prepare(
          `UPDATE paper_signals
             SET status = 'expired', decided_at = ?, decision_note = 'Expired before review'
           WHERE status = 'pending' AND expires_at <= ?`,
        )
        .run(now, now)
      return Number(result.changes ?? 0)
    },

    insertPosition(position: PaperPosition): void {
      db.prepare(
        `INSERT INTO paper_positions (
           id, signal_id, symbol, timeframe, side, quantity, entry_price, stop_loss,
           take_profit, fees, opened_at, status, exit_price, exit_reason, closed_at, realized_pnl
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        position.id,
        position.signalId,
        position.symbol,
        position.interval,
        position.side,
        position.quantity,
        position.entryPrice,
        position.stopLoss,
        position.takeProfit,
        position.fees,
        position.openedAt,
        position.status,
        position.exitPrice,
        position.exitReason,
        position.closedAt,
        position.realizedPnl,
      )
    },

    getPosition(id: string): PaperPosition | null {
      const row = db.prepare('SELECT * FROM paper_positions WHERE id = ?').get(id) as Row | undefined
      return row ? rowToPosition(row) : null
    },

    listOpenPositions(): PaperPosition[] {
      const rows = db
        .prepare("SELECT * FROM paper_positions WHERE status = 'open' ORDER BY opened_at ASC")
        .all() as Row[]
      return rows.map(rowToPosition)
    },

    listClosedPositions(limit = 40): PaperPosition[] {
      const rows = db
        .prepare(
          "SELECT * FROM paper_positions WHERE status = 'closed' ORDER BY closed_at DESC, rowid DESC LIMIT ?",
        )
        .all(limit) as Row[]
      return rows.map(rowToPosition)
    },

    closedSince(since: number): PaperPosition[] {
      const rows = db
        .prepare(
          "SELECT * FROM paper_positions WHERE status = 'closed' AND closed_at >= ? ORDER BY closed_at ASC",
        )
        .all(since) as Row[]
      return rows.map(rowToPosition)
    },

    closePosition(id: string, patch: ClosedPositionPatch): void {
      db.prepare(
        `UPDATE paper_positions
           SET status = 'closed', exit_price = ?, exit_reason = ?, closed_at = ?,
               realized_pnl = ?, fees = ?
         WHERE id = ? AND status = 'open'`,
      ).run(patch.exitPrice, patch.exitReason, patch.closedAt, patch.realizedPnl, patch.fees, id)
    },

    insertOrder(order: PaperOrder): void {
      db.prepare(
        `INSERT INTO paper_orders (
           id, signal_id, position_id, symbol, side, quantity, requested_price,
           fill_price, fee, slippage_cost, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        order.id,
        order.signalId,
        order.positionId,
        order.symbol,
        order.side,
        order.quantity,
        order.requestedPrice,
        order.fillPrice,
        order.fee,
        order.slippageCost,
        order.createdAt,
      )
    },

    listOrders(limit = 60): PaperOrder[] {
      const rows = db
        .prepare('SELECT * FROM paper_orders ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as Row[]
      return rows.map(rowToOrder)
    },

    insertBacktestRun(run: StoredBacktestRun): void {
      const { summary, report } = run
      db.prepare(
        `INSERT INTO backtest_runs (
           id, symbol, timeframe, start_time, end_time, initial_capital, risk_pct,
           min_confidence, trades, net_pnl, win_rate, max_drawdown_pct, report, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        summary.id,
        summary.symbol,
        summary.interval,
        summary.startTime,
        summary.endTime,
        summary.initialCapital,
        summary.riskPct,
        summary.minConfidence,
        summary.trades,
        summary.netPnl,
        summary.winRate,
        summary.maxDrawdownPct,
        JSON.stringify(report),
        summary.createdAt,
      )
    },

    listBacktestRuns(limit = 20): BacktestRunSummary[] {
      const rows = db
        .prepare('SELECT * FROM backtest_runs ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as Row[]
      return rows.map(rowToBacktestSummary)
    },

    getBacktestRun(id: string): StoredBacktestRun | null {
      const row = db.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id) as Row | undefined
      if (!row) return null
      const report = parseReport(row.report)
      if (!report) return null
      return { summary: rowToBacktestSummary(row), report }
    },

    transaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE')
      try {
        const out = fn()
        db.exec('COMMIT')
        return out
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* rollback of an already-aborted transaction */
        }
        throw error
      }
    },

    close(): void {
      db.close()
    },
  }
}

let defaultStore: PaperStore | null = null

/** Process-wide store used by the API server. */
export function getDefaultStore(): PaperStore {
  if (!defaultStore) defaultStore = createPaperStore()
  return defaultStore
}
