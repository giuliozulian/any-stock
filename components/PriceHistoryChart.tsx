'use client'

import { useMemo, useState } from 'react'
import styles from './PriceHistoryChart.module.css'

interface Point {
  t: number
  close: number
  session?: 'pre' | 'regular' | 'post'
}

const RANGES = [
  { key: '1G', days: 1 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: 'YTD', days: 0 },
  { key: '1A', days: 365 },
  { key: '5A', days: 1826 },
  { key: '10A', days: 3652 },
  { key: 'Max', days: 0 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const LONG_RANGES: readonly RangeKey[] = ['5A', '10A', 'Max']
const PERIOD_TEXT: Record<Exclude<RangeKey, '1G'>, string> = {
  '1M': 'in 1 mese',
  '3M': 'in 3 mesi',
  '6M': 'in 6 mesi',
  YTD: 'da inizio anno',
  '1A': 'in 1 anno',
  '5A': 'in 5 anni',
  '10A': 'in 10 anni',
  Max: 'da inizio storico',
}

const DAY_MS = 86_400_000
// A range is offered when the series starts within a week of where the range would begin.
const COVERAGE_SLACK_DAYS = 7
const W = 640
const H = 220
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }

export function PriceHistoryChart({ points, intraday = [], prevClose = null, long = [] }: { points: Point[]; intraday?: Point[]; prevClose?: number | null; long?: Point[] }) {
  const [range, setRange] = useState<RangeKey>(intraday.length > 1 ? '1G' : '3M')
  const [hover, setHover] = useState<number | null>(null)

  const ranges = useMemo(
    () =>
      RANGES.filter((r) => {
        if (r.key === '1G') return intraday.length > 0
        if (r.key === 'Max') return long.length > 1
        if (r.key === '5A' || r.key === '10A') return long.length > 1 && long[0].t <= long[long.length - 1].t - (r.days - COVERAGE_SLACK_DAYS) * DAY_MS
        return true
      }),
    [intraday, long],
  )

  const data = useMemo(() => {
    if (range === '1G') return intraday
    let base = points
    if (LONG_RANGES.includes(range)) {
      // The long series is cached for hours; finish it with the freshest daily close.
      const tail = points[points.length - 1]
      base = tail && long.length > 0 && tail.t > long[long.length - 1].t ? [...long, tail] : long
    }
    if (base.length === 0) return []
    if (range === 'Max') return base
    const last = base[base.length - 1].t
    if (range === 'YTD') {
      const yearStart = Date.UTC(new Date(last).getUTCFullYear(), 0, 1)
      return base.filter((p) => p.t >= yearStart)
    }
    const days = RANGES.find((r) => r.key === range)!.days
    return base.filter((p) => p.t >= last - days * DAY_MS)
  }, [points, intraday, long, range])

  if (data.length === 0) return null

  const isDay = range === '1G'
  const min = Math.min(...data.map((d) => d.close))
  const max = Math.max(...data.map((d) => d.close))
  const span = max - min || 1
  // Long series mix weekly and daily points, so they are placed by date; the shorter ranges keep even spacing.
  const byTime = LONG_RANGES.includes(range)
  const t0 = data[0].t
  const spanT = data[data.length - 1].t - t0 || 1
  const x = (i: number) => PAD.left + (byTime ? (data[i].t - t0) / spanT : i / Math.max(data.length - 1, 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom)

  const line = data.map((d, i) => `${x(i)},${y(d.close)}`).join(' ')
  const extLines: string[] = []
  if (isDay) {
    let cur: string[] = []
    data.forEach((d, i) => {
      if (d.session !== 'regular') {
        if (cur.length === 0 && i > 0) cur.push(`${x(i - 1)},${y(data[i - 1].close)}`)
        cur.push(`${x(i)},${y(d.close)}`)
      } else if (cur.length) {
        cur.push(`${x(i)},${y(d.close)}`)
        extLines.push(cur.join(' '))
        cur = []
      }
    })
    if (cur.length) extLines.push(cur.join(' '))
  }
  const area = `${x(0)},${H - PAD.bottom} ${line} ${x(data.length - 1)},${H - PAD.bottom}`
  const first = isDay && prevClose ? prevClose : data[0].close
  const last = data[data.length - 1].close
  const changePct = ((last - first) / first) * 100
  const up = changePct >= 0
  const shown = hover !== null ? data[hover] : data[data.length - 1]
  const fmtDate = (t: number) =>
    isDay
      ? new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
  const sessionLabel = { pre: 'Premarket', regular: '', post: 'After-hours' } as const

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const share = (ratio * W - PAD.left) / (W - PAD.left - PAD.right)
    let i = Math.round(share * (data.length - 1))
    if (byTime) {
      const target = t0 + share * spanT
      i = data.findIndex((d) => d.t >= target)
      if (i < 0) i = data.length - 1
      else if (i > 0 && target - data[i - 1].t < data[i].t - target) i -= 1
    }
    setHover(Math.min(data.length - 1, Math.max(0, i)))
  }

  return (
    <div className={`${styles.wrap} ${up ? styles.up : styles.down}`}>
      <div className={styles.top}>
        <div>
          <p className={styles.value}>${shown.close.toFixed(2)}</p>
          <p className={styles.sub}>
            {hover !== null ? `${fmtDate(shown.t)}${shown.session && shown.session !== 'regular' ? ` · ${sessionLabel[shown.session]}` : ''}` : isDay ? `${up ? '+' : ''}${changePct.toFixed(1)}% oggi (vs chiusura prec.)` : `${up ? '+' : ''}${changePct.toFixed(1)}% ${PERIOD_TEXT[range as Exclude<RangeKey, '1G'>]}`}
          </p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Periodo">
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={`${styles.tab} ${range === r.key ? styles.tabActive : ''}`}
              onClick={() => {
                setRange(r.key)
                setHover(null)
              }}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label={`Andamento del prezzo, ${up ? 'in salita' : 'in discesa'} del ${Math.abs(changePct).toFixed(1)}%`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <polygon points={area} className={styles.area} />
        <polyline points={line} className={styles.line} fill="none" />
        {extLines.map((pts, i) => (
          <polyline key={i} points={pts} className={styles.ext} fill="none" />
        ))}
        <text x={PAD.left} y={H - 6} className={styles.axis}>
          {fmtDate(data[0].t)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className={styles.axis}>
          {fmtDate(data[data.length - 1].t)}
        </text>
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className={styles.cross} />
            <circle cx={x(hover)} cy={y(shown.close)} r={4} className={styles.dot} />
          </>
        )}
      </svg>

      <p className={styles.range}>
        Minimo ${min.toFixed(2)} · Massimo ${max.toFixed(2)}
      </p>
    </div>
  )
}
