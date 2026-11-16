/**
 * Read-only portfolio service.
 *
 * Holds Binance credentials in memory for the lifetime of this server
 * process. There is no database table, no file and no log entry for them.
 * Restarting the server disconnects the account.
 */

import type { BinancePortfolioStatus, RealAccountSnapshot } from '../src/lib/portfolio.ts'
import {
  fetchAccountSnapshot,
  PortfolioError,
  type Credentials,
  type SnapshotDeps,
} from './binanceReadOnly.ts'

export type PortfolioServiceDeps = SnapshotDeps

export type PortfolioService = {
  getStatus(): BinancePortfolioStatus
  connect(apiKey: string, secret: string): Promise<BinancePortfolioStatus>
  refresh(): Promise<BinancePortfolioStatus>
  disconnect(): BinancePortfolioStatus
}

type Session = {
  credentials: Credentials
  connectedAt: number
  snapshot: RealAccountSnapshot
}

const MAX_CREDENTIAL_LENGTH = 200

function resultSnapshot(snapshot: RealAccountSnapshot): RealAccountSnapshot {
  return snapshot
}

export function createPortfolioService(deps: PortfolioServiceDeps = {}): PortfolioService {
  let session: Session | null = null

  function status(): BinancePortfolioStatus {
    if (!session) {
      return {
        configured: true,
        connected: false,
        readOnly: true,
        connectedAt: null,
        keyHint: null,
        snapshot: null,
        message:
          'No Binance account connected. Add a read-only API key below to view balances. Keys stay in server memory and are never stored.',
      }
    }

    const key = session.credentials.apiKey
    return {
      configured: true,
      connected: true,
      readOnly: true,
      connectedAt: session.connectedAt,
      keyHint: key.length <= 4 ? '••••' : `••••${key.slice(-4)}`,
      snapshot: resultSnapshot(session.snapshot),
      message:
        'Read-only Binance account connected. CryptoPilot only calls GET /api/v3/account — it cannot place orders, transfer or withdraw.',
    }
  }

  return {
    getStatus(): BinancePortfolioStatus {
      return status()
    },

    async connect(apiKey: string, secret: string): Promise<BinancePortfolioStatus> {
      const key = apiKey.trim()
      const privateKey = secret.trim()

      if (key.length === 0 || privateKey.length === 0) {
        throw new PortfolioError('Both the API key and secret are required.', 400, 'missing-credentials')
      }
      if (key.length > MAX_CREDENTIAL_LENGTH || privateKey.length > MAX_CREDENTIAL_LENGTH) {
        throw new PortfolioError('The API key or secret is unexpectedly long.', 400, 'bad-credentials')
      }

      const snapshot = await fetchAccountSnapshot({ apiKey: key, secret: privateKey }, deps)
      session = {
        credentials: { apiKey: key, secret: privateKey },
        connectedAt: Date.now(),
        snapshot,
      }
      return status()
    },

    async refresh(): Promise<BinancePortfolioStatus> {
      if (!session) {
        throw new PortfolioError(
          'Connect a read-only Binance account before refreshing.',
          409,
          'not-connected',
        )
      }
      const snapshot = await fetchAccountSnapshot(session.credentials, deps)
      session = { ...session, snapshot }
      return status()
    },

    disconnect(): BinancePortfolioStatus {
      session = null
      return status()
    },
  }
}

/** Process-wide session for the API server (memory only). */
let defaultPortfolioService: PortfolioService | null = null

export function getDefaultPortfolioService(): PortfolioService {
  if (!defaultPortfolioService) defaultPortfolioService = createPortfolioService()
  return defaultPortfolioService
}
