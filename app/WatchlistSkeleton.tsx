import styles from './page.module.css'

const ROWS = 6

export function WatchlistSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carico la watchlist…</span>
      <span className={`${styles.skBar} ${styles.skSummary}`} aria-hidden="true" />
      <section className={styles.board} aria-hidden="true">
        <ul className={styles.list}>
          {Array.from({ length: ROWS }, (_, r) => (
            <li key={r} className={`${styles.skBar} ${styles.skRow}`} />
          ))}
        </ul>
      </section>
    </div>
  )
}
