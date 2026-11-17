import type { Bar } from '@/lib/history'

const WEEK52 = 252
const SLOPE_BARS = 22
const QUARTER = 63

export const RS_MIN = 70
// Minervini wants breakout volume at least 40% above average.
export const BREAKOUT_VOLUME = 1.4
// weightedReturn needs four full quarters plus the starting close.
export const RS_MIN_BARS = QUARTER * 4 + 1

export const TREND_TEMPLATE_LABELS = [
  'Prezzo sopra le medie a 150 e 200 giorni',
  'Media a 150 giorni sopra quella a 200',
  'Media a 200 giorni in salita da almeno un mese',
  'Media a 50 giorni sopra quelle a 150 e 200',
  'Prezzo sopra la media a 50 giorni',
  'Almeno 30% sopra il minimo dell’ultimo anno',
  'Al massimo 25% sotto il massimo dell’ultimo anno',
  'Forza relativa almeno 70',
] as const

export function sma(values: number[], n: number, end = values.length): number | null {
  if (end < n || end > values.length) return null
  let sum = 0
  for (let i = end - n; i < end; i++) sum += values[i]
  return sum / n
}

// Quarterly returns over the last year, the most recent quarter counting double.
export function weightedReturn(closes: number[]): number | null {
  const n = closes.length
  if (n < RS_MIN_BARS) return null
  const ret = (k: number) => closes[n - 1 - k * QUARTER] / closes[n - 1 - (k + 1) * QUARTER] - 1
  return 0.4 * ret(0) + 0.2 * (ret(1) + ret(2) + ret(3))
}

export function percentileRank(value: number, peers: number[]): number {
  if (peers.length === 0) return 0
  const below = peers.filter((p) => p < value).length
  const equal = peers.filter((p) => p === value).length
  return ((below + equal / 2) / peers.length) * 100
}

export interface Criterion {
  id: number
  label: string
  ok: boolean
  value: string
  // Signed distance from the threshold as a fraction (negative = missed by that much); null when not a price test.
  margin: number | null
}

export interface Level {
  key: 'price' | 'sma50' | 'sma150' | 'sma200'
  label: string
  value: number
}

export interface TrendTemplate {
  criteria: Criterion[]
  passedCount: number
  total: number
  passed: boolean
  stage2: boolean
  // Price and averages in the order Minervini wants them, highest first.
  levels: Level[]
}

