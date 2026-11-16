/**
 * Backtest orchestration: fetch historical public candles, run the pure
 * engine, and persist the report in the local SQLite database.
 *
 * No exchange credentials are involved and no order endpoint is touched.
 */

import { randomUUID } from 'node:crypto'

import { fetchKlinesRange, type Interval, type MarketSymbol } from '../src/lib/binance.ts'
import {
  ANALYSIS_WINDOW,
  INTERVAL_MS,
  MAX_BACKTEST_CANDLES,
  runBacktest,
  type BacktestReport,
  type BacktestRequest,
  type BacktestRunSummary,
  type StoredBacktestRun,
} from '../src/lib/backtest.ts'
import type { PaperStore } from './paperStore.ts'

export class BacktestError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'backtest-error') {
    super(message)
    this.name = 'BacktestError'
    this.status = status
    this.code = code
  }
}

export type HistoricalRangeFetcher = (
  symbol: MarketSymbol | string,
  interval: Interval,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
  maxCandles?: number,
) => Promise<import('../src/lib/binance.ts').Candle[]>

export type BacktestServiceDeps = {
  store: PaperStore
  fetchRange?: HistoricalRangeFetcher
}

export type BacktestService = {
  run(params: BacktestRequest): Promise<StoredBacktestRun>
  list(limit?: number): BacktestRunSummary[]
  get(id: string): StoredBacktestRun
}

export function buildRunSummary(id: string, report: BacktestReport): BacktestRunSummary {
  return {
    id,
    symbol: report.symbol,
    interval: report.interval,
    startTime: report.startTime,
    endTime: report.endTime,
    initialCapital: report.params.initialCapital,
    riskPct: report.params.riskPct,
    minConfidence: report.params.minConfidence,
    trades: report.metrics.totalTrades,
    netPnl: report.metrics.netPnl,
    winRate: report.metrics.winRate,
    maxDrawdownPct: report.metrics.maxDrawdownPct,
    createdAt: report.generatedAt,
  }
}

export function createBacktestService(deps: BacktestServiceDeps): BacktestService {
  const store = deps.store
  const fetchRange = deps.fetchRange ?? fetchKlinesRange

  return {
    async run(params: BacktestRequest): Promise<StoredBacktestRun> {
      // Warm-up candles let the indicator engine see a full history before
      // the first in-range signal; they are never traded.
      const warmupMs = INTERVAL_MS[params.interval] * ANALYSIS_WINDOW
      const fetchStart = Math.max(0, params.startTime - warmupMs)
      const cap = MAX_BACKTEST_CANDLES + ANALYSIS_WINDOW + 5

      let candles
      try {
        candles = await fetchRange(
          params.symbol,
          params.interval,
          fetchStart,
          params.endTime,
          undefined,
          cap,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Historical candles are unavailable.'
        throw new BacktestError(
          `Unable to load historical Binance candles: ${message}`,
          502,
          'market-data',
        )
      }

      if (candles.length === 0) {
        throw new BacktestError(
          'Binance returned no candles for that range. Try a wider or more recent range.',
          502,
          'market-data',
        )
      }

      const report = runBacktest(candles, params)
      const summary = buildRunSummary(randomUUID(), report)
      const stored: StoredBacktestRun = { summary, report }
      store.insertBacktestRun(stored)
      return stored
    },

    list(limit = 20): BacktestRunSummary[] {
      return store.listBacktestRuns(limit)
    },

    get(id: string): StoredBacktestRun {
      const stored = store.getBacktestRun(id)
      if (!stored) {
        throw new BacktestError('Backtest run not found.', 404, 'not-found')
      }
      return stored
    },
  }
}
