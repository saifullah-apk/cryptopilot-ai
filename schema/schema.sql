-- CryptoPilot AI — SQLite schema
--
-- Import this file to create the paper-trading tables:
--   npm run db:init
-- or with the SQLite CLI:
--   sqlite3 data/paper.db < schema/schema.sql
--
-- All statements are idempotent (IF NOT EXISTS), so importing against an
-- existing database never drops or overwrites data.
--
-- Paper trading only: no exchange account, credentials or withdrawal data
-- is stored here.

/* ------------------------------ virtual account ----------------------- */

CREATE TABLE IF NOT EXISTS paper_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  starting_balance REAL NOT NULL,
  cash REAL NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

/* ------------------------------ signals ------------------------------- */

CREATE TABLE IF NOT EXISTS paper_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  action TEXT NOT NULL,
  side TEXT NOT NULL,
  market_price REAL NOT NULL,
  technical_reasoning TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  confidence REAL NOT NULL,
  entry REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  risk_reward REAL NOT NULL,
  risk_warnings TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  decided_at INTEGER,
  decision_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_status ON paper_signals (status, expires_at);

/* ------------------------------ positions ----------------------------- */

CREATE TABLE IF NOT EXISTS paper_positions (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  fees REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  exit_price REAL,
  exit_reason TEXT,
  closed_at INTEGER,
  realized_pnl REAL
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON paper_positions (status, closed_at);

/* ------------------------------ orders -------------------------------- */

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  requested_price REAL NOT NULL,
  fill_price REAL NOT NULL,
  fee REAL NOT NULL,
  slippage_cost REAL NOT NULL,
  created_at INTEGER NOT NULL
);

/* ------------------------------ backtests ----------------------------- */

CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  initial_capital REAL NOT NULL,
  risk_pct REAL NOT NULL,
  min_confidence REAL NOT NULL,
  trades INTEGER NOT NULL,
  net_pnl REAL NOT NULL,
  win_rate REAL,
  max_drawdown_pct REAL NOT NULL,
  report TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_created ON backtest_runs (created_at DESC);
