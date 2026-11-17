import type { Bar } from '@/lib/history'
import { detectVcp, sma, type VcpStatus } from '@/lib/minervini'

// Sessions drawn on the chart: about six months.
export const CHART_BARS = 130

export interface ChartCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export interface ChartPoint {
  time: string
  value: number
}

export interface ChartVolume extends ChartPoint {
  up: boolean
}

export interface ChartData {
  candles: ChartCandle[]
  volumes: ChartVolume[]
  sma50: ChartPoint[]
  sma150: ChartPoint[]
  sma200: ChartPoint[]
  pivot: number | null
  stop: number | null
  lastLow: number | null
  status: VcpStatus | null
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10)

// The average ending at each drawn bar, computed on the full history so the line starts at the left edge.
function movingAverage(bars: Bar[], n: number, from: number): ChartPoint[] {
  const closes = bars.map((b) => b.close)
  const out: ChartPoint[] = []
  for (let i = from; i < bars.length; i++) {
    const v = sma(closes, n, i + 1)
    if (v !== null) out.push({ time: day(bars[i].t), value: v })
  }
  return out
}

// Everything the scanner chart draws, from the same bars and the same base detection the scan uses.
export function buildChartData(bars: Bar[]): ChartData {
  const from = Math.max(0, bars.length - CHART_BARS)
  const shown = bars.slice(from)
  const vcp = detectVcp(bars)
  return {
    candles: shown.map((b, i) => ({ time: day(b.t), open: b.open ?? (i > 0 ? shown[i - 1].close : b.close), high: b.high, low: b.low, close: b.close })),
    volumes: shown.map((b, i) => ({ time: day(b.t), value: b.volume, up: b.close >= (i > 0 ? shown[i - 1].close : (b.open ?? b.close)) })),
    sma50: movingAverage(bars, 50, from),
    sma150: movingAverage(bars, 150, from),
    sma200: movingAverage(bars, 200, from),
    pivot: vcp.pivot,
    stop: vcp.suggestedStop,
    lastLow: vcp.lastLow,
    status: vcp.status,
  }
}
