import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Card, CardBody, CardFoot, CardHead } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button, Segmented } from '../components/ui/Controls'
import { EmptyState, Notice } from '../components/ui/Feedback'
import { Icon } from '../components/ui/Icon'
import { FeedStatusBadge } from '../market/FeedStatusBadge'
import { useMarketFeed } from '../market/MarketDataProvider'
import { useKlines } from '../hooks/useKlines'
import { marketBySymbol } from '../lib/binance'
import { analyzeCandles } from '../lib/indicators'
import { formatClock, formatPercent, formatPrice, percentChange } from '../lib/format'
import {
  buildRuleBasedExplanation,
  postCoach,
  SUGGESTED_QUESTIONS,
  type CoachContextSummary,
  type CoachRequest,
} from '../lib/coach'
import {
  clearConversation,
  historyFromMessages,
  loadConversation,
  saveConversation,
  type StoredMessage,
  type StoredPreferences,
} from '../lib/coachHistory'
import { CoachComposer, type ComposerVoice } from '../components/coach/CoachComposer'
import { CoachReplyCard } from '../components/coach/CoachReplyCard'
import { SuggestedQuestions } from '../components/coach/SuggestedQuestions'
import { TrendPill } from '../components/markets/TrendPill'
import { useVoice } from '../voice/useVoice'
import { buildSpokenReply } from '../lib/voice'

const CANDLE_LIMIT = 300
const MIN_CANDLES = 30

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; geminiConfigured: boolean; model: string | null }
  | { status: 'error'; message: string }

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Request cancelled.'
    if (error.name === 'TimeoutError') return 'The coach request timed out.'
    return error.message
  }
  return 'The coach could not be reached.'
}

