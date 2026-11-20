import type { EarningsHistoryRow } from '@/lib/finnhub'
import { surprise } from '@/lib/earnings'
import styles from './EarningsHistoryPanel.module.css'

const HOURS: Record<string, string> = { bmo: 'prima dell’apertura', dmh: 'durante la seduta', amc: 'dopo la chiusura' }

const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function money(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} mld`
  return `${(n / 1e6).toFixed(0)} mln`
}

const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`
const tone = (v: 'beat' | 'miss' | 'inline' | undefined) => (v === 'beat' ? 'gain' : v === 'miss' ? 'loss' : undefined)

function Result({ actual, estimate, format }: { actual: number | null; estimate: number | null; format: (n: number) => string }) {
  const s = surprise(actual, estimate)
  return (
    <>
      <td>{actual === null ? '–' : format(actual)}</td>
      <td className={styles.muted}>{estimate === null ? '–' : format(estimate)}</td>
      <td data-tone={tone(s?.verdict)}>{s?.pct != null ? pct(s.pct) : '–'}</td>
    </>
  )
}

export function EarningsHistoryPanel({ rows, today }: { rows: EarningsHistoryRow[] | null; today: string }) {
  if (rows === null) return <p className={styles.empty}>Dati sulle trimestrali non disponibili al momento.</p>
  if (rows.length === 0) return <p className={styles.empty}>Nessuna trimestrale trovata per questo titolo. Il calendario copre soprattutto le aziende USA.</p>

  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-labelledby="earnings-history-title">
        <h2 id="earnings-history-title" className={styles.title}>
          Storico delle trimestrali
        </h2>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Data
                </th>
                <th scope="col" rowSpan={2}>
                  Periodo
                </th>
                <th scope="colgroup" colSpan={3}>
                  EPS
                </th>
                <th scope="colgroup" colSpan={3}>
                  Ricavi
                </th>
              </tr>
              <tr>
                <th scope="col">Reale</th>
                <th scope="col">Atteso</th>
                <th scope="col">Diff.</th>
                <th scope="col">Reali</th>
                <th scope="col">Attesi</th>
                <th scope="col">Diff.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.year}-${r.quarter}-${r.date}-${r.period}`} data-upcoming={r.date && r.date > today && r.epsActual === null ? '' : undefined}>
                  <th scope="row" title={r.hour ? HOURS[r.hour] : undefined}>
                    {r.date ? date(r.date) : '–'}
                  </th>
                  <td>{r.quarter && r.year ? `T${r.quarter} ${r.year}` : r.period ? date(r.period) : '–'}</td>
                  <Result actual={r.epsActual} estimate={r.epsEstimate} format={(n) => n.toFixed(2)} />
                  <Result actual={r.revenueActual} estimate={r.revenueEstimate} format={money} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className={styles.note}>EPS per azione e ricavi in dollari. «Diff.» è lo scarto percentuale tra dato reale e stima degli analisti; le righe evidenziate sono le prossime uscite. Per i trimestri meno recenti il fornitore non indica data e ricavi. Fonte: Finnhub.</p>
    </div>
  )
}
