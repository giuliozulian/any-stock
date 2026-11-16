import { formatPct, type DrawdownPoint, type DrawdownSummary } from '@/lib/performance'
import styles from './DrawdownChart.module.css'

const W = 640
const H = 180
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }

const fmtDay = (t: number) => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtMonth = (t: number) => new Date(t).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtYear = (t: number) => String(new Date(t).getUTCFullYear())

function sentence(s: DrawdownSummary): string {
  const from = fmtMonth(s.maxPeakT)
  const to = fmtMonth(s.maxTroughT)
  const worst = s.maxPct < 0 ? ` Crollo peggiore: ${formatPct(s.maxPct)}, ${from === to ? `a ${to}` : `da ${from} a ${to}`}.` : ''
  // Anything that would print as 0,0% counts as being at the high.
  if (s.currentPct > -0.05) return `Sui massimi storici.${worst}`
  const ago = s.daysSincePeak <= 0 ? 'oggi' : s.daysSincePeak === 1 ? '1 giorno fa' : `${s.daysSincePeak} giorni fa`
  return `Ora a ${formatPct(s.currentPct)} dal massimo del ${fmtDay(s.peakT)} (${ago}).${worst}`
}

export function DrawdownChart({ series, summary }: { series: DrawdownPoint[]; summary: DrawdownSummary }) {
  const text = sentence(summary)
  if (series.length < 2) return <p className={styles.summary}>{text}</p>

  const t0 = series[0].t
  const t1 = series[series.length - 1].t
  const spanT = t1 - t0 || 1
  const lowest = series.reduce((m, d) => Math.min(m, d.drawdownPct), 0)
  const floor = lowest < 0 ? lowest : -1
  const x = (t: number) => PAD.left + ((t - t0) / spanT) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (v / floor) * (H - PAD.top - PAD.bottom)
  const line = series.map((d) => `${x(d.t).toFixed(1)},${y(d.drawdownPct).toFixed(1)}`).join(' ')
  const area = `${x(t0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(t1).toFixed(1)},${y(0).toFixed(1)}`

  return (
    <div>
      <p className={styles.summary}>{text}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={text}>
        <polygon points={area} className={styles.area} />
        <polyline points={line} className={styles.line} fill="none" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        <text x={PAD.left} y={H - 6} className={styles.axis}>
          {fmtYear(t0)}
        </text>
        <text x={W / 2} y={H - 6} textAnchor="middle" className={styles.axis}>
          minimo {formatPct(lowest)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className={styles.axis}>
          {fmtYear(t1)}
        </text>
      </svg>
    </div>
  )
}
