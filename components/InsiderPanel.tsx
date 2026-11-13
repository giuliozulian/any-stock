'use client'

import { useState } from 'react'
import type { InsiderData } from '@/lib/insider-data'
import { daysAgoISO, summarizeTrades } from '@/lib/insiders'
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

const RANGES = [
  { key: '6M', label: '6 mesi', days: 183 },
  { key: '1Y', label: '1 anno', days: 365 },
  { key: '3Y', label: '3 anni', days: 1095 },
  { key: 'ALL', label: 'Tutto', days: null },
] as const
const SIDES = [
  { key: 'all', label: 'Tutte' },
  { key: 'buy', label: 'Acquisti' },
  { key: 'sell', label: 'Vendite' },
] as const
const PAGE_SIZE = 25

export function InsiderPanel({ data }: { data: InsiderData | null }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('ALL')
  const [side, setSide] = useState<(typeof SIDES)[number]['key']>('all')
  const [page, setPage] = useState(0)
  const days = RANGES.find((r) => r.key === range)!.days
  const since = days === null ? '' : daysAgoISO(days)
  const trades = (data?.trades ?? []).filter((t) => t.date >= since)
  const summary = summarizeTrades(trades)
  const visible = side === 'all' ? trades : trades.filter((t) => t.side === side)
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const maxValue = Math.max(1, ...shown.map((t) => t.value))
  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        Insider: chi compra e chi vende
        <InfoTip
          label="Come leggere gli insider"
          source="Finnhub (/stock/insider-transactions e /stock/insider-sentiment), dati dei moduli SEC Form 4"
          formula="si contano solo acquisti (P) e vendite (S) sul mercato, ogni deposito è una riga, ultimi 10 anni; ruolo letto dall’ultimo Form 4 dell’insider su SEC EDGAR; sono esclusi regali, premi azionari, opzioni e tasse. “Comprano” se il valore acquistato ≥ valore venduto; “vendono” se le vendite superano il doppio degli acquisti. MSPR: indice mensile da −100 (solo vendite) a +100 (solo acquisti)"
        >
          <strong>Insider = dirigenti e membri del CdA</strong>
          <span>Un acquisto sul mercato con soldi propri è il segnale più forte: chi conosce meglio l’azienda ci scommette.</span>
          <span>Le vendite sono meno significative: spesso servono a pagare tasse o seguono piani programmati. Non è una previsione.</span>
        </InfoTip>
      </h2>

      {!data || data.trades.length === 0 ? (
        <p className={styles.empty}>{data ? 'Nessun acquisto o vendita degli insider negli ultimi 10 anni.' : 'Dati sugli insider non disponibili al momento.'}</p>
      ) : (
        <>
          <div className={styles.ranges} role="group" aria-label="Periodo">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={styles.range}
                aria-pressed={range === r.key}
                onClick={() => {
                  setRange(r.key)
                  setPage(0)
                }}
              >
                {r.label}
              </button>
            ))}
            <span className={styles.rangesGap} aria-hidden="true" />
            {SIDES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={styles.range}
                aria-pressed={side === s.key}
                onClick={() => {
                  setSide(s.key)
                  setPage(0)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className={`${styles.mood} ${styles[MOODS[summary.mood].tone]}`}>{MOODS[summary.mood].label}</p>
          <p className={styles.counts}>
            <span>
              <strong className={styles.gain}>{summary.buys}</strong> acquisti · {money(summary.buyValue)}
            </span>
            <span>
              <strong className={styles.loss}>{summary.sells}</strong> vendite · {money(summary.sellValue)}
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
                  <th scope="col" className={styles.roleCol}>
                    Ruolo
                  </th>
                  <th scope="col">Operazione</th>
                  <th scope="col" className={styles.num}>
                    Azioni
                  </th>
                  <th scope="col" className={`${styles.num} ${styles.priceCol}`}>
                    Prezzo
                  </th>
                  <th scope="col" className={styles.num}>
                    Valore
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t, i) => (
                  <tr key={`${t.name}-${t.date}-${t.side}-${i}`}>
                    <td className={styles.date}>
                      <time dateTime={t.date}>{date(t.date)}</time>
                    </td>
                    <th scope="row" className={styles.who}>
                      {t.name}
                    </th>
                    <td className={styles.roleCol}>{t.role ?? '—'}</td>
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
          <div className={styles.pager}>
            <span>{visible.length === 0 ? 'Nessuna operazione nel periodo' : `${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + shown.length} di ${visible.length} operazioni`}</span>
            {pages > 1 && (
              <span className={styles.pagerBtns}>
                <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Precedenti
                </button>
                <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Successive
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
