/**
 * Voice assistant helpers — pure and unit tested.
 *
 * Browser speech APIs are feature-detected at runtime; every helper here
 * accepts an injected global object so tests can supply fakes. Nothing in
 * this module touches the DOM directly.
 */

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type VoiceSupport = {
  /** Speech-to-text (Web Speech API SpeechRecognition). */
  speechRecognition: boolean
  /** Text-to-speech (speechSynthesis). */
  speechSynthesis: boolean
  /** Microphone capture permission API (getUserMedia). */
  microphone: boolean
}

/** Minimal structural shape of the Web Speech API recognition object. */
export type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

export type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

export type SpeechRecognitionErrorLike = {
  error: string
  message?: string
}

export type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike

export type VoiceGlobal = {
  SpeechRecognition?: SpeechRecognitionCtorLike
  webkitSpeechRecognition?: SpeechRecognitionCtorLike
  speechSynthesis?: unknown
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
}

/* ------------------------------------------------------------------ */
/* Capability detection                                               */
/* ------------------------------------------------------------------ */

function readGlobal(injected?: unknown): VoiceGlobal | undefined {
  if (injected && typeof injected === 'object') return injected as VoiceGlobal
  if (typeof globalThis !== 'undefined') return globalThis as VoiceGlobal
  return undefined
}

/** Resolves the recognition constructor, preferring the standard name. */
export function getSpeechRecognitionCtor(
  injected?: unknown,
): SpeechRecognitionCtorLike | null {
  const glob = readGlobal(injected)
  if (!glob) return null
  const ctor = glob.SpeechRecognition ?? glob.webkitSpeechRecognition
  return typeof ctor === 'function' ? ctor : null
}

/** Feature-detects speech-to-text, text-to-speech and microphone APIs. */
export function detectVoiceSupport(injected?: unknown): VoiceSupport {
  const glob = readGlobal(injected)
  return {
    speechRecognition: getSpeechRecognitionCtor(glob) !== null,
    speechSynthesis: Boolean(glob && typeof glob.speechSynthesis === 'object'),
    microphone: Boolean(
      glob?.navigator?.mediaDevices &&
        typeof glob.navigator.mediaDevices.getUserMedia === 'function',
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Maps SpeechRecognition error codes to actionable user-facing copy.
 * Returns `null` for `aborted` — that is an intentional stop, not a failure.
 */
export function recognitionErrorMessage(
  code: string | null | undefined,
): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow the microphone in your browser settings, then try again.'
    case 'audio-capture':
      return 'No microphone was found. Connect one and try again.'
    case 'no-speech':
      return 'I did not hear anything. Try speaking again.'
    case 'network':
      return 'The speech service could not be reached. Check your connection or type instead.'
    case 'language-not-supported':
      return 'Your browser does not support English speech recognition. Please type instead.'
    case 'aborted':
      return null
    default:
      return 'Voice input stopped unexpectedly. Please try again or type instead.'
  }
}

/** Maps getUserMedia / permission failures to user-facing copy. */
export function permissionErrorMessage(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : ''

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was denied. Allow microphone access for this site, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was detected on this device.'
    case 'NotReadableError':
      return 'Your microphone is busy in another app. Close it and try again.'
    default:
      return 'Voice input is unavailable right now. Please type your question instead.'
  }
}

/* ------------------------------------------------------------------ */
/* Transcripts                                                         */
/* ------------------------------------------------------------------ */

/** Collapses whitespace and trims a transcript; empty string when blank. */
export function normalizeTranscript(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim()
}

/** Final transcript plus the live interim fragment, normalized. */
export function mergeTranscripts(finalText: string, interimText: string): string {
  const finalPart = normalizeTranscript(finalText)
  const interimPart = normalizeTranscript(interimText)
  return normalizeTranscript(`${finalPart} ${interimPart}`)
}

/* ------------------------------------------------------------------ */
/* Spoken replies                                                      */
/* ------------------------------------------------------------------ */

export const SPOKEN_REPLY_MAX_LENGTH = 420

type ReplyLike = {
  summary?: string
  confidenceNote?: string
}

/**
 * Builds the text read aloud for an AI reply: the summary plus the
 * confidence note (so spoken output carries the same uncertainty caveat
 * as the screen). Whitespace-collapsed and length-capped for TTS.
 */
export function buildSpokenReply(
  reply: string | ReplyLike,
  maxLength: number = SPOKEN_REPLY_MAX_LENGTH,
): string {
  let text: string
  if (typeof reply === 'string') {
    text = normalizeTranscript(reply)
  } else {
    const summary = normalizeTranscript(reply.summary)
    const note = normalizeTranscript(reply.confidenceNote)
    text = note.length > 0 ? `${summary} ${note}` : summary
  }

  if (text.length <= maxLength) return text
  const clipped = text.slice(0, Math.max(0, maxLength - 1)).trimEnd()
  return `${clipped}…`
}
