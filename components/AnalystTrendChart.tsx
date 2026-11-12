import styles from './AnalystTrendChart.module.css'
import { InfoTip } from './InfoTip'

export interface AnalystPeriod {
  period: Date
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

const SERIES = [
  { key: 'strongBuy', name: 'Acquisto forte', cls: styles.strongBuy },
  { key: 'buy', name: 'Acquisto', cls: styles.buy },
  { key: 'hold', name: 'Neutrale', cls: styles.hold },
  { key: 'sell', name: 'Vendita', cls: styles.sell },
  { key: 'strongSell', name: 'Vendita forte', cls: styles.strongSell },
] as const

export function AnalystTrendChart({ periods }: { periods: AnalystPeriod[] }) {
  const ordered = [...periods].sort((a, b) => a.period.getTime() - b.period.getTime())
  const totals = ordered.map((p) => p.strongBuy + p.buy + p.hold + p.sell + p.strongSell)
  const maxTotal = Math.max(...totals, 1)

  return (
    <section aria-labelledby="analyst-trend-title">
      <h2 id="analyst-trend-title" className={styles.title}>
        Andamento del consenso degli analisti
        <InfoTip label="Cos’è il consenso degli analisti" source="Finnhub, trend raccomandazioni (/stock/recommendation)" formula="% sopra ogni barra = (acquisto forte + acquisto) ÷ analisti totali × 100">
          <strong>Consenso degli analisti</strong>
          <span>Gli analisti delle banche e società di ricerca valutano il titolo e consigliano di comprare, tenere o vendere. Qui vedi come sono cambiate le opinioni mese per mese.</span>
          <span>Serve a capire se la fiducia sta crescendo o calando. Entra nel segnale a medio termine.</span>
        </InfoTip>
      </h2>
      <p className={styles.hint}>Quanti analisti consigliano di comprare, tenere o vendere, mese per mese.</p>

      <div className={styles.chart}>
        {ordered.map((p, i) => {
          const total = totals[i]
          const buyShare = total > 0 ? Math.round(((p.strongBuy + p.buy) / total) * 100) : 0
          const label = p.period.toLocaleDateString('it-IT', { month: 'short' })
          return (
            <div
              key={p.period.toISOString()}
              className={styles.col}
              role="img"
              aria-label={`${label}: ${SERIES.map((s) => `${s.name} ${p[s.key]}`).join(', ')}`}
            >
              <span className={styles.share}>{buyShare}%</span>
              <div className={styles.bar} style={{ height: `${(total / maxTotal) * 100}%` }}>
                {SERIES.map((s) => p[s.key] > 0 && <span key={s.key} className={s.cls} style={{ flexGrow: p[s.key] }} />)}
              </div>
              <span className={styles.month}>{label}</span>
            </div>
          )
        })}
      </div>

      <ul className={styles.legend}>
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className={`${styles.swatch} ${s.cls}`} />
            {s.name}
          </li>
        ))}
      </ul>
      <p className={styles.hint}>La percentuale sopra ogni barra indica quanti analisti consigliano l’acquisto.</p>
    </section>
  )
}
