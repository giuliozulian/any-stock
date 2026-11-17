import styles from './ScannerSkeleton.module.css'

const ROWS = 5

// Same shape as the loaded page: button, last-scan line, filter bar and the list of stocks.
export function ScannerSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carico lo scanner…</span>
      <div aria-hidden="true">
        <span className={`${styles.bar} ${styles.button}`} />
        <span className={`${styles.bar} ${styles.meta}`} />
        <div className={styles.filters}>
          <span className={`${styles.bar} ${styles.seg}`} />
          <span className={`${styles.bar} ${styles.seg}`} />
          <span className={`${styles.bar} ${styles.field}`} />
          <span className={`${styles.bar} ${styles.field}`} />
          <span className={`${styles.bar} ${styles.pill}`} />
          <span className={`${styles.bar} ${styles.pill}`} />
        </div>
        <ul className={styles.list}>
          {Array.from({ length: ROWS }, (_, r) => (
            <li key={r} className={styles.row}>
              <span className={styles.who}>
                <span className={`${styles.bar} ${styles.symbol}`} />
                <span className={`${styles.bar} ${styles.sub}`} />
              </span>
              <span className={styles.action}>
                <span className={`${styles.bar} ${styles.chip}`} />
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.lineShort}`} />
              </span>
              <span className={styles.plan}>
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.line}`} />
                <span className={`${styles.bar} ${styles.line}`} />
              </span>
              <span className={`${styles.bar} ${styles.rs}`} />
              <span className={`${styles.bar} ${styles.gauge}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
