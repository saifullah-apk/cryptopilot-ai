/**
 * CryptoPilot AI backend.
 *
 * Responsibilities:
 *   POST /api/coach   — verified market context + Gemini explanation
 *   GET  /api/health  — readiness probe (never exposes the key)
 *   static            — serve the built Vite app with SPA fallback
 *
 * The Gemini API key lives only in this process. It is read from the
 * environment, sent as a request header, and never logged or returned.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, chmodSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCoachRequest } from '../src/lib/coach.ts'
import { validateBacktestRequest } from '../src/lib/backtest.ts'
import {
  validateApproveRequest,
  validateGenerateSignalRequest,
  validatePauseRequest,
} from '../src/lib/paperTrading.ts'
import {
  buildVerifiedContext,
  generateCoachReply,
  MarketDataError,
  summarizeContext,
} from './coachService.ts'
import { getDefaultStore, resolveDatabasePath } from './paperStore.ts'
import { createPaperService, MarketPriceError, PaperError } from './paperService.ts'
import { generateSignal } from './signalService.ts'
import { createBacktestService, BacktestError } from './backtestService.ts'
import { getDefaultPortfolioService } from './portfolioService.ts'
import { PortfolioError } from './binanceReadOnly.ts'

/**
 * Load `../.env` when present so the bundled `dist-server/server.mjs` also
 * works on hosts that launch Node without `--env-file`. Variables already in
 * the environment always win, so `npm start`, shell exports, and process
 * managers behave exactly as before. A missing file is not an error.
 */
function loadEnvFile(): void {
  try {
    const envPath = fileURLToPath(new URL('../.env', import.meta.url))
    if (!existsSync(envPath)) return
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value
    }
  } catch {
    // A missing or unreadable .env must never block startup.
  }
}
loadEnvFile()

const PORT = Number(process.env.PORT ?? 8787)
/** Local-only by default. Set HOST=0.0.0.0 deliberately to expose on a LAN. */
const HOST = process.env.HOST?.trim() || 'localhost'
/**
 * LiteSpeed/OpenLiteSpeed appserver contexts may hand the app a unix socket
 * instead of a TCP port. TCP wins when PORT is set; otherwise a socket
 * provided by the app server is used; otherwise PORT above applies.
 */
const SOCKET_PATH = process.env.LSAPI_SOCKET?.trim() || process.env.SOCKET_PATH?.trim() || ''
/** Only trust X-Forwarded-For when every request passes through a known proxy. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || undefined
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash'

/** Sent with every response; CSP is added to HTML documents only. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://data-api.binance.vision https://api.binance.com https://api1.binance.com wss://data-stream.binance.vision wss://stream.binance.com:9443",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const MAX_BODY_BYTES = 32 * 1024
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
/** Signal generation is heavier (candles + AI), so it gets its own budget. */
const SIGNAL_RATE_LIMIT = 10

const DIST_DIR = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

/* ------------------------------------------------------------------ */
/* Paper trading (virtual only — no exchange orders, no real money)   */
/* ------------------------------------------------------------------ */

const store = getDefaultStore()
const paperService = createPaperService({ store })
const backtestService = createBacktestService({ store })
const portfolioService = getDefaultPortfolioService()

const signalHits = new Map<string, number[]>()
/** Backtests fetch a lot of history, so they get a small budget. */
const backtestHits = new Map<string, number[]>()
const BACKTEST_RATE_LIMIT = 4
/** Portfolio calls hit Binance with credentials, so keep them deliberately rare. */
const portfolioHits = new Map<string, number[]>()
const PORTFOLIO_RATE_LIMIT = 10

function limitedBy(
  bucket: Map<string, number[]>,
  limit: number,
  ip: string,
): boolean {
  const now = Date.now()
  const recent = (bucket.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS)
  recent.push(now)
  bucket.set(ip, recent)
  if (bucket.size > 5_000) {
    for (const [key, times] of bucket) {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) bucket.delete(key)
    }
  }
  return recent.length > limit
}

function signalRateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (signalHits.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS)
  recent.push(now)
  signalHits.set(ip, recent)
  if (signalHits.size > 5_000) {
    for (const [key, times] of signalHits) {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) signalHits.delete(key)
    }
  }
  return recent.length > SIGNAL_RATE_LIMIT
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function clientIp(request: IncomingMessage): string {
  // A forwarder can only be trusted when explicitly configured. Otherwise a
  // client could spoof X-Forwarded-For and bypass every rate limit.
  if (TRUST_PROXY) {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim()
    }
  }
  return request.socket.remoteAddress ?? 'unknown'
}

/** Mutating API routes accept JSON only, which blocks simple cross-site posts. */
function hasJsonContentType(request: IncomingMessage): boolean {
  const header = request.headers['content-type']
  if (typeof header !== 'string') return false
  return header.split(';')[0]!.trim().toLowerCase() === 'application/json'
}

