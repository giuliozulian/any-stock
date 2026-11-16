import styles from './SeasonalBars.module.css'

export interface SeasonalBar {
  key: string
  label: string
  valuePct: number
  value: string
  detail: string
  highlight?: boolean
}

export function SeasonalBars({ bars, label }: { bars: SeasonalBar[]; label: string }) {
  if (bars.length === 0) return null

  const maxAbs = Math.max(...bars.map((bar) => Math.abs(bar.valuePct))) || 1

  return (
    <ul className={styles.list} aria-label={label}>
      {bars.map((bar) => {
        // The largest bar fills half the track; bars start at the centre line.
        const width = (Math.abs(bar.valuePct) / maxAbs) * 50
        const left = bar.valuePct >= 0 ? 50 : 50 - width
        return (
          <li key={bar.key} className={styles.row} data-tone={bar.valuePct > 0 ? 'gain' : bar.valuePct < 0 ? 'loss' : 'flat'} data-highlight={bar.highlight ? 'true' : 'false'}>
            <span className={styles.label}>{bar.label}</span>
            <span className={styles.track} aria-hidden="true">
              <span data-bar className={styles.bar} style={{ left: `${left}%`, width: `${width}%` }} />
            </span>
            <span className={styles.value}>{bar.value}</span>
            <span className={styles.detail}>{bar.detail}</span>
          </li>
        )
      })}
    </ul>
  )
}
