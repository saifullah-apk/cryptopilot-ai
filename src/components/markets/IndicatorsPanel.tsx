import type { TechnicalAnalysis } from '../../lib/indicators'
import { formatCompact, formatPercent, formatPrice } from '../../lib/format'

type TileSignal = 'bullish' | 'bearish' | 'neutral'

type Tile = {
  label: string
  value: string
  hint: string
  signal: TileSignal | null
}

function relationSignal(value: number | null, reference: number | null): TileSignal | null {
  if (value === null || reference === null) return null
  return reference > value ? 'bullish' : reference < value ? 'bearish' : 'neutral'
}

function buildTiles(analysis: TechnicalAnalysis): Tile[] {
  const { indicators, lastClose } = analysis
  const { rsi14, macd, ema9, ema21, ema50, ema200, bollinger, atr14, atrPercent, vwap, volume } =
    indicators

  const rsiSignal: TileSignal | null =
    rsi14 === null ? null : rsi14 >= 55 ? 'bullish' : rsi14 <= 45 ? 'bearish' : 'neutral'
  const rsiHint =
    rsi14 === null
      ? 'Needs 15 candles'
      : rsi14 >= 70
        ? 'Overbought'
        : rsi14 <= 30
          ? 'Oversold'
          : 'Neutral zone'

  const macdHint = macd
    ? `Line ${macd.line.toFixed(2)} · Signal ${macd.signal.toFixed(2)}`
    : 'Needs 35 candles'

  const emaHint = (value: number | null) =>
    value === null
      ? 'Needs more candles'
      : lastClose === null
        ? ''
        : lastClose > value
          ? 'Price above'
          : lastClose < value
            ? 'Price below'
            : 'At price'

  return [
    {
      label: 'RSI 14',
      value: rsi14 !== null ? rsi14.toFixed(1) : '—',
      hint: rsiHint,
      signal: rsiSignal,
    },
    {
      label: 'MACD (12, 26, 9)',
      value: macd ? macd.histogram.toFixed(4) : '—',
      hint: macdHint,
      signal: macd ? (macd.histogram >= 0 ? 'bullish' : 'bearish') : null,
    },
    {
      label: 'EMA 9',
      value: formatPrice(ema9),
      hint: emaHint(ema9),
      signal: relationSignal(ema9, lastClose),
    },
    {
      label: 'EMA 21',
      value: formatPrice(ema21),
      hint: emaHint(ema21),
      signal: relationSignal(ema21, lastClose),
    },
    {
      label: 'EMA 50',
      value: formatPrice(ema50),
      hint: emaHint(ema50),
      signal: relationSignal(ema50, lastClose),
    },
    {
      label: 'EMA 200',
      value: formatPrice(ema200),
      hint: emaHint(ema200),
      signal: relationSignal(ema200, lastClose),
    },
    {
      label: 'Bollinger (20, 2)',
      value: formatPrice(bollinger ? bollinger.middle : null),
      hint: bollinger
        ? `BW ${bollinger.bandwidth.toFixed(2)}% · %B ${bollinger.percentB.toFixed(0)}`
        : 'Needs 20 candles',
      signal: null,
    },
    {
      label: 'ATR 14',
      value: formatPrice(atr14),
      hint: atrPercent !== null ? `${formatPercent(atrPercent)} of price` : 'Needs 15 candles',
      signal: null,
    },
    {
      label: 'VWAP (50)',
      value: formatPrice(vwap),
      hint: vwap === null ? 'Needs candles' : lastClose !== null ? (lastClose > vwap ? 'Price above' : 'Price below') : '',
      signal: relationSignal(vwap, lastClose),
    },
    {
      label: 'Volume (20)',
      value: volume ? formatCompact(volume.last) : '—',
      hint: volume
        ? volume.relative !== null
          ? `${volume.relative.toFixed(2)}× avg${volume.trend ? ` · ${volume.trend}` : ''}`
          : 'No average yet'
        : 'No candles',
      signal: null,
    },
  ]
}

export function IndicatorsPanel({ analysis }: { analysis: TechnicalAnalysis }) {
  const tiles = buildTiles(analysis)

  if (analysis.candleCount === 0) {
    return (
      <p className="dim" style={{ fontSize: 12.5 }}>
        Indicator values are unavailable because no candles were returned.
      </p>
    )
  }

  return (
    <div className="ind-grid">
      {tiles.map((tile) => (
        <div
          className={`ind-tile${tile.signal ? ` ind-tile--${tile.signal}` : ''}`}
          key={tile.label}
        >
          <span className="ind-tile__label">{tile.label}</span>
          <span className={`ind-tile__value mono${tile.value === '—' ? ' dim' : ''}`}>
            {tile.value}
          </span>
          <span className="ind-tile__hint">{tile.hint}</span>
        </div>
      ))}
    </div>
  )
}
