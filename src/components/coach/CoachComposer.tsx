import { useRef, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from '../ui/Icon'
import { MAX_QUESTION_LENGTH } from '../../lib/coach'

/** Voice controls the coach page supplies to the composer. */
export type ComposerVoice = {
  listening: boolean
  interim: string
  error: string | null
  autoSpeak: boolean
  speaking: boolean
  speechSupported: boolean
  synthesisSupported: boolean
  /** Browser-compatibility fallback copy, when a capability is missing. */
  fallbackHint: string | null
  onToggleMic: () => void
  onToggleAutoSpeak: () => void
  onStopSpeaking: () => void
}

type CoachComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  pending: boolean
  disabled?: boolean
  voice?: ComposerVoice
}

/** Question input. Enter sends, Shift+Enter adds a newline. */
export function CoachComposer({
  value,
  onChange,
  onSubmit,
  pending,
  disabled,
  voice,
}: CoachComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending || disabled || value.trim().length === 0) return
    onSubmit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (pending || disabled || value.trim().length === 0) return
      onSubmit()
    }
  }

  const remaining = MAX_QUESTION_LENGTH - value.length
  const micDisabled = pending || disabled || !voice?.speechSupported

  return (
    <form className="coach-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="coach-question">
        Ask the AI coach a question
      </label>
      <textarea
        id="coach-question"
        ref={textareaRef}
        className="coach-composer__input"
        placeholder={
          voice?.speechSupported
            ? 'Ask about the trend, an indicator, a pattern, or the risks of a setup… (or tap the mic and speak)'
            : 'Ask about the trend, an indicator, a pattern, or the risks of a setup…'
        }
        value={value}
        rows={3}
        maxLength={MAX_QUESTION_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={pending || disabled}
      />

      {voice && (voice.listening || voice.interim || voice.error || voice.fallbackHint) ? (
        <div className="coach-voice">
          {voice.listening || voice.interim ? (
            <span className="coach-voice__live" aria-live="polite">
              <span className="coach-voice__dot" aria-hidden="true" />
              {voice.interim || 'Listening… speak your question'}
            </span>
          ) : null}
          {voice.error ? (
            <span className="coach-voice__error" role="alert">
              <Icon name="alert" size={13} />
              {voice.error}
            </span>
          ) : null}
          {!voice.error && voice.fallbackHint ? (
            <span className="coach-voice__hint">{voice.fallbackHint}</span>
          ) : null}
        </div>
      ) : null}

      <div className="coach-composer__foot">
        <div className="coach-composer__left">
          {voice ? (
            <div className="coach-voice__controls">
              <button
                type="button"
                className={`icon-btn coach-voice__mic${voice.listening ? ' is-active' : ''}`}
                onClick={voice.onToggleMic}
                disabled={micDisabled}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
                title={
                  voice.speechSupported
                    ? voice.listening
                      ? 'Stop listening'
                      : 'Ask with your voice'
                    : 'Voice input is not supported in this browser'
                }
              >
                <Icon name={voice.listening ? 'close' : 'mic'} size={16} />
              </button>
              {voice.synthesisSupported ? (
                <button
                  type="button"
                  className={`icon-btn coach-voice__speak${voice.autoSpeak ? ' is-active' : ''}`}
                  onClick={voice.onToggleAutoSpeak}
                  aria-pressed={voice.autoSpeak}
                  aria-label="Toggle spoken replies"
                  title={
                    voice.autoSpeak
                      ? 'Spoken replies on — click to mute'
                      : 'Spoken replies off — click to unmute'
                  }
                >
                  <Icon name="volume" size={16} />
                </button>
              ) : null}
              {voice.speaking ? (
                <button
                  type="button"
                  className="coach-link"
                  onClick={voice.onStopSpeaking}
                >
                  Stop speaking
                </button>
              ) : null}
            </div>
          ) : null}
          <span className="coach-composer__hint">
            Enter sends · Shift + Enter adds a line
            {remaining < 200 ? ` · ${remaining} characters left` : ''}
          </span>
        </div>
        <button
          type="submit"
          className="btn btn--ai"
          disabled={pending || disabled || value.trim().length === 0}
        >
          {pending ? 'Thinking…' : 'Send'}
          <Icon name={pending ? 'clock' : 'send'} size={15} />
        </button>
      </div>
    </form>
  )
}
