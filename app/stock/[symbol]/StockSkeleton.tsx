import styles from './page.module.css'

export function StockSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carico il titolo…</span>
      <div className={`${styles.skBar} ${styles.skBack}`} />
      <header className={styles.header}>
        <div className={styles.skStack}>
          <div className={`${styles.skBar} ${styles.skTicker}`} />
          <div className={`${styles.skBar} ${styles.skName}`} />
          <div className={`${styles.skBar} ${styles.skPill}`} />
        </div>
        <div className={styles.skStack} style={{ alignItems: 'flex-end' }}>
          <div className={`${styles.skBar} ${styles.skPrice}`} />
          <div className={`${styles.skBar} ${styles.skTicker}`} />
        </div>
      </header>
      <div className={styles.hero}>
        <div className={styles.chartCol}>
          <div className={`${styles.chartCard} ${styles.skChart}`}>
            <div className={`${styles.skBar} ${styles.skTitle}`} />
            <div className={`${styles.skBar} ${styles.skPriceSm}`} />
            <div className={`${styles.skBar} ${styles.skPlot}`} />
          </div>
          <div className={styles.strip}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${styles.chartCard} ${styles.skTile}`}>
                <div className={`${styles.skBar} ${styles.skTicker}`} />
                <div className={`${styles.skBar} ${styles.skValue}`} />
                <div className={`${styles.skBar} ${styles.skTicker}`} />
              </div>
            ))}
          </div>
        </div>
        <div className={`${styles.chartCard} ${styles.skVerdict}`}>
          <div className={`${styles.skBar} ${styles.skTitle}`} />
          <div className={styles.skMeter}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${styles.skBar} ${styles.skSeg}`} />
            ))}
          </div>
          <div className={`${styles.skBar} ${styles.skVerdictTitle}`} />
          <div className={`${styles.skBar} ${styles.skLine}`} />
          <div className={`${styles.skBar} ${styles.skLineShort}`} />
        </div>
      </div>
      <div className={`${styles.skBar} ${styles.skTabs}`} />
    </div>
  )
}
