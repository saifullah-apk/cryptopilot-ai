import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import type { TrendDirection } from '../../lib/indicators'

export function TrendPill({ direction }: { direction: TrendDirection }) {
  if (direction === 'bullish') {
    return (
      <Badge tone="pos">
        <Icon name="arrowUp" size={11} />
        Bullish
      </Badge>
    )
  }
  if (direction === 'bearish') {
    return (
      <Badge tone="neg">
        <Icon name="arrowDown" size={11} />
        Bearish
      </Badge>
    )
  }
  return (
    <Badge tone="neutral">
      <span className="dot" />
      Neutral
    </Badge>
  )
}
