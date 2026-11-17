import styles from './LoginChart.module.css'

// A made-up price series: a long climb with pullbacks, the shape a watched stock has. Decoration only.
const SERIES = [118, 121, 117, 124, 129, 126, 133, 131, 138, 144, 140, 137, 143, 151, 158, 154, 149, 156, 163, 170, 166, 161, 168, 176, 184, 179, 174, 181, 189, 197, 193, 201, 209, 205, 212, 220]

const WIDTH = 640
const HEIGHT = 320
const PAD = 24

const low = Math.min(...SERIES)
const high = Math.max(...SERIES)
const x = (i: number) => PAD + (i / (SERIES.length - 1)) * (WIDTH - PAD * 2)
const y = (v: number) => HEIGHT - PAD - ((v - low) / (high - low)) * (HEIGHT - PAD * 2)

const PATH = SERIES.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
// The dashed line sits where an entry price would: a quiet nod to what the app is for.
const REFERENCE_Y = y(low + (high - low) * 0.34)

export function LoginChart() {
  return (
    <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMax meet">
      <line data-role="reference" className={styles.reference} x1={PAD} x2={WIDTH - PAD} y1={REFERENCE_Y} y2={REFERENCE_Y} />
      <path data-role="price" className={styles.price} d={PATH} pathLength={1} fill="none" />
      <circle data-role="end" className={styles.end} cx={x(SERIES.length - 1)} cy={y(SERIES[SERIES.length - 1])} r="5" />
    </svg>
  )
}
