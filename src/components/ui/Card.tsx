import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
  interactive?: boolean
}

export function Card({ children, className = '', interactive }: CardProps) {
  const classes = ['card', interactive ? 'card--interactive' : '', className]
    .filter(Boolean)
    .join(' ')

  return <section className={classes}>{children}</section>
}

type CardHeadProps = {
  title: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
}

export function CardHead({ title, icon, badge, actions }: CardHeadProps) {
  return (
    <header className="card__head">
      <h2>
        {icon}
        {title}
      </h2>
      {badge}
      {actions ? <div className="card__head-actions">{actions}</div> : null}
    </header>
  )
}

type CardBodyProps = {
  children: ReactNode
  /** Remove body padding — for list-style content. */
  flush?: boolean
  className?: string
}

export function CardBody({ children, flush, className = '' }: CardBodyProps) {
  const classes = ['card__body', flush ? 'card__body--flush' : '', className]
    .filter(Boolean)
    .join(' ')
  return <div className={classes}>{children}</div>
}

export function CardFoot({ children }: { children: ReactNode }) {
  return <footer className="card__foot">{children}</footer>
}