const fmtPct = (v: number) => (v * 100).toLocaleString('it-IT', { maximumFractionDigits: Math.abs(v) < 0.01 ? 2 : 1 })
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${fmtPct(Math.abs(v))}%`
const distance = (v: number) => `${fmtPct(Math.abs(v))}% ${v >= 0 ? 'sopra' : 'sotto'}`

const MAX_RISING_MONTHS = 5

// Consecutive months, counting back from today, in which the 200-day average rose.
function risingMonths(closes: number[]): number {
  let months = 0
  while (months < MAX_RISING_MONTHS) {
    const now = sma(closes, 200, closes.length - months * SLOPE_BARS)
    const before = sma(closes, 200, closes.length - (months + 1) * SLOPE_BARS)
    if (now === null || before === null || now <= before) break
    months++
  }
  return months
}

export function evaluateTrendTemplate(bars: Bar[], rsPercentile: number | null): TrendTemplate | null {
  if (bars.length < 200 + SLOPE_BARS) return null
  const closes = bars.map((b) => b.close)
  const price = closes[closes.length - 1]
  const sma50 = sma(closes, 50)!
  const sma150 = sma(closes, 150)!
  const sma200 = sma(closes, 200)!
  const sma200Before = sma(closes, 200, closes.length - SLOPE_BARS)!
  const year = bars.slice(-WEEK52)
  const high52 = Math.max(...year.map((b) => b.high))
  const low52 = Math.min(...year.map((b) => b.low))
  const longest = Math.max(sma150, sma200)
  const months = risingMonths(closes)

  const m1 = price / longest - 1
  const m2 = sma150 / sma200 - 1
  const m3 = sma200 / sma200Before - 1
  const m4 = sma50 / longest - 1
  const m5 = price / sma50 - 1
  const m6 = price / (low52 * 1.3) - 1
  const m7 = price / (high52 * 0.75) - 1

  const criteria: Criterion[] = [
    { id: 1, label: TREND_TEMPLATE_LABELS[0], ok: m1 > 0, margin: m1, value: distance(m1) },
    { id: 2, label: TREND_TEMPLATE_LABELS[1], ok: m2 > 0, margin: m2, value: distance(m2) },
    {
      id: 3,
      label: TREND_TEMPLATE_LABELS[2],
      ok: m3 > 0,
      // A slope is always a small fraction, so it never counts as a near miss.
      margin: null,
      value: months === 0 ? 'in calo nell’ultimo mese' : `in salita da ${months === MAX_RISING_MONTHS ? '5+ mesi' : months === 1 ? '1 mese' : `${months} mesi`}`,
    },
    { id: 4, label: TREND_TEMPLATE_LABELS[3], ok: m4 > 0, margin: m4, value: distance(m4) },
    { id: 5, label: TREND_TEMPLATE_LABELS[4], ok: m5 > 0, margin: m5, value: distance(m5) },
    { id: 6, label: TREND_TEMPLATE_LABELS[5], ok: m6 >= 0, margin: m6, value: `${pct(price / low52 - 1)} dal minimo` },
    { id: 7, label: TREND_TEMPLATE_LABELS[6], ok: m7 >= 0, margin: m7, value: `${pct(price / high52 - 1)} dal massimo` },
    {
      id: 8,
      label: TREND_TEMPLATE_LABELS[7],
      ok: rsPercentile !== null && rsPercentile >= RS_MIN,
      margin: null,
      value: rsPercentile === null ? 'non affidabile' : `${Math.round(rsPercentile)} su 100`,
    },
  ]
  const counted = rsPercentile === null ? criteria.slice(0, 7) : criteria
  const passedCount = counted.filter((c) => c.ok).length
  return {
    criteria,
    passedCount,
    total: counted.length,
    passed: passedCount === counted.length,
    stage2: criteria.slice(0, 5).every((c) => c.ok),
    levels: [
      { key: 'price', label: 'Prezzo', value: price },
      { key: 'sma50', label: 'Media 50 giorni', value: sma50 },
      { key: 'sma150', label: 'Media 150 giorni', value: sma150 },
      { key: 'sma200', label: 'Media 200 giorni', value: sma200 },
    ],
  }
}

interface Swing {
  value: number
  type: 'high' | 'low'
  index: number
}

// Zigzag on closes: a swing is confirmed once price reverses by `reversal` from its extreme.
function swings(closes: number[], reversal: number): Swing[] {
  const out: Swing[] = []
  let hi = 0
  let lo = 0
  let dir: 'up' | 'down' | null = null
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i]
    if (dir === null) {
      if (c >= closes[lo] * (1 + reversal)) {
        out.push({ value: closes[lo], type: 'low', index: lo })
        dir = 'up'
        hi = i
      } else if (c <= closes[hi] * (1 - reversal)) {
        out.push({ value: closes[hi], type: 'high', index: hi })
        dir = 'down'
        lo = i
      } else {
        if (c > closes[hi]) hi = i
        if (c < closes[lo]) lo = i
      }
    } else if (dir === 'up') {
      if (c > closes[hi]) hi = i
      else if (c <= closes[hi] * (1 - reversal)) {
        out.push({ value: closes[hi], type: 'high', index: hi })
        dir = 'down'
        lo = i
      }
    } else if (c < closes[lo]) lo = i
    else if (c >= closes[lo] * (1 + reversal)) {
      out.push({ value: closes[lo], type: 'low', index: lo })
      dir = 'up'
      hi = i
    }
  }
  if (dir === 'up') out.push({ value: closes[hi], type: 'high', index: hi })
  else if (dir === 'down') out.push({ value: closes[lo], type: 'low', index: lo })
  return out
}

// forming: still under the pivot; breakout: up to 5% above it; extended: too far above to chase; failed: below the base's last low.
export type VcpStatus = 'forming' | 'breakout' | 'extended' | 'failed'

export const VCP_STATUS_LABEL: Record<VcpStatus, string> = {
  forming: 'Base pronta',
  breakout: 'In rottura',
  extended: 'Troppo tardi',
  failed: 'Base rotta',
}

export interface Vcp {
  contractions: number[]
  pivot: number | null
  volumeDryUp: boolean
  suggestedStop: number | null
  lastLow: number | null
  status: VcpStatus | null
  // Today's volume over its 50-day average; a valid breakout wants at least 1.4.
  volumeRatio: number | null
}

// A base is only a VCP if its last pullback is tight.
export const MAX_LAST_CONTRACTION = 0.1
// Heavy-volume down days in the last 20 sessions that make a base "distributed" rather than quiet.
export const MAX_DISTRIBUTION_DAYS = 2
const DISTRIBUTION_WINDOW = 20
// A down day counts as heavy selling when its volume is 25% above the 50-day average.
const DISTRIBUTION_VOLUME = 1.25

const VCP_WINDOW = 150
const VCP_REVERSAL = 0.05
export const STOP_BELOW_PIVOT = 0.08
export const MAX_CHASE = 0.05

const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length

export function detectVcp(bars: Bar[]): Vcp {
  const recent = bars.slice(-VCP_WINDOW)
  const volumes = recent.map((b) => b.volume)
  const enoughVolume = volumes.length >= 50
  const avg50 = enoughVolume ? avg(volumes.slice(-50)) : 0
  // The last bar is left out of the base volume: a breakout day is loud by definition and must not hide a noisy base.
  const priorVolumes = volumes.slice(0, -1)
  const quiet = enoughVolume && avg(priorVolumes.slice(-10)) < avg50
  let distribution = 0
  for (let i = Math.max(1, recent.length - 1 - DISTRIBUTION_WINDOW); i < recent.length - 1; i++) {
    if (recent[i].close < recent[i - 1].close && recent[i].volume > avg50 * DISTRIBUTION_VOLUME) distribution++
  }
  // Clean base volume: recent sessions quieter than the 50-day average and few heavy selling days.
  const volumeDryUp = quiet && distribution <= MAX_DISTRIBUTION_DAYS
  const volumeRatio = avg50 > 0 ? volumes[volumes.length - 1] / avg50 : null
  const none: Vcp = { contractions: [], pivot: null, volumeDryUp, suggestedStop: null, lastLow: null, status: null, volumeRatio }

  const points = swings(recent.map((b) => b.close), VCP_REVERSAL)
  const depths: number[] = []
  const highs: Swing[] = []
  const lows: Swing[] = []
  points.forEach((p, k) => {
    const next = points[k + 1]
    if (p.type === 'high' && next?.type === 'low') {
      depths.push((p.value - next.value) / p.value)
      highs.push(p)
      lows.push(next)
    }
  })

  // Walk back over the trailing run of strictly shrinking pullbacks.
  let start = depths.length - 1
  while (start > 0 && depths[start] < depths[start - 1]) start--
  const contractions = start >= 0 ? depths.slice(start) : []
  if (contractions.length < 2) return none
  // The last pullback must be tight: a wide, loose base is not a VCP.
  if (contractions[contractions.length - 1] > MAX_LAST_CONTRACTION) return none
  // The pivot is the peak just before the last pullback, not a rally still in progress.
  const lastLow = lows[lows.length - 1].value
  const lowIndex = lows[lows.length - 1].index
  let pivot = highs[highs.length - 1].value
  // Wicks above the pivot that closed back under it are failed tests: the real line to beat is their high.
  for (let i = lowIndex + 1; i < recent.length - 1 && recent[i].close <= pivot; i++) {
    if (recent[i].high > pivot) pivot = recent[i].high
  }
  const price = recent[recent.length - 1].close
  const status: VcpStatus = price < lastLow ? 'failed' : price <= pivot ? 'forming' : price <= pivot * (1 + MAX_CHASE) ? 'breakout' : 'extended'
  // The stop is 8% below the price actually paid: the pivot while the price is still below it, the current price once it breaks out.
  const entry = status === 'breakout' ? price : pivot
  return { contractions, pivot, volumeDryUp, suggestedStop: entry * (1 - STOP_BELOW_PIVOT), lastLow, status, volumeRatio }
}
