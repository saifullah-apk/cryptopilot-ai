import { useMemo } from 'react'
import type { Candle } from '../../lib/binance'
import { formatCandleTime, formatPrice } from '../../lib/format'

const W = 640
const H = 260
const PAD = { top: 14, right: 64, bottom: 26, left: 6 }
const MAX_CANDLES = 72

type CandleChartProps = {
  candles: Candle[]
  /** Latest WebSocket price, drawn as the forming candle close. */
  livePrice?: number | null
  ariaLabel: string
}

/** Dependency-free candlestick chart with a right-hand price axis. */
export function CandleChart({ candles, livePrice, ariaLabel }: CandleChartProps) {
  const view = useMemo(() => {
    if (candles.length < 2) return null

    const visible = candles.slice(-MAX_CANDLES)
    const prices = visible.flatMap((candle) => [candle.high, candle.low])
    if (typeof livePrice === 'number' && Number.isFinite(livePrice)) {
      prices.push(livePrice)
    }

    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const padding = (max - min || max * 0.01 || 1) * 0.06
    const low = min - padding
    const high = max + padding
    const span = high - low || 1

    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const step = innerW / visible.length
    const bodyWidth = Math.max(1.5, step * 0.62)

    const y = (value: number) => PAD.top + (1 - (value - low) / span) * innerH

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: PAD.top + ratio * innerH,
      value: high - ratio * span,
    }))

    const labelIndexes = [
      0,
      Math.floor((visible.length - 1) / 3),
      Math.floor(((visible.length - 1) * 2) / 3),
      visible.length - 1,
    ]

    const bars = visible.map((candle, index) => {
      const cx = PAD.left + step * (index + 0.5)
      const openY = y(candle.open)
      const closeY = y(candle.close)
      return {
        key: candle.openTime,
        cx,
        highY: y(candle.high),
        lowY: y(candle.low),
        bodyY: Math.min(openY, closeY),
        bodyH: Math.max(1, Math.abs(closeY - openY)),
        up: candle.close >= candle.open,
      }
    })

    return { visible, y, ticks, labelIndexes, bars, bodyWidth, step }
  }, [candles, livePrice])

  if (!view) return null

  const hasLive = typeof livePrice === 'number' && Number.isFinite(livePrice)
  const liveY = hasLive ? view.y(livePrice as number) : 0
  const liveTagY = Math.min(
    Math.max(liveY, PAD.top + 10),
    H - PAD.bottom - 10,
  )

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <g className="chart-grid">
          {view.ticks.map((tick) => (
            <line
              key={tick.y}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={tick.y}
              y2={tick.y}
            />
          ))}
        </g>

        <g>
          {view.bars.map((bar) => {
            const color = bar.up ? 'var(--positive-bright)' : 'var(--negative-bright)'
            return (
              <g key={bar.key}>
                <line
                  x1={bar.cx}
                  x2={bar.cx}
                  y1={bar.highY}
                  y2={bar.lowY}
                  stroke={color}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={bar.cx - view.bodyWidth / 2}
                  y={bar.bodyY}
                  width={view.bodyWidth}
                  height={bar.bodyH}
                  fill={color}
                  rx={0.5}
                />
              </g>
            )
          })}
        </g>

        {hasLive ? (
          <g>
            <line
              className="live-price-line"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={liveY}
              y2={liveY}
            />
            <circle
              cx={W - PAD.right}
              cy={liveY}
              r={2.6}
              fill="var(--positive-bright)"
            />
            <g transform={`translate(${W - PAD.right - 58}, ${liveTagY})`}>
              <rect
                x={0}
                y={-9}
                width={54}
                height={18}
                rx={4}
                fill="var(--surface-3)"
                stroke="var(--border-strong)"
              />
              <text
                className="price-tag"
                x={27}
                y={3.5}
                textAnchor="middle"
                fill="var(--text-1)"
              >
                {formatPrice(livePrice as number)}
              </text>
            </g>
          </g>
        ) : null}

        <g className="chart-axis">
          {view.ticks.map((tick) => (
            <text
              key={`value-${tick.y}`}
              x={W - PAD.right + 9}
              y={tick.y + 3.5}
              textAnchor="start"
            >
              {formatPrice(tick.value)}
            </text>
          ))}
          {view.labelIndexes.map((index, position) => {
            const candle = view.visible[index]
            const x = PAD.left + view.step * (index + 0.5)
            const anchor =
              position === 0 ? 'start' : position === view.labelIndexes.length - 1 ? 'end' : 'middle'
            return (
              <text
                key={`time-${candle.openTime}-${position}`}
                x={x}
                y={H - 7}
                textAnchor={anchor}
              >
                {formatCandleTime(candle.openTime)}
              </text>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
