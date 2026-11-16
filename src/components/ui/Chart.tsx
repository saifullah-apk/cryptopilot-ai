import { useId, useMemo } from 'react'

type Pt = { x: number; y: number }

function smoothPath(points: Pt[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const cx = (p0.x + p1.x) / 2
    d += ` C ${cx.toFixed(2)} ${p0.y.toFixed(2)}, ${cx.toFixed(2)} ${p1.y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  }
  return d
}

type Tone = 'pos' | 'neg' | 'ai'

const TONE_VAR: Record<Tone, string> = {
  pos: 'var(--positive-bright)',
  neg: 'var(--negative-bright)',
  ai: 'var(--ai-primary)',
}

const TONE_SOFT: Record<Tone, string> = {
  pos: 'var(--positive)',
  neg: 'var(--negative)',
  ai: 'var(--ai-primary)',
}

type AreaChartProps = {
  data: number[]
  /** Horizontal axis labels, spread evenly across the plot. */
  labels?: string[]
  tone?: Tone
  ariaLabel: string
}

const W = 640
const H = 250
const PAD = { top: 14, right: 52, bottom: 26, left: 6 }

/** Lightweight dependency-free area chart used for the dashboard chart area. */
export function AreaChart({
  data,
  labels = [],
  tone = 'pos',
  ariaLabel,
}: AreaChartProps) {
  const rawId = useId()
  const gradientId = `cp-${rawId.replace(/:/g, '')}`

  const plot = useMemo(() => {
    if (data.length < 2) return null
    const min = Math.min(...data)
    const max = Math.max(...data)
    const span = max - min || 1
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom

    const points: Pt[] = data.map((value, index) => ({
      x: PAD.left + (index / (data.length - 1)) * innerW,
      y: PAD.top + (1 - (value - min) / span) * innerH,
    }))

    const line = smoothPath(points)
    const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${PAD.top + innerH} L ${points[0].x.toFixed(2)} ${PAD.top + innerH} Z`

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: PAD.top + ratio * innerH,
      value: (max - ratio * span).toFixed(2),
    }))

    return { points, line, area, ticks, innerW, innerH }
  }, [data])

  if (!plot) return null

  const last = plot.points[plot.points.length - 1]

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE_SOFT[tone]} stopOpacity="0.38" />
            <stop offset="100%" stopColor={TONE_SOFT[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>

        <g className="chart-grid">
          {plot.ticks.map((tick) => (
            <line
              key={tick.y}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={tick.y}
              y2={tick.y}
            />
          ))}
        </g>

        <path className="chart-area" d={plot.area} fill={`url(#${gradientId})`} />
        <path
          className="chart-line"
          d={plot.line}
          stroke={TONE_VAR[tone]}
          style={{ ['--dash' as string]: 2400 }}
        />

        <circle
          className="chart-marker"
          cx={last.x}
          cy={last.y}
          r="4"
          fill={TONE_VAR[tone]}
        />

        <g className="chart-axis">
          {plot.ticks.map((tick) => (
            <text
              key={`label-${tick.y}`}
              x={W - PAD.right + 9}
              y={tick.y + 3.5}
              textAnchor="start"
            >
              {tick.value}
            </text>
          ))}
          {labels.map((label, index) => {
            const ratio = labels.length === 1 ? 0 : index / (labels.length - 1)
            const x = PAD.left + ratio * plot.innerW
            const anchor =
              index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'
            return (
              <text key={label} x={x} y={H - 7} textAnchor={anchor}>
                {label}
              </text>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

type SparklineProps = {
  data: number[]
  tone?: Tone
  ariaLabel: string
}

/** Compact trend line for list rows. */
export function Sparkline({ data, tone = 'pos', ariaLabel }: SparklineProps) {
  const points = useMemo(() => {
    if (data.length < 2) return ''
    const min = Math.min(...data)
    const max = Math.max(...data)
    const span = max - min || 1
    const pts: Pt[] = data.map((value, index) => ({
      x: (index / (data.length - 1)) * 90,
      y: 24 - ((value - min) / span) * 20 - 2,
    }))
    return smoothPath(pts)
  }, [data])

  if (!points) return null

  return (
    <svg
      width="90"
      height="26"
      viewBox="0 0 90 26"
      role="img"
      aria-label={ariaLabel}
      style={{ overflow: 'visible' }}
    >
      <path
        d={points}
        fill="none"
        stroke={TONE_VAR[tone]}
        strokeWidth="1.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
