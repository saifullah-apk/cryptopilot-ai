import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  detectVoiceSupport,
  getSpeechRecognitionCtor,
  normalizeTranscript,
  permissionErrorMessage,
  recognitionErrorMessage,
  type SpeechRecognitionLike,
  type VoiceSupport,
} from '../lib/voice'

const SPEECH_LANG = 'en-US'
const AUTO_SPEAK_KEY = 'cryptopilot.voice.autospeak'

export type FinalTranscriptHandler = (text: string) => void

export type UseVoiceResult = {
  support: VoiceSupport
  listening: boolean
  /** Live interim transcript while listening. */
  interim: string
  /** User-facing error (permission, no mic, unsupported…). */
  error: string | null
  /** True while a reply is being spoken. */
  speaking: boolean
  /** Auto-speak replies after they arrive (persisted preference). */
  autoSpeak: boolean
  toggleAutoSpeak: () => void
  startListening: (onFinal?: FinalTranscriptHandler) => Promise<void>
  stopListening: () => void
  toggleListening: (onFinal?: FinalTranscriptHandler) => void
  speak: (text: string) => void
  stopSpeaking: () => void
  /** Shown when speech-to-text or TTS is unavailable in this browser. */
  fallbackHint: string | null
}

function loadAutoSpeak(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(AUTO_SPEAK_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

function persistAutoSpeak(value: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(AUTO_SPEAK_KEY, String(value))
  } catch {
    /* Preference simply won't persist. */
  }
}

/**
 * Microphone input, speech-to-text and text-to-speech for the coach.
 * Every browser API is feature-detected; unsupported browsers get a
 * copy-paste fallback hint instead of a broken control.
 */
export function useVoice(): UseVoiceResult {
  const support = useMemo(() => detectVoiceSupport(), [])

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(loadAutoSpeak)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      recognitionRef.current?.abort?.()
      recognitionRef.current = null
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        /* Already stopped. */
      }
    }
    setListening(false)
    setInterim('')
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const startListening = useCallback(
    async (onFinal?: FinalTranscriptHandler) => {
      if (!support.speechRecognition) {
        setError(
          'Voice input is not supported in this browser. Type your question instead — Chrome and Edge support speech input.',
        )
        return
      }
      if (recognitionRef.current) return

      setError(null)
      setInterim('')
      stopSpeaking()

      // Microphone permission preflight for a precise, friendly error.
      const mediaDevices = navigator.mediaDevices
      if (mediaDevices && typeof mediaDevices.getUserMedia === 'function') {
        try {
          const stream = await mediaDevices.getUserMedia({ audio: true })
          for (const track of stream.getTracks()) track.stop()
        } catch (caught) {
          if (mountedRef.current) setError(permissionErrorMessage(caught))
          return
        }
      }

      const Ctor = getSpeechRecognitionCtor()
      if (!Ctor) {
        if (mountedRef.current) {
          setError('Voice input is not supported in this browser. Please type instead.')
        }
        return
      }

      const recognition = new Ctor()
      recognition.lang = SPEECH_LANG
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        if (mountedRef.current) setListening(true)
      }

      recognition.onresult = (event) => {
        let finalText = ''
        let interimText = ''
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index]
          if (result.isFinal) finalText += `${result[0].transcript} `
          else interimText += result[0].transcript
        }
        if (!mountedRef.current) return
        setInterim(interimText)
        const finalTranscript = normalizeTranscript(finalText)
        if (finalTranscript.length > 0) onFinal?.(finalTranscript)
      }

      recognition.onerror = (event) => {
        const message = recognitionErrorMessage(event.error)
        if (!mountedRef.current) return
        if (message) setError(message)
        setListening(false)
        setInterim('')
      }

      recognition.onend = () => {
        if (!mountedRef.current) return
        setListening(false)
        setInterim('')
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null
        }
      }

      recognitionRef.current = recognition
      try {
        recognition.start()
      } catch {
        recognitionRef.current = null
        if (mountedRef.current) {
          setError('Voice input could not start. Please try again or type instead.')
          setListening(false)
        }
      }
    },
    [stopListening, stopSpeaking, support.speechRecognition],
  )

  const toggleListening = useCallback(
    (onFinal?: FinalTranscriptHandler) => {
      if (recognitionRef.current) stopListening()
      else void startListening(onFinal)
    },
    [startListening, stopListening],
  )

  const speak = useCallback(
    (text: string) => {
      const utteranceText = normalizeTranscript(text)
      if (!support.speechSynthesis || utteranceText.length === 0) return
      if (typeof SpeechSynthesisUtterance === 'undefined') return

      stopListening() // never listen while speaking (feedback loop)
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(utteranceText)
      utterance.lang = SPEECH_LANG
      utterance.rate = 1
      utterance.onstart = () => {
        if (mountedRef.current) setSpeaking(true)
      }
      utterance.onend = () => {
        if (mountedRef.current) setSpeaking(false)
      }
      utterance.onerror = () => {
        if (mountedRef.current) setSpeaking(false)
      }
      window.speechSynthesis.speak(utterance)
    },
    [stopListening, support.speechSynthesis],
  )

  const toggleAutoSpeak = useCallback(() => {
    setAutoSpeak((previous) => {
      const next = !previous
      persistAutoSpeak(next)
      if (!next) stopSpeaking()
      return next
    })
  }, [stopSpeaking])

  const fallbackHint = useMemo(() => {
    if (!support.speechRecognition) {
      return 'Voice input is not supported in this browser — type your question instead (Chrome or Edge supports speech input).'
    }
    if (!support.speechSynthesis) {
      return 'Spoken replies are not supported in this browser — replies will only appear as text.'
    }
    return null
  }, [support])

  return {
    support,
    listening,
    interim,
    error,
    speaking,
    autoSpeak,
    toggleAutoSpeak,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    fallbackHint,
  }
}
