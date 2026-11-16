import styles from './page.module.css'

const ROWS = 6
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7]

export function WatchlistSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carico la watchlist…</span>
      <div className={styles.kpis} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.kpi}>
            <span className={`${styles.skBar} ${styles.skKpiLabel}`} />
            <span className={`${styles.skBar} ${styles.skKpiValue}`} />
          </div>
        ))}
      </div>
      <section className={styles.board} aria-hidden="true">
        <ul className={styles.list}>
          {Array.from({ length: ROWS }, (_, r) => (
            <li key={r} className={styles.row}>
              {CELLS.map((c) => (
                <span key={c} className={`${styles.skBar} ${c === 0 ? styles.skCellWide : styles.skCell}`} />
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
