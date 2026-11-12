import type { CongressTrade } from '@/lib/congress'
import { InfoTip } from './InfoTip'
import styles from './InsiderPanel.module.css'

const date = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
const short = (v: number) => (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v))
const range = (t: CongressTrade) => (t.amountHigh > 0 ? `$${short(t.amountLow)} – $${short(t.amountHigh)}` : '—')

export function CongressPanel({ trades }: { trades: CongressTrade[] | null }) {
  const shown = trades?.slice(0, 25) ?? []
  const buys = trades?.filter((t) => t.side === 'buy').length ?? 0
  const sells = (trades?.length ?? 0) - buys

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        Politici americani: chi compra e chi vende
        <InfoTip
          label="Come leggere le operazioni dei politici"
          source="Financial Modeling Prep (storico completo, se configurata) oppure Bargo (API gratuita, ultimi ~3 mesi), che raccolgono le dichiarazioni obbligatorie (STOCK Act) di deputati e senatori USA alla House Clerk e al Senate eFD"
          formula="solo acquisti e vendite (le 25 più recenti); le operazioni identiche ripetute sono contate una volta. Gli importi sono fasce, non cifre esatte; le dichiarazioni arrivano con un ritardo fino a 45 giorni"
        >
          <strong>Operazioni dei membri del Congresso</strong>
          <span>Deputati e senatori devono dichiarare le loro operazioni in titoli entro 45 giorni. L’importo è una fascia (ad esempio $1k – $15k).</span>
          <span>Il dato è in ritardo e non dice perché hanno comprato o venduto: è uno spunto, non una previsione.</span>
        </InfoTip>
      </h2>

      {trades === null ? (
        <p className={styles.empty}>Dati sui politici non disponibili al momento.</p>
      ) : trades.length === 0 ? (
        <p className={styles.empty}>Nessuna operazione di politici dichiarata.</p>
      ) : (
        <>
          <p className={styles.counts}>
            <span>
              <strong className={styles.gain}>{buys}</strong> acquisti
            </span>
            <span>
              <strong className={styles.loss}>{sells}</strong> vendite
            </span>
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Operazione del</th>
                  <th scope="col">Politico</th>
                  <th scope="col">Operazione</th>
                  <th scope="col" className={styles.num}>
                    Importo
                  </th>
                  <th scope="col" className={`${styles.num} ${styles.priceCol}`}>
                    Pubblicata il
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t, i) => (
                  <tr key={`${t.member}-${t.date}-${t.side}-${i}`}>
                    <td className={styles.date}>
                      <time dateTime={t.date}>{date(t.date)}</time>
                    </td>
                    <th scope="row" className={styles.who}>
                      {t.member}
                      <span className={styles.sub}>
                        {t.chamber === 'senate' ? 'Senato' : 'Camera'}
                        {t.state ? ` · ${t.state}` : ''}
                      </span>
                    </th>
                    <td>
                      <span className={`${styles.side} ${t.side === 'buy' ? styles.gainBg : styles.lossBg}`}>{t.side === 'buy' ? 'Acquisto' : 'Vendita'}</span>
                    </td>
                    <td className={styles.num}>{range(t)}</td>
                    <td className={`${styles.num} ${styles.priceCol} ${styles.date}`}>{t.disclosedAt ? date(t.disclosedAt) : '—'}</td>
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