/* ------------------------------------------------------------------ */
/* Rate limiting (in-memory, per IP)                                  */
/* ------------------------------------------------------------------ */

const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)

  // Keep the map from growing forever under many distinct IPs.
  if (hits.size > 5_000) {
    for (const [key, times] of hits) {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) hits.delete(key)
    }
  }

  return recent.length > RATE_LIMIT
}

/* ------------------------------------------------------------------ */
/* Body reading                                                       */
/* ------------------------------------------------------------------ */

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false

    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        reject(new BodyTooLargeError(`Request body exceeds ${MAX_BODY_BYTES} bytes.`))
        // Keep draining so the 413 response can still be written.
        request.resume()
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => {
      if (!tooLarge) resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', (error) => {
      if (!tooLarge) reject(error)
    })
  })
}

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */

async function handleCoach(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (rateLimited(clientIp(request))) {
    sendJson(response, 429, {
      ok: false,
      error: `Too many coach requests. Limit is ${RATE_LIMIT} per minute.`,
    })
    return
  }

  let raw: string
  try {
    raw = await readBody(request)
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError
    sendJson(response, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? (error as Error).message : 'Unable to read request body.',
    })
    return
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(raw)
  } catch {
    sendJson(response, 400, { ok: false, error: 'Request body must be valid JSON.' })
    return
  }

  const validation = validateCoachRequest(parsedBody)
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error })
    return
  }

  const coachRequest = validation.value

  try {
    const context = await buildVerifiedContext(coachRequest.symbol, coachRequest.interval)
    const generation = await generateCoachReply({
      request: coachRequest,
      context,
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    })

    sendJson(response, 200, {
      ok: true,
      provider: generation.provider,
      model: generation.model,
      reply: generation.reply,
      error: generation.error,
      context: summarizeContext(context),
    })
  } catch (error) {
    if (error instanceof MarketDataError) {
      sendJson(response, 502, {
        ok: false,
        error: `${error.message} Try again in a moment.`,
      })
      return
    }

    console.error('[coach] unexpected error:', (error as Error).message)
    sendJson(response, 500, {
      ok: false,
      error: 'The coach hit an unexpected error. Please try again.',
    })
  }
}

/* ------------------------------------------------------------------ */
/* Paper trading routes (virtual only)                                */
/* ------------------------------------------------------------------ */

type JsonBodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string }

async function readJsonBody(request: IncomingMessage): Promise<JsonBodyResult> {
  let raw: string
  try {
    raw = await readBody(request)
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError
    return {
      ok: false,
      status: tooLarge ? 413 : 400,
      error: tooLarge ? (error as Error).message : 'Unable to read request body.',
    }
  }

  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, status: 400, error: 'Request body must be valid JSON.' }
  }
}

/** Maps service errors to the project's JSON error convention. */
function sendPaperError(response: ServerResponse, error: unknown): void {
  if (error instanceof PaperError) {
    sendJson(response, error.status, { ok: false, error: error.message, code: error.code })
    return
  }
  if (error instanceof BacktestError || error instanceof PortfolioError) {
    sendJson(response, error.status, { ok: false, error: error.message, code: error.code })
    return
  }
  if (error instanceof MarketPriceError || error instanceof MarketDataError) {
    sendJson(response, 502, { ok: false, error: `${error.message} Try again in a moment.` })
    return
  }
  console.error('[paper] unexpected error:', (error as Error).message)
  sendJson(response, 500, {
    ok: false,
    error: 'The paper-trading engine hit an unexpected error. Please try again.',
  })
}

/** Extracts `:id` (and an optional action suffix) from `/prefix/:id/action`. */
function parseIdAction(pathname: string, prefix: string): { id: string; action: string | null } | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  if (rest.length === 0) return null
  const segments = rest.split('/')
  if (segments.length === 1) {
    return segments[0].length > 0 ? { id: segments[0], action: null } : null
  }
  if (segments.length === 2 && segments[0].length > 0 && segments[1].length > 0) {
    return { id: segments[0], action: segments[1] }
  }
  return null
}

