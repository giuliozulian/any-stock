import { formatPct } from '@/lib/performance'
import styles from './SeasonalCurveChart.module.css'

const W = 640
const H = 220
const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
// Day-of-year offset of each month in a non-leap year.
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const MONTH_LETTERS = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D']

export function SeasonalCurveChart({ curve, current, todayIndex, year }: { curve: number[]; current: number[]; todayIndex: number; year: number }) {
  if (curve.length === 0) return null

  const max = Math.max(0, ...curve, ...current)
  const min = Math.min(0, ...curve, ...current)
  const span = max - min || 1
  const lastIndex = Math.max(curve.length - 1, 1)
  const x = (i: number) => PAD.left + (i / lastIndex) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom)
  const path = (values: number[]) => values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const todayX = x(Math.min(todayIndex, curve.length - 1))
  const label = `Curva stagionale media: fine anno a ${formatPct(curve[curve.length - 1])}.${current.length > 0 ? ` ${year} finora: ${formatPct(current[current.length - 1])}.` : ''}`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={label}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className={styles.zero} />
        <line data-role="today" x1={todayX} x2={todayX} y1={PAD.top} y2={H - PAD.bottom} className={styles.today} />
        <polyline data-series="average" points={path(curve)} className={styles.average} fill="none" />
        {current.length > 0 && <polyline data-series="current" points={path(current)} className={styles.current} fill="none" />}
        {MONTH_LETTERS.map((letter, month) => (
          <text key={month} x={x(MONTH_START[month] + 15)} y={H - 6} textAnchor="middle" className={styles.axis}>
            {letter}
          </text>
        ))}
      </svg>
      <p className={styles.legend}>
        <span className={styles.key} data-series="average">
          Media
        </span>
        {current.length > 0 && (
          <span className={styles.key} data-series="current">
            {year}
          </span>
        )}
        <span>Linea tratteggiata: oggi</span>
      </p>
    </div>
  )
}
