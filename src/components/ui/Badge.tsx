import type { ReactNode } from 'react'

export type BadgeTone =
  | 'demo'
  | 'pos'
  | 'neg'
  | 'ai'
  | 'neutral'
  | 'live'
  | 'warn'

type BadgeProps = {
  tone?: BadgeTone
  children: ReactNode
  pulse?: boolean
}

const TONE_CLASS: Record<BadgeTone, string> = {
  demo: 'badge--demo',
  pos: 'badge--pos',
  neg: 'badge--neg',
  ai: 'badge--ai',
  neutral: 'badge--neutral',
  live: 'badge--live',
  warn: 'badge--warn',
}

/** DEMO marker used everywhere preview data is rendered. */
export function DemoBadge({ label = 'Demo' }: { label?: string }) {
  return <span className="badge badge--demo">{label}</span>
}

export function Badge({ tone = 'neutral', children, pulse }: BadgeProps) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {pulse ? <span className="dot dot--pulse" /> : null}
      {children}
    </span>
  )
}
