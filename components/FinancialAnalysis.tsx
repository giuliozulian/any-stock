import type { YearFinancials } from '@/lib/fundamentals'
import { altmanZ, piotroskiF, type AltmanZone } from '@/lib/solidity'
import { InfoTip } from './InfoTip'
import styles from './FinancialAnalysis.module.css'

const compact = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  return `${sign}$${abs.toFixed(0)}`
}

const METRICS: Array<{ key: keyof YearFinancials; title: string; format: (v: number) => string }> = [
  { key: 'revenue', title: 'Ricavi', format: compact },
  { key: 'netIncome', title: 'Utile netto', format: compact },
  { key: 'eps', title: 'Utile per azione', format: (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}` },
  { key: 'operatingCashFlow', title: 'Cassa generata dalla gestione', format: compact },
]

const ZONES: Record<AltmanZone, { label: string; text: string; tone: string }> = {
  safe: { label: 'Zona sicura', text: 'Rischio di dissesto basso nei prossimi due anni, secondo il modello.', tone: 'gain' },
  grey: { label: 'Zona grigia', text: 'Situazione incerta: il modello non esclude difficoltà finanziarie.', tone: 'flat' },
  distress: { label: 'Zona di rischio', text: 'Il modello segnala un rischio elevato di difficoltà finanziarie.', tone: 'loss' },
}

function piotroskiTone(score: number) {
  return score >= 7 ? 'gain' : score >= 4 ? 'flat' : 'loss'
}

function Highlights({ years }: { years: YearFinancials[] }) {
  const recent = years.slice(-5)
  return (
    <div className={styles.metrics}>
      {METRICS.map((m) => {
        const values = recent.map((y) => y[m.key] as number | null)
        const maxAbs = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1e-9)
        return (
          <figure key={m.key} className={styles.metric}>
            <figcaption className={styles.metricTitle}>{m.title}</figcaption>
            <div className={styles.bars}>
              {recent.map((y, i) => {
                const v = values[i]
                return (
                  <div key={y.year} className={styles.barCol}>
                    <span className={styles.barValue}>{v === null ? '—' : m.format(v)}</span>
                    <span className={styles.barTrack}>
                      {v !== null && <span className={`${styles.bar} ${v < 0 ? styles.neg : styles.pos}`} style={{ height: `${Math.max(3, (Math.abs(v) / maxAbs) * 100)}%` }} />}
                    </span>
                    <span className={styles.barYear}>{y.year}</span>
                  </div>
                )
              })}
            </div>
          </figure>
        )
      })}
    </div>
  )
}

export function FinancialAnalysis({ years, marketCapMillions }: { years: YearFinancials[]; marketCapMillions: number | null }) {
  if (years.length === 0) return null
  const last = years[years.length - 1]
  const prev = years.length > 1 ? years[years.length - 2] : null
  const altman = altmanZ(last, marketCapMillions === null ? null : marketCapMillions * 1e6)
  const piotroski = prev ? piotroskiF(last, prev) : null

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>
        Analisi dei bilanci
        <InfoTip
          label="Come leggere l’analisi dei bilanci"
          source="Finnhub (/stock/financials-reported): bilanci annuali (modulo 10-K) depositati alla SEC, ultimi 5 anni. Capitalizzazione dall’ultimo aggiornamento"
          formula="Altman Z = 1,2·(capitale circolante/attivi) + 1,4·(utili accumulati/attivi) + 3,3·(utile operativo/attivi) + 0,6·(capitalizzazione/debiti totali) + 1,0·(ricavi/attivi): sopra 2,99 zona sicura, tra 1,81 e 2,99 grigia, sotto 1,81 di rischio. Piotroski F: 9 test sì/no sull’ultimo anno rispetto al precedente (redditività, debito, efficienza); 7-9 solido, 4-6 nella media, 0-3 debole. I test senza dati valgono 0"
        >
          <strong>Bilanci e solidità</strong>
          <span>Le barre mostrano come sono andati negli anni ricavi, utile e cassa. Verde sopra zero, rosso in perdita.</span>
          <span>I due punteggi riassumono la salute finanziaria dell’azienda. Sono modelli statistici classici: non valgono per banche e assicurazioni e non sono una previsione.</span>
        </InfoTip>
      </h2>
      <p className={styles.hint}>Dati annuali dichiarati alla SEC, ultimi {Math.min(5, years.length)} anni.</p>

      <Highlights years={years} />

      <div className={styles.scores}>
        <div className={styles.score}>
          <h3 className={styles.scoreTitle}>Rischio di dissesto (Altman Z)</h3>
          {altman ? (
            <>
              <p className={`${styles.scoreValue} ${styles[ZONES[altman.zone].tone]}`}>
                {altman.score.toFixed(1)}
                <span className={styles.scoreLabel}>{ZONES[altman.zone].label}</span>
              </p>
              <p className={styles.scoreText}>{ZONES[altman.zone].text}</p>
            </>
          ) : (
            <p className={styles.scoreText}>Dati insufficienti per calcolarlo su questo titolo.</p>
          )}
        </div>

        <div className={styles.score}>
          <h3 className={styles.scoreTitle}>Qualità dei conti (Piotroski F)</h3>
          {piotroski ? (
            <>
              <p className={`${styles.scoreValue} ${styles[piotroskiTone(piotroski.score)]}`}>
                {piotroski.score}
                <span className={styles.scoreLabel}>su 9 test superati</span>
              </p>
              <ul className={styles.checks}>
                {piotroski.checks.map((c) => (
                  <li key={c.label} className={c.passed ? styles.ok : styles.ko}>
                    <span aria-hidden="true">{c.passed ? '✓' : '✗'}</span>
                    <span className={styles.srOnly}>{c.passed ? 'Superato: ' : 'Non superato: '}</span>
                    {c.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.scoreText}>Serve almeno un secondo anno di bilancio.</p>
          )}
        </div>
      </div>
    </section>
  )
}
