import { Link } from 'react-router-dom'
import { Card, CardBody } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'

export type PlaceholderPageProps = {
  eyebrow: string
  title: string
  description: string
  icon: string
  scope: string[]
  phaseLabel: string
}

/** Shared placeholder for routes that arrive in later phases. */
export function PlaceholderPage({
  eyebrow,
  title,
  description,
  icon,
  scope,
  phaseLabel,
}: PlaceholderPageProps) {
  return (
    <>
      <div className="page__head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1 style={{ marginTop: 4 }}>{title}</h1>
          <p>{description}</p>
        </div>
        <Badge tone="neutral">{phaseLabel}</Badge>
      </div>

      <Card>
        <CardBody>
          <div className="placeholder-hero">
            <span className="ai-orb">
              <Icon name={icon} size={24} />
            </span>
            <div>
              <h2>Route placeholder</h2>
              <p style={{ marginTop: 6, maxWidth: '58ch' }}>
                This page is reserved for a later phase. The layout, navigation and
                theming are in place so the module can drop straight in.
              </p>
            </div>

            <ul className="scope-list">
              {scope.map((item) => (
                <li className="scope-item" key={item}>
                  <Icon name="check" size={14} strokeWidth={2.6} />
                  {item}
                </li>
              ))}
            </ul>

            <Link className="btn" to="/">
              <Icon name="dashboard" size={15} />
              Back to dashboard
            </Link>
          </div>
        </CardBody>
      </Card>
    </>
  )
}
