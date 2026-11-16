import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type NoticeProps = {
  children: ReactNode
  tone?: 'default' | 'ai'
  icon?: IconName | string
}

/** Informational banner used for data-availability and safety messaging. */
export function Notice({ children, tone = 'default', icon = 'info' }: NoticeProps) {
  const classes = ['notice', tone === 'ai' ? 'notice--ai' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="note">
      <Icon name={icon} size={15} />
      <div>{children}</div>
    </div>
  )
}

type EmptyStateProps = {
  icon: IconName | string
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}
