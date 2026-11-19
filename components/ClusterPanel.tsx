import type { InsiderCluster } from '@/lib/insiders'
import { InfoTip } from './InfoTip'
import styles from './ClusterPanel.module.css'

const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`)
const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function ClusterPanel({ cluster }: { cluster: InsiderCluster | null }) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          Cluster di acquisti degli insider
          <InfoTip
            label="Come leggere il cluster"
            source="Finnhub (dati dei moduli SEC Form 4), ruolo letto da SEC EDGAR"
            formula="acquisti sul mercato (P) dei 7 giorni che finiscono con l’ultimo acquisto, se almeno 2 insider diversi hanno comprato e l’ultimo è di meno di 30 giorni fa. Punteggio 0-100 nostro: fino a 40 per il denaro (da circa 30k a 3M $), 25 per il numero di insider, 20 per il ruolo (CEO/CFO/presidente), 15 per quanto è recente"
          >
            <strong>Più persone che comprano insieme pesa più di una sola</strong>
            <span>Quando dirigenti e consiglieri diversi comprano azioni con soldi propri negli stessi giorni, il segnale è più forte di un acquisto isolato.</span>
            <span>Il punteggio è una nostra stima, non una previsione.</span>
          </InfoTip>
        </h2>
        {cluster && (
          <span className={styles.score}>
            <strong>{cluster.score}</strong>/100
          </span>
        )}
      </div>

      {!cluster ? (
        <p className={styles.empty}>Nessun cluster recente: servono almeno 2 insider che comprano nello stesso periodo, con l’ultimo acquisto negli ultimi 30 giorni.</p>
      ) : (
        <>
          <p className={styles.window}>
            Dal {date(cluster.from)} al {date(cluster.to)}
          </p>
          <div className={styles.stats}>
            <div className={styles.stat}>
              Insider
              <strong>{cluster.insiders}</strong>
            </div>
            <div className={styles.stat}>
              Acquisti
              <strong>{cluster.purchases}</strong>
            </div>
            <div className={styles.stat}>
              Totale
              <strong>{money(cluster.total)}</strong>
            </div>
            <div className={styles.stat}>
              Il più grosso
              <strong>{money(cluster.lead.value)}</strong>
              <small>
                {cluster.lead.name}
                {cluster.lead.role ? ` · ${cluster.lead.role}` : ''}
              </small>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Insider</th>
                  <th scope="col">Ruolo</th>
                  <th scope="col" className={styles.num}>
                    Azioni
                  </th>
                  <th scope="col" className={styles.num}>
                    Prezzo
                  </th>
                  <th scope="col" className={styles.num}>
                    Valore
                  </th>
                </tr>
              </thead>
              <tbody>
                {cluster.trades.map((t, i) => (
                  <tr key={`${t.name}-${t.date}-${i}`}>
                    <td className={styles.muted}>
                      <time dateTime={t.date}>{date(t.date)}</time>
                    </td>
                    <th scope="row" className={styles.who}>
                      {t.name}
                    </th>
                    <td className={styles.muted}>{t.role ?? '—'}</td>
                    <td className={styles.num}>{t.shares.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</td>
                    <td className={styles.num}>${t.price.toFixed(2)}</td>
                    <td className={styles.num}>{money(t.value)}</td>
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
