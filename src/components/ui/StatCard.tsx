import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type StatCardProps = {
  label: string
  /** `null` renders an explicit "unavailable" state. */
  value: string | null
  delta?: string | null
  deltaTone?: 'pos' | 'neg' | 'neutral'
  note?: string
  icon: IconName | string
  iconTone?: 'ai' | 'pos' | 'neutral'
  badge?: ReactNode
}

export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  note,
  icon,
  iconTone = 'neutral',
  badge,
}: StatCardProps) {
  const deltaClass =
    deltaTone === 'pos' ? 'pos' : deltaTone === 'neg' ? 'neg' : 'muted'
  const deltaIcon =
    deltaTone === 'pos' ? 'arrowUp' : deltaTone === 'neg' ? 'arrowDown' : null

  return (
    <article className="card card--interactive stat animate-in">
      <div className="stat__top">
        <span className={`stat__icon${iconTone !== 'neutral' ? ` stat__icon--${iconTone}` : ''}`}>
          <Icon name={icon} size={16} />
        </span>
        <span className="stat__label">{label}</span>
        {badge ? <span style={{ marginLeft: 'auto' }}>{badge}</span> : null}
      </div>

      {value === null ? (
        <div className="stat__value stat__value--na">
          <span className="na-value">
            <Icon name="lock" size={13} />
            Unavailable
          </span>
        </div>
      ) : (
        <div className="stat__value">{value}</div>
      )}

      {delta ? (
        <div className={`stat__delta ${deltaClass}`}>
          {deltaIcon ? <Icon name={deltaIcon} size={13} /> : null}
          {delta}
        </div>
      ) : null}

      {note ? <div className="stat__delta-note" style={{ marginTop: 8, fontSize: 11.5 }}>{note}</div> : null}
    </article>
  )
}