async function handlePaperState(response: ServerResponse): Promise<void> {
  try {
    const state = await paperService.getState()
    sendJson(response, 200, { ok: true, state })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handleGenerateSignal(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (signalRateLimited(clientIp(request))) {
    sendJson(response, 429, {
      ok: false,
      error: `Too many signal requests. Limit is ${SIGNAL_RATE_LIMIT} per minute.`,
    })
    return
  }

  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }

  const validation = validateGenerateSignalRequest(body.value)
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error })
    return
  }

  try {
    const result = await generateSignal(
      { store, apiKey: GEMINI_API_KEY, model: GEMINI_MODEL },
      validation.value.symbol,
      validation.value.interval,
    )
    sendJson(response, 201, {
      ok: true,
      signal: result.signal,
      provider: result.provider,
      error: result.error,
    })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handleApprove(
  request: IncomingMessage,
  response: ServerResponse,
  signalId: string,
): Promise<void> {
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }

  const validation = validateApproveRequest(body.value)
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error })
    return
  }

  try {
    const result = await paperService.approve(signalId, validation.value.riskPct)
    sendJson(response, 200, {
      ok: true,
      signal: result.signal,
      position: result.position,
      state: result.state,
    })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handleReject(
  request: IncomingMessage,
  response: ServerResponse,
  signalId: string,
): Promise<void> {
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }

  let note: string | null = null
  if (body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
    const raw = (body.value as Record<string, unknown>).note
    if (typeof raw === 'string' && raw.trim().length > 0) note = raw.trim().slice(0, 300)
  }

  try {
    const state = await paperService.reject(signalId, note)
    sendJson(response, 200, { ok: true, state })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handleClosePosition(
  request: IncomingMessage,
  response: ServerResponse,
  positionId: string,
): Promise<void> {
  // Body is optional here; drain it so the socket stays in sync.
  await readJsonBody(request)
  try {
    const state = await paperService.closePosition(positionId)
    sendJson(response, 200, { ok: true, state })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handlePause(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }

  const validation = validatePauseRequest(body.value)
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error })
    return
  }

  try {
    const state = await paperService.setPaused(validation.value.paused)
    sendJson(response, 200, { ok: true, state })
  } catch (error) {
    sendPaperError(response, error)
  }
}

/* ------------------------------------------------------------------ */
/* Portfolio (read-only Binance) and backtest routes                    */
/* ------------------------------------------------------------------ */

function handlePortfolioStatus(response: ServerResponse): void {
  try {
    sendJson(response, 200, { ok: true, status: portfolioService.getStatus() })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handlePortfolioAction(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (limitedBy(portfolioHits, PORTFOLIO_RATE_LIMIT, clientIp(request))) {
    sendJson(response, 429, {
      ok: false,
      error: `Too many portfolio requests. Limit is ${PORTFOLIO_RATE_LIMIT} per minute.`,
      code: 'rate-limited',
    })
    return
  }

  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }
  if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
    sendJson(response, 400, { ok: false, error: 'Body must be an object.' })
    return
  }

  const action = (body.value as Record<string, unknown>).action

  try {
    if (action === 'connect') {
      const apiKey = (body.value as Record<string, unknown>).apiKey
      const secret = (body.value as Record<string, unknown>).secret
      if (typeof apiKey !== 'string' || typeof secret !== 'string') {
        sendJson(response, 400, {
          ok: false,
          error: 'apiKey and secret must be strings.',
          code: 'missing-credentials',
        })
        return
      }
      const status = await portfolioService.connect(apiKey, secret)
      sendJson(response, 200, { ok: true, status })
      return
    }

    if (action === 'refresh') {
      const status = await portfolioService.refresh()
      sendJson(response, 200, { ok: true, status })
      return
    }

    if (action === 'disconnect') {
      const status = portfolioService.disconnect()
      sendJson(response, 200, { ok: true, status })
      return
    }

    sendJson(response, 400, {
      ok: false,
      error: 'action must be "connect", "refresh" or "disconnect".',
    })
  } catch (error) {
    sendPaperError(response, error)
  }
}

async function handleBacktestRun(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (limitedBy(backtestHits, BACKTEST_RATE_LIMIT, clientIp(request))) {
    sendJson(response, 429, {
      ok: false,
      error: `Too many backtest requests. Limit is ${BACKTEST_RATE_LIMIT} per minute.`,
      code: 'rate-limited',
    })
    return
  }

  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error })
    return
  }

  const validation = validateBacktestRequest(body.value)
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error })
    return
  }

  try {
    const run = await backtestService.run(validation.value)
    sendJson(response, 201, { ok: true, run })
  } catch (error) {
    sendPaperError(response, error)
  }
}

function handleBacktestList(response: ServerResponse): void {
  try {
    sendJson(response, 200, { ok: true, runs: backtestService.list(20) })
  } catch (error) {
    sendPaperError(response, error)
  }
}

function handleBacktestGet(response: ServerResponse, id: string): void {
  try {
    const run = backtestService.get(id)
    sendJson(response, 200, { ok: true, run })
  } catch (error) {
    sendPaperError(response, error)
  }
}

/* ------------------------------------------------------------------ */
/* Static files                                                       */
/* ------------------------------------------------------------------ */

