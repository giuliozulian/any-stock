import styles from './FairValueScale.module.css'

interface ScaleModel {
  key: string
  label: string
  value: number
}

const money = (v: number) => v.toFixed(2)

// A horizontal axis with one point per model, a band for the range and a marker for the price.
export function FairValueScale({ models, low, high, price, reliable }: { models: ScaleModel[]; low: number; high: number; price: number; reliable: boolean }) {
  const values = [...models.map((m) => m.value), price]
  const min = Math.min(...values) * 0.9
  const max = Math.max(...values) * 1.1
  const place = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
  const label = `Modelli: ${models.map((m) => `${m.label} ${money(m.value)}`).join(', ')}. Prezzo ${money(price)}.`

  return (
    <div className={styles.scale} role="img" aria-label={label}>
      <span className={styles.track} />
      <span data-role="band" data-reliable={reliable ? 'true' : 'false'} className={styles.band} style={{ left: `${place(low)}%`, width: `${place(high) - place(low)}%` }} />
      {models.map((m) => (
        <span key={m.key} data-role="model" className={styles.model} style={{ left: `${place(m.value)}%` }} title={`${m.label}: ${money(m.value)}`} />
      ))}
      <span data-role="price" className={styles.price} style={{ left: `${place(price)}%` }} />
    </div>
  )
}
