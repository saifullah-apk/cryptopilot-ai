import type { ReactNode } from 'react'

/** Hand-drawn stroke icon set — keeps the project free of icon dependencies. */
const ICONS: Record<string, ReactNode> = {
  logo: (
    <>
      <path d="M4 17.5 9.2 11l3.4 3.4L20 6" />
      <path d="M15 6h5v5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="8.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
      <rect x="13.5" y="11" width="7.5" height="10" rx="1.6" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6" />
    </>
  ),
  candles: (
    <>
      <path d="M7 4v3M7 17v3M17 6v3M17 15v4" />
      <rect x="4.5" y="7" width="5" height="10" rx="1.4" />
      <rect x="14.5" y="9" width="5" height="6" rx="1.4" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.2 13.7 8a2 2 0 0 0 1.3 1.3l4.8 1.7-4.8 1.7a2 2 0 0 0-1.3 1.3L12 18.8 10.3 14a2 2 0 0 0-1.3-1.3L4.2 11l4.8-1.7A2 2 0 0 0 10.3 8z" />
      <path d="M18.5 3v3M20 4.5h-3" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.2" />
      <path d="M16.5 14h1.6" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3h5M10.5 3v6.2L5.3 17.6A2 2 0 0 0 7 20.6h10a2 2 0 0 0 1.7-3L13.5 9.2V3" />
      <path d="M7.6 15.4h8.8" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V11M9.3 20V4M14.7 20v-6M20 20V8" />
      <path d="M2.5 20.5h19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.2 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2.7a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V2.7a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.8 13.2A8.6 8.6 0 1 1 10.8 3.2a6.7 6.7 0 0 0 10 10z" />,
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
      <path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
    </>
  ),
  user: (
    <>
      <path d="M19.5 20.5v-1.8a4 4 0 0 0-4-4h-7a4 4 0 0 0-4 4v1.8" />
      <circle cx="12" cy="7.5" r="3.8" />
    </>
  ),
  shield: <path d="M12 21.2s7.5-3.6 7.5-9.2V5.4L12 2.6 4.5 5.4v6.6c0 5.6 7.5 9.2 7.5 9.2z" />,
  trend: <path d="M3 16.5 9 10l4 4 8-8.5" />,
  activity: <path d="M2.5 12h4l3-8.5 4.5 17 3-8.5h4.5" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M18 13l-6 6-6-6" />,
  arrowRight: <path d="M5 12h13M13 6l6 6-6 6" />,
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17v.3" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </>
  ),
  star: (
    <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  check: <path d="m5 12.8 4.5 4.4L19 7.2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4.5V10H15" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="M16.2 16.2 21 21" />
    </>
  ),
  send: <path d="M21 3 10.2 13.8M21 3l-6.6 18-3.6-7.8L3 9.6z" />,
  mic: (
    <>
      <rect x="9" y="2.8" width="6" height="11.4" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2M8.8 21.2h6.4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.4L12 19V5L7.4 9.5z" />
      <path d="M15.5 9.2a4.2 4.2 0 0 1 0 5.6M18.2 6.8a7.8 7.8 0 0 1 0 10.4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.2" width="18" height="13.6" rx="2.2" />
      <path d="m3.8 6.4 8.2 6 8.2-6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16M9 6.5V4.6h6v1.9M6.4 6.5l.9 13.2h9.4l.9-13.2" />
      <path d="M10.2 10.5v6M13.8 10.5v6" />
    </>
  ),
}

export type IconName = keyof typeof ICONS

type IconProps = {
  name: IconName | string
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 18, className, strokeWidth = 1.7 }: IconProps) {
  const glyph = ICONS[name]
  if (!glyph) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  )
}
