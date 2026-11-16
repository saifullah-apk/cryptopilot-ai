import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSpokenReply,
  detectVoiceSupport,
  getSpeechRecognitionCtor,
  mergeTranscripts,
  normalizeTranscript,
  permissionErrorMessage,
  recognitionErrorMessage,
} from '../src/lib/voice.ts'

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: unknown = null
  onerror: unknown = null
  onend: unknown = null
  onstart: unknown = null
  started = false

  start(): void {
    this.started = true
  }

  stop(): void {
    this.started = false
  }
}

class FakeWebkitRecognition extends FakeRecognition {}

/* ------------------------------------------------------------------ */
/* Capability detection                                                */
/* ------------------------------------------------------------------ */

test('detectVoiceSupport: everything present', () => {
  const support = detectVoiceSupport({
    SpeechRecognition: FakeRecognition,
    speechSynthesis: {},
    navigator: { mediaDevices: { getUserMedia: () => undefined } },
  })
  assert.equal(support.speechRecognition, true)
  assert.equal(support.speechSynthesis, true)
  assert.equal(support.microphone, true)
})

test('detectVoiceSupport: webkit prefix only', () => {
  const support = detectVoiceSupport({
    webkitSpeechRecognition: FakeWebkitRecognition,
  })
  assert.equal(support.speechRecognition, true)
  assert.equal(support.speechSynthesis, false)
  assert.equal(support.microphone, false)
})

test('detectVoiceSupport: empty global → all false', () => {
  const support = detectVoiceSupport({})
  assert.deepEqual(support, {
    speechRecognition: false,
    speechSynthesis: false,
    microphone: false,
  })
})

test('detectVoiceSupport: non-function recognition ctor is ignored', () => {
  const support = detectVoiceSupport({ SpeechRecognition: 'nope' })
  assert.equal(support.speechRecognition, false)
})

test('getSpeechRecognitionCtor: prefers the standard name', () => {
  const ctor = getSpeechRecognitionCtor({
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: FakeWebkitRecognition,
  })
  assert.equal(ctor, FakeRecognition)
})

test('getSpeechRecognitionCtor: falls back to webkit', () => {
  const ctor = getSpeechRecognitionCtor({
    webkitSpeechRecognition: FakeWebkitRecognition,
  })
  assert.equal(ctor, FakeWebkitRecognition)
})

test('getSpeechRecognitionCtor: returns null when absent (Node global)', () => {
  assert.equal(getSpeechRecognitionCtor({}), null)
  // No injected object reads globalThis, which has no recognition in Node.
  assert.equal(getSpeechRecognitionCtor(), null)
})

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

test('recognitionErrorMessage: maps every browser error code', () => {
  const notAllowed = recognitionErrorMessage('not-allowed')
  assert.match(String(notAllowed), /Microphone access was blocked/)

  const service = recognitionErrorMessage('service-not-allowed')
  assert.match(String(service), /Microphone access was blocked/)

  const noMic = recognitionErrorMessage('audio-capture')
  assert.match(String(noMic), /No microphone was found/)

  const noSpeech = recognitionErrorMessage('no-speech')
  assert.match(String(noSpeech), /did not hear anything/)

  const network = recognitionErrorMessage('network')
  assert.match(String(network), /speech service could not be reached/)

  const language = recognitionErrorMessage('language-not-supported')
  assert.match(String(language), /type instead/)

  const unknown = recognitionErrorMessage('something-weird')
  assert.match(String(unknown), /stopped unexpectedly/)

  const nullCode = recognitionErrorMessage(null)
  assert.match(String(nullCode), /stopped unexpectedly/)
})

test('recognitionErrorMessage: aborted is not a failure (null)', () => {
  assert.equal(recognitionErrorMessage('aborted'), null)
})

test('permissionErrorMessage: maps DOMException names', () => {
  assert.match(
    permissionErrorMessage(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    /permission was denied/,
  )
  assert.match(
    permissionErrorMessage(Object.assign(new Error('x'), { name: 'SecurityError' })),
    /permission was denied/,
  )
  assert.match(
    permissionErrorMessage(Object.assign(new Error('x'), { name: 'NotFoundError' })),
    /No microphone was detected/,
  )
  assert.match(
    permissionErrorMessage(Object.assign(new Error('x'), { name: 'NotReadableError' })),
    /busy in another app/,
  )
  assert.match(
    permissionErrorMessage(Object.assign(new Error('x'), { name: 'OverconstrainedError' })),
    /No microphone was detected/,
  )
})

test('permissionErrorMessage: unknown failures fall back to typing copy', () => {
  assert.match(permissionErrorMessage(new Error('boom')), /type your question instead/)
  assert.match(permissionErrorMessage(null), /type your question instead/)
  assert.match(permissionErrorMessage('denied'), /type your question instead/)
})

/* ------------------------------------------------------------------ */
/* Transcripts                                                         */
/* ------------------------------------------------------------------ */

test('normalizeTranscript collapses whitespace and trims', () => {
  assert.equal(normalizeTranscript('  what is   the trend \n now? '), 'what is the trend now?')
  assert.equal(normalizeTranscript(''), '')
  assert.equal(normalizeTranscript('   '), '')
  assert.equal(normalizeTranscript(null), '')
  assert.equal(normalizeTranscript(undefined), '')
})

test('mergeTranscripts joins final + interim without double spaces', () => {
  assert.equal(mergeTranscripts('show me ', 'bitcoin'), 'show me bitcoin')
  assert.equal(mergeTranscripts('', 'just bitcoin'), 'just bitcoin')
  assert.equal(mergeTranscripts('done.', ''), 'done.')
  assert.equal(mergeTranscripts('  spaced   out ', '  fragments  '), 'spaced out fragments')
})

/* ------------------------------------------------------------------ */
/* Spoken replies                                                      */
/* ------------------------------------------------------------------ */

test('buildSpokenReply: accepts a plain string', () => {
  assert.equal(buildSpokenReply('  Market is   mixed. '), 'Market is mixed.')
})

test('buildSpokenReply: joins summary + confidence note', () => {
  const text = buildSpokenReply({
    summary: 'BTC is consolidating.',
    confidenceNote: 'This is not a prediction.',
  })
  assert.equal(text, 'BTC is consolidating. This is not a prediction.')
})

test('buildSpokenReply: omits an empty confidence note', () => {
  const text = buildSpokenReply({ summary: 'Neutral read.', confidenceNote: '   ' })
  assert.equal(text, 'Neutral read.')
})

test('buildSpokenReply: empty reply speaks nothing', () => {
  assert.equal(buildSpokenReply('   '), '')
  assert.equal(buildSpokenReply({ summary: '', confidenceNote: '' }), '')
})

test('buildSpokenReply: caps length with an ellipsis', () => {
  const long = 'x'.repeat(600)
  const capped = buildSpokenReply(long, 100)
  assert.equal(capped.length, 100)
  assert.ok(capped.endsWith('…'))

  const cappedDefault = buildSpokenReply(long)
  assert.ok(cappedDefault.length <= 420)
  assert.ok(cappedDefault.endsWith('…'))
})

test('buildSpokenReply: does not clip when under the limit', () => {
  const text = 'short summary'
  assert.equal(buildSpokenReply(text, 420), text)
})
