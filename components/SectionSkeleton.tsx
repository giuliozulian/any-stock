import styles from './SectionSkeleton.module.css'

interface SectionSkeletonProps {
  label: string
  variant?: 'list' | 'cards'
  rows?: number
}

export function SectionSkeleton({ label, variant = 'list', rows = 6 }: SectionSkeletonProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>{label}</span>
      <div aria-hidden="true">
        <div className={`${styles.bar} ${styles.lead}`} />
        {variant === 'list' ? (
          <div className={styles.list}>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={styles.row}>
                <span className={`${styles.bar} ${styles.date}`} />
                <span className={`${styles.bar} ${styles.main}`} />
                <span className={`${styles.bar} ${styles.side}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.cards}>
            {Array.from({ length: Math.min(rows, 3) }, (_, i) => (
              <div key={i} className={styles.card}>
                <span className={`${styles.bar} ${styles.ring}`} />
                <div className={styles.cardBody}>
                  <span className={`${styles.bar} ${styles.cardTitle}`} />
                  <span className={`${styles.bar} ${styles.cardLine}`} />
                  <span className={`${styles.bar} ${styles.cardLineShort}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