async function serveStatic(
  pathname: string,
  response: ServerResponse,
  headOnly = false,
): Promise<void> {
  // Resolve inside DIST_DIR only — block traversal and absolute paths.
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Malformed path.')
    return
  }
  const candidate = normalize(join(DIST_DIR, decoded))
  const inside = candidate === DIST_DIR || candidate.startsWith(DIST_DIR + sep)

  let filePath = inside ? candidate : join(DIST_DIR, 'index.html')

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    // Unknown path: let the SPA router handle it.
    filePath = join(DIST_DIR, 'index.html')
  }

  let content: Buffer
  try {
    content = await readFile(filePath)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found. Run "npm run build" to generate the app bundle.')
    return
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const isHtml = type.startsWith('text/html')
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': content.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
    ...(isHtml ? { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } : {}),
  })
  if (headOnly) {
    response.end()
    return
  }
  response.end(content)
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value)
  }

  // Every mutating API route expects a JSON body. Requiring the JSON content
  // type means a cross-site form (a "simple" request) cannot reach these
  // endpoints without a CORS preflight, which this server never approves.
  if (
    request.method === 'POST' &&
    url.pathname.startsWith('/api/') &&
    !hasJsonContentType(request)
  ) {
    sendJson(response, 415, {
      ok: false,
      error: 'Content-Type must be application/json.',
    })
    return
  }

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'Use GET.' })
      return
    }
    sendJson(response, 200, {
      ok: true,
      service: 'cryptopilot-coach',
      geminiConfigured: Boolean(GEMINI_API_KEY),
      model: GEMINI_API_KEY ? GEMINI_MODEL : null,
    })
    return
  }

  if (url.pathname === '/api/coach') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    void handleCoach(request, response)
    return
  }

  if (url.pathname === '/api/portfolio/binance') {
    if (request.method === 'GET') {
      handlePortfolioStatus(response)
      return
    }
    if (request.method === 'POST') {
      void handlePortfolioAction(request, response)
      return
    }
    sendJson(response, 405, { ok: false, error: 'Use GET or POST.' })
    return
  }

  if (url.pathname === '/api/backtest') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    void handleBacktestRun(request, response)
    return
  }

  if (url.pathname === '/api/backtest/runs') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'Use GET.' })
      return
    }
    handleBacktestList(response)
    return
  }

  const backtestRoute = parseIdAction(url.pathname, '/api/backtest/runs/')
  if (backtestRoute !== null) {
    if (backtestRoute.action !== null) {
      sendJson(response, 404, { ok: false, error: 'Unknown API route.' })
      return
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'Use GET.' })
      return
    }
    handleBacktestGet(response, backtestRoute.id)
    return
  }

  if (url.pathname === '/api/paper/state') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'Use GET.' })
      return
    }
    void handlePaperState(response)
    return
  }

  if (url.pathname === '/api/paper/signals') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    void handleGenerateSignal(request, response)
    return
  }

  const signalRoute = parseIdAction(url.pathname, '/api/paper/signals/')
  if (signalRoute !== null && signalRoute.action !== null) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    if (signalRoute.action === 'approve') {
      void handleApprove(request, response, signalRoute.id)
      return
    }
    if (signalRoute.action === 'reject') {
      void handleReject(request, response, signalRoute.id)
      return
    }
    sendJson(response, 404, { ok: false, error: 'Unknown API route.' })
    return
  }

  const positionRoute = parseIdAction(url.pathname, '/api/paper/positions/')
  if (positionRoute !== null && positionRoute.action === 'close') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    void handleClosePosition(request, response, positionRoute.id)
    return
  }

  if (url.pathname === '/api/paper/pause') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'Use POST.' })
      return
    }
    void handlePause(request, response)
    return
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { ok: false, error: 'Unknown API route.' })
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Method not allowed.')
    return
  }

  void serveStatic(url.pathname, response, request.method === 'HEAD')
})

if (SOCKET_PATH) {
  server.listen(SOCKET_PATH, () => {
    try {
      chmodSync(SOCKET_PATH, 0o777)
    } catch {
      // Best effort: the app server may already run as the same user.
    }
    console.log(`CryptoPilot server listening on unix socket ${SOCKET_PATH}`)
    finishStartup()
  })
} else {
  server.listen(PORT, HOST, () => {
    console.log(`CryptoPilot server listening on http://${HOST}:${PORT}`)
    finishStartup()
  })
}

function finishStartup(): void {
  console.log(`Paper database: SQLite at ${resolveDatabasePath()}`)
  if (HOST !== 'localhost' && HOST !== '127.0.0.1' && HOST !== '::1') {
    console.warn(
      `[security] Bound to ${HOST}. This app has no user authentication — expose it only on a trusted network.`,
    )
  }
  console.log(
    GEMINI_API_KEY
      ? `Gemini enabled (model: ${GEMINI_MODEL})`
      : 'Gemini key not set — coach will use the rule-based fallback.',
  )
}
