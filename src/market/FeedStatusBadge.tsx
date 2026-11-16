import { Badge } from '../components/ui/Badge'
import type { ConnectionState } from '../lib/binanceSocket'

type FeedStatusBadgeProps = {
  connection: ConnectionState
  stale: boolean
}

/** Single source of truth for the live-feed status pill. */
export function FeedStatusBadge({ connection, stale }: FeedStatusBadgeProps) {
  if (stale) {
    if (connection === 'open') {
      return (
        <Badge tone="warn" pulse>
          Stale
        </Badge>
      )
    }
    if (connection === 'reconnecting') {
      return (
        <Badge tone="warn" pulse>
          Reconnecting
        </Badge>
      )
    }
    if (connection === 'connecting') {
      return (
        <Badge tone="neutral" pulse>
          Connecting
        </Badge>
      )
    }
    return <Badge tone="neg">Offline</Badge>
  }

  if (connection === 'open') {
    return (
      <Badge tone="live" pulse>
        Live
      </Badge>
    )
  }
  if (connection === 'reconnecting') {
    return (
      <Badge tone="warn" pulse>
        Reconnecting
      </Badge>
    )
  }
  if (connection === 'connecting') {
    return (
      <Badge tone="neutral" pulse>
        Connecting
      </Badge>
    )
  }
  return <Badge tone="neg">Offline</Badge>
}
