-- CryptoPilot AI — MySQL / MariaDB schema
--
-- Import this file to create the paper-trading tables in the configured
-- MySQL database:
--   npm run db:init:mysql
-- or with the mysql CLI:
--   mysql -h HOST -u USER -p DBNAME < schema/schema.mysql.sql
--
-- All statements are idempotent (IF NOT EXISTS), so importing against an
-- existing database never drops or overwrites data.
--
-- Paper trading only: no exchange account, credentials or withdrawal data
-- is stored here.

SET NAMES utf8mb4;

/* ------------------------------ virtual account ----------------------- */

CREATE TABLE IF NOT EXISTS paper_account (
  id TINYINT NOT NULL PRIMARY KEY,
  starting_balance DOUBLE NOT NULL,
  cash DOUBLE NOT NULL,
  paused TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT chk_paper_account_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------ signals ------------------------------- */

CREATE TABLE IF NOT EXISTS paper_signals (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  action VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL,
  market_price DOUBLE NOT NULL,
  technical_reasoning TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  ai_provider VARCHAR(20) NOT NULL,
  confidence DOUBLE NOT NULL,
  entry DOUBLE NOT NULL,
  stop_loss DOUBLE NOT NULL,
  take_profit DOUBLE NOT NULL,
  risk_reward DOUBLE NOT NULL,
  risk_warnings TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  decided_at BIGINT NULL,
  decision_note TEXT NULL,
  INDEX idx_signals_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------ positions ----------------------------- */

CREATE TABLE IF NOT EXISTS paper_positions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  signal_id VARCHAR(64) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  side VARCHAR(10) NOT NULL,
  quantity DOUBLE NOT NULL,
  entry_price DOUBLE NOT NULL,
  stop_loss DOUBLE NOT NULL,
  take_profit DOUBLE NOT NULL,
  fees DOUBLE NOT NULL,
  opened_at BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  exit_price DOUBLE NULL,
  exit_reason VARCHAR(20) NULL,
  closed_at BIGINT NULL,
  realized_pnl DOUBLE NULL,
  INDEX idx_positions_status (status, closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------ orders -------------------------------- */

CREATE TABLE IF NOT EXISTS paper_orders (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  signal_id VARCHAR(64) NOT NULL,
  position_id VARCHAR(64) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL,
  quantity DOUBLE NOT NULL,
  requested_price DOUBLE NOT NULL,
  fill_price DOUBLE NOT NULL,
  fee DOUBLE NOT NULL,
  slippage_cost DOUBLE NOT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------ backtests ----------------------------- */

CREATE TABLE IF NOT EXISTS backtest_runs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  initial_capital DOUBLE NOT NULL,
  risk_pct DOUBLE NOT NULL,
  min_confidence DOUBLE NOT NULL,
  trades INT NOT NULL,
  net_pnl DOUBLE NOT NULL,
  win_rate DOUBLE NULL,
  max_drawdown_pct DOUBLE NOT NULL,
  report LONGTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_backtest_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
