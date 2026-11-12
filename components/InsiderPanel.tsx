import type { InsiderData } from '@/lib/insider-data'
import { InfoTip } from './InfoTip'
import styles from './InsiderPanel.module.css'

const MOODS = {
  buying: { label: 'Gli insider stanno comprando', tone: 'gain' },
  selling: { label: 'Gli insider stanno vendendo', tone: 'loss' },
  neutral: { label: 'Nessun segnale netto', tone: 'flat' },
} as const

const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`)
const date = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
const monthName = (year: number, month: number) => new Date(year, month - 1, 1).toLocaleDateString('it-IT', { month: 'short' })

export function InsiderPanel({ data }: { data: InsiderData | null }) {
  const shown = data?.trades.slice(0, 10) ?? []
  const maxValue = Math.max(1, ...shown.map((t) => t.value))
  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        Insider: chi compra e chi vende
        <InfoTip
          label="Come leggere gli insider"
          source="Finnhub (/stock/insider-transactions e /stock/insider-sentiment), dati dei moduli SEC Form 4"
          formula="si contano solo acquisti (P) e vendite (S) sul mercato degli ultimi 6 mesi; sono esclusi regali, premi azionari, opzioni e tasse. “Comprano” se il valore acquistato ≥ valore venduto; “vendono” se le vendite superano il doppio degli acquisti. MSPR: indice mensile da −100 (solo vendite) a +100 (solo acquisti)"
        >
          <strong>Insider = dirigenti e membri del CdA</strong>
          <span>Un acquisto sul mercato con soldi propri è il segnale più forte: chi conosce meglio l’azienda ci scommette.</span>
          <span>Le vendite sono meno significative: spesso servono a pagare tasse o seguono piani programmati. Non è una previsione.</span>
        </InfoTip>
      </h2>

      {!data || data.trades.length === 0 ? (
        <p className={styles.empty}>{data ? 'Nessun acquisto o vendita degli insider negli ultimi 6 mesi.' : 'Dati sugli insider non disponibili al momento.'}</p>
      ) : (
        <>
          <p className={`${styles.mood} ${styles[MOODS[data.summary.mood].tone]}`}>{MOODS[data.summary.mood].label}</p>
          <p className={styles.counts}>
            <span>
              <strong className={styles.gain}>{data.summary.buys}</strong> acquisti · {money(data.summary.buyValue)}
            </span>
            <span>
              <strong className={styles.loss}>{data.summary.sells}</strong> vendite · {money(data.summary.sellValue)}
            </span>
          </p>

          {data.sentiment.length > 0 && (
            <>
              <p className={styles.monthsLabel}>Indice mensile: −100 solo vendite, +100 solo acquisti</p>
              <ul className={styles.months} aria-label="Indice mensile degli insider">
                {data.sentiment.map((m) => (
                  <li key={`${m.year}-${m.month}`} className={`${styles.month} ${m.mspr > 0 ? styles.gain : m.mspr < 0 ? styles.loss : ''}`}>
                    <span>{monthName(m.year, m.month)}</span>
                    <strong>
                      {m.mspr > 0 ? '+' : ''}
                      {Math.round(m.mspr)}
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Insider</th>
                  <th scope="col">Operazione</th>
                  <th scope="col" className={styles.num}>
                    Azioni
                  </th>
                  <th scope="col" className={`${styles.num} ${styles.priceCol}`}>
                    Prezzo medio
                  </th>
                  <th scope="col" className={styles.num}>
                    Valore
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.trades.slice(0, 10).map((t, i) => (
                  <tr key={`${t.name}-${t.date}-${t.side}-${i}`}>
                    <td className={styles.date}>
                      <time dateTime={t.date}>{date(t.date)}</time>
                    </td>
                    <th scope="row" className={styles.who}>
                      {t.name}
                    </th>
                    <td>
                      <span className={`${styles.side} ${t.side === 'buy' ? styles.gainBg : styles.lossBg}`}>{t.side === 'buy' ? 'Acquisto' : 'Vendita'}</span>
                    </td>
                    <td className={styles.num}>{t.shares.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</td>
                    <td className={`${styles.num} ${styles.priceCol}`}>${t.price.toFixed(2)}</td>
                    <td className={`${styles.num} ${styles.valueCell}`}>
                      <span className={styles.bar} aria-hidden="true">
                        <span className={t.side === 'buy' ? styles.barGain : styles.barLoss} style={{ width: `${Math.max(4, (t.value / maxValue) * 100)}%` }} />
                      </span>
                      <span className={styles.valueText}>{money(t.value)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