export function CoachPage() {
  const [initial] = useState(loadConversation)
  const [messages, setMessages] = useState<StoredMessage[]>(initial.messages)
  const [preferences, setPreferences] = useState<StoredPreferences>(initial.preferences)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [health, setHealth] = useState<HealthState>({ status: 'loading' })
  const [requestError, setRequestError] = useState<string | null>(null)
  const voice = useVoice()

  const location = useLocation()
  const navigate = useNavigate()
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { symbol, interval } = preferences
  const market = marketBySymbol(symbol)
  const { tickers, connection, stale } = useMarketFeed()
  const feed = useKlines(symbol, interval, CANDLE_LIMIT)
  const ticker = tickers[symbol] ?? null
  const change24h = ticker ? percentChange(ticker.open, ticker.last) : null

  const analysis = useMemo(() => analyzeCandles(feed.candles), [feed.candles])

  /* ---- Persistence -------------------------------------------------- */
  useEffect(() => {
    saveConversation(messages, preferences)
  }, [messages, preferences])

  /* ---- Backend health (never exposes the key) ----------------------- */
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check failed (${response.status}).`)
        const data = (await response.json()) as {
          geminiConfigured?: boolean
          model?: string | null
        }
        setHealth({
          status: 'ready',
          geminiConfigured: data.geminiConfigured === true,
          model: data.model ?? null,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHealth({ status: 'error', message: toErrorMessage(error) })
      })

    return () => controller.abort()
  }, [])

  /* ---- Prefilled question from the dashboard ------------------------ */
  useEffect(() => {
    const state = location.state as { question?: unknown } | null
    if (state && typeof state.question === 'string' && state.question.trim().length > 0) {
      setInput(state.question.trim())
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  /* ---- Keep the newest turn in view --------------------------------- */
  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, pending])

  const localContext = (): CoachContextSummary => ({
    symbol,
    interval,
    lastPrice: analysis.lastClose,
    change24h,
    candleCount: analysis.candleCount,
    trend: analysis.trend.direction,
    trendScore: analysis.trend.score,
    trendMax: analysis.trend.maxScore,
    fetchedAt: Date.now(),
  })

  const appendAssistant = (message: Omit<StoredMessage, 'id' | 'role' | 'at'>) => {
    setMessages((previous) => [
      ...previous,
      { ...message, id: newId(), role: 'assistant', at: Date.now() },
    ])
  }

  const ask = async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (question.length === 0 || pending) return

    // Never listen while a request is in flight (avoids feedback loops).
    voice.stopListening()

    const history = historyFromMessages(messages)
    const request: CoachRequest = {
      question,
      symbol,
      interval,
      history,
      portfolio: null,
    }

    const userMessage: StoredMessage = {
      id: newId(),
      role: 'user',
      text: question,
      reply: null,
      provider: null,
      error: null,
      context: null,
      at: Date.now(),
    }

    setMessages((previous) => [...previous, userMessage])
    setInput('')
    setPending(true)
    setRequestError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await postCoach(request, controller.signal)
      appendAssistant({
        text: response.reply.summary,
        reply: response.reply,
        provider: response.provider,
        error: response.error,
        context: response.context,
      })
      if (voice.autoSpeak) voice.speak(buildSpokenReply(response.reply))
    } catch (error) {
      if (controller.signal.aborted) return
      const message = toErrorMessage(error)
      setRequestError(message)

      // The backend is unreachable or rejected the call: still give a
      // verified explanation from the candles already on the page.
      if (analysis.candleCount >= MIN_CANDLES) {
        const context = localContext()
        const reply = buildRuleBasedExplanation({ context, analysis })
        appendAssistant({
          text: reply.summary,
          reply,
          provider: 'rule-based',
          error: `Coach API unavailable: ${message} Showing a local rule-based explanation built from the live Binance candles on this page.`,
          context,
        })
        if (voice.autoSpeak) voice.speak(buildSpokenReply(reply))
      } else {
        appendAssistant({
          text: message,
          reply: null,
          provider: null,
          error: message,
          context: null,
        })
      }
    } finally {
      setPending(false)
      abortRef.current = null
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPending(false)
  }

  const clearChat = () => {
    if (pending) return
    if (!window.confirm('Clear the saved coach conversation? This cannot be undone.')) return
    setMessages([])
    setRequestError(null)
    clearConversation()
  }

  const providerBadge =
    health.status === 'ready' && health.geminiConfigured ? (
      <Badge tone="ai">
        <span className="dot dot--pulse" />
        Gemini live
      </Badge>
    ) : health.status === 'ready' ? (
      <Badge tone="warn">Rule-based mode</Badge>
    ) : health.status === 'error' ? (
      <Badge tone="neg">API offline</Badge>
    ) : (
      <Badge tone="neutral" pulse>
        Checking
      </Badge>
    )

  const canFallbackLocally = analysis.candleCount >= MIN_CANDLES

  const composerVoice: ComposerVoice = {
    listening: voice.listening,
    interim: voice.interim,
    error: voice.error,
    autoSpeak: voice.autoSpeak,
    speaking: voice.speaking,
    speechSupported: voice.support.speechRecognition,
    synthesisSupported: voice.support.speechSynthesis,
    fallbackHint: voice.fallbackHint,
    onToggleMic: () =>
      voice.toggleListening((text) =>
        setInput((previous) =>
          previous.trim().length > 0 ? `${previous.trim()} ${text}` : text,
        ),
      ),
    onToggleAutoSpeak: voice.toggleAutoSpeak,
    onStopSpeaking: voice.stopSpeaking,
  }

  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">Intelligence · AI Coach</div>
          <h1 style={{ marginTop: 4 }}>AI Coach</h1>
          <p>
            Ask about the live market in plain language. Answers are built from verified
            Binance candles and indicator results — never from guesses.
          </p>
        </div>
        <div className="coach-head-status">
          {providerBadge}
          <FeedStatusBadge connection={connection} stale={stale} />
        </div>
      </div>

      <Notice tone="ai" icon="shield">
        Educational analysis for paper trading. The coach cannot see your exchange account,
        cannot place trades, does not promise outcomes, and its confidence is not a win
        probability.
      </Notice>

      <div className="coach-layout">
        <Card className="coach-chat animate-in">
          <CardHead
            title={
              <span className="coach-chat__title">
                Coach session
                <span className="dim">
                  {market?.base ?? symbol}/USDT · {interval}
                </span>
              </span>
            }
            badge={providerBadge}
            actions={
              <>
                <Segmented
                  ariaLabel="Coach symbol"
                  value={symbol}
                  onChange={(next) =>
                    setPreferences((previous) => ({ ...previous, symbol: next }))
                  }
                  options={[
                    { value: 'BTCUSDT', label: 'BTC' },
                    { value: 'ETHUSDT', label: 'ETH' },
                    { value: 'SOLUSDT', label: 'SOL' },
                  ]}
                />
                <Segmented
                  ariaLabel="Coach timeframe"
                  value={interval}
                  onChange={(next) =>
                    setPreferences((previous) => ({ ...previous, interval: next }))
                  }
                  options={[
                    { value: '15m', label: '15m' },
                    { value: '1h', label: '1h' },
                  ]}
                />
                <Button
                  size="sm"
                  icon={<Icon name="trash" size={14} />}
                  onClick={clearChat}
                >
                  Clear
                </Button>
              </>
            }
          />

          <CardBody className="coach-chat__body">
            <div className="coach-log" ref={logRef} aria-live="polite">
              {messages.length === 0 ? (
                <div className="coach-empty">
                  <span className="ai-orb">
                    <Icon name="spark" size={20} />
                  </span>
                  <EmptyState
                    icon="spark"
                    title="Start with a question"
                    description="The coach refetches fresh Binance data on every question, runs the indicator engine, then explains what it sees — including reasons not to trade."
                  />
                  <SuggestedQuestions
                    questions={SUGGESTED_QUESTIONS}
                    onPick={(question) => setInput(question)}
                    disabled={pending}
                  />
                </div>
              ) : (
                messages.map((message) =>
                  message.role === 'user' ? (
                    <div className="coach-turn coach-turn--user" key={message.id}>
                      <div className="coach-bubble">
                        <p>{message.text}</p>
                        <span className="coach-bubble__time">{formatClock(message.at)}</span>
                      </div>
                    </div>
                  ) : message.reply ? (
                    <div className="coach-turn" key={message.id}>
                      <CoachReplyCard
                        reply={message.reply}
                        provider={message.provider}
                        context={message.context}
                        error={message.error}
                        at={message.at}
                      />
                    </div>
                  ) : (
                    <div className="coach-turn" key={message.id}>
                      <div className="coach-error-card" role="alert">
                        <Icon name="alert" size={15} />
                        <div>
                          <strong>No answer was produced</strong>
                          <p>{message.error ?? message.text}</p>
                        </div>
                      </div>
                    </div>
                  ),
                )
              )}

              {pending ? (
                <div className="coach-turn">
                  <div className="coach-typing" role="status" aria-label="Coach is thinking">
                    <span className="ai-orb ai-orb--sm">
                      <Icon name="spark" size={15} />
                    </span>
                    <span className="coach-typing__dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    Fetching verified candles and indicators…
                  </div>
                </div>
              ) : null}
            </div>

            {requestError ? (
              <div className="coach-inline-error" role="alert">
                <Icon name="alert" size={14} />
                <span>{requestError}</span>
                <button type="button" className="coach-link" onClick={() => setRequestError(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}

            <CoachComposer
              value={input}
              onChange={setInput}
              onSubmit={() => void ask(input)}
              pending={pending}
              voice={composerVoice}
            />

            {pending ? (
              <div className="coach-cancel">
                <button type="button" className="coach-link" onClick={cancel}>
                  Cancel request
                </button>
              </div>
            ) : null}
          </CardBody>

          <CardFoot>
            {health.status === 'ready' && health.geminiConfigured ? (
              <>
                Gemini ({health.model ?? 'configured model'}) explains backend-verified data.
                If Gemini fails, the server returns a rule-based explanation instead.
              </>
            ) : health.status === 'ready' ? (
              <>
                Gemini is not configured on the server — every answer is a deterministic
                rule-based explanation.
              </>
            ) : health.status === 'error' ? (
              <>
                Backend not reachable at <span className="mono">/api/health</span>. Run{' '}
                <span className="mono">npm run dev</span> to start the API server. Recent
                saved messages still work; live answers use a local rule-based fallback when
                candles are available.
              </>
            ) : (
              <>Checking the coach backend…</>
            )}
            <span className="coach-saved-note">
              Chat history is saved in this browser only.
            </span>
          </CardFoot>
        </Card>

        <aside className="coach-side">
          <Card>
            <CardHead title="Market context" badge={<Badge tone="neutral">Live</Badge>} />
            <CardBody>
              <div className="coach-price-row">
                <span className={`asset__mark ${market?.markClass ?? ''}`} aria-hidden="true">
                  {(market?.base ?? symbol).slice(0, 1)}
                </span>
                <div>
                  <div className="mono" style={{ fontWeight: 650 }}>
                    {market?.base ?? symbol}/USDT
                  </div>
                  <div className="dim" style={{ fontSize: 11.5 }}>
                    {market?.name ?? symbol} · {interval}
                  </div>
                </div>
                <TrendPill direction={analysis.trend.direction} />
              </div>

              <div className="analysis-price" style={{ fontSize: 22, marginTop: 12 }}>
                {ticker ? formatPrice(ticker.last) : formatPrice(analysis.lastClose)}
              </div>
              <div className={`mono ${change24h === null ? '' : change24h >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 12 }}>
                {change24h === null ? '24h change n/a' : formatPercent(change24h)}
              </div>

              <dl className="coach-context coach-context--stacked">
                <div>
                  <dt>Candles loaded</dt>
                  <dd className="mono">{analysis.candleCount}</dd>
                </div>
                <div>
                  <dt>Trend checks</dt>
                  <dd className="mono">
                    {analysis.trend.maxScore > 0
                      ? `${analysis.trend.score}/${analysis.trend.maxScore}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>RSI 14</dt>
                  <dd className="mono">
                    {analysis.indicators.rsi14 !== null
                      ? analysis.indicators.rsi14.toFixed(1)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Last update</dt>
                  <dd className="mono">{formatClock(feed.lastUpdated)}</dd>
                </div>
              </dl>

              {feed.status === 'error' ? (
                <Notice icon="alert">
                  {feed.error ?? 'Candles unavailable.'} The coach still refetches on the
                  server when you ask.
                </Notice>
              ) : analysis.insufficient.length > 0 ? (
                <p className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>
                  {analysis.insufficient.length} indicator(s) waiting on history.
                </p>
              ) : null}
            </CardBody>
            <CardFoot>
              <button type="button" className="coach-link" onClick={feed.refresh}>
                <Icon name="refresh" size={12} /> Refresh candles
              </button>
            </CardFoot>
          </Card>

          <Card>
            <CardHead title="What it can explain" />
            <CardBody>
              <ul className="coach-topics">
                {[
                  'Current market conditions',
                  'Bullish, bearish or neutral trends',
                  'What each indicator means',
                  'Possible opportunities',
                  'Trading risks and volatility',
                  'Reasons to avoid trading',
                  'Candlestick pattern education',
                  'Support and resistance context',
                ].map((topic) => (
                  <li key={topic}>
                    <Icon name="check" size={12} />
                    {topic}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Portfolio awareness" badge={<Badge tone="neutral">Off</Badge>} />
            <CardBody>
              <p className="coach-side-note">
                No exchange account is connected in this phase. The coach is explicitly
                instructed not to invent balances, positions or profit/loss. When a
                read-only portfolio exists, its verified values can be included in the same
                request.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Suggested next questions" />
            <CardBody>
              <SuggestedQuestions
                questions={SUGGESTED_QUESTIONS.slice(0, 4)}
                onPick={(question) => setInput(question)}
                disabled={pending}
              />
            </CardBody>
          </Card>

          {health.status === 'ready' && !health.geminiConfigured ? (
            <Notice icon="info">
              {canFallbackLocally
                ? 'Gemini is not configured. Answers use the deterministic rule engine from verified candles.'
                : 'Gemini is not configured and not enough candles are loaded yet.'}
            </Notice>
          ) : null}
        </aside>
      </div>
    </>
  )
}
