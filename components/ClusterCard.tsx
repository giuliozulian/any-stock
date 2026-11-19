import { Suspense } from 'react'
import Link from 'next/link'
import type { MarketCluster } from '@/lib/insider-clusters'
import { capBucket } from '@/lib/insider-clusters'
import { ClusterNote } from './ClusterNote'
import panel from './ClusterPanel.module.css'
import styles from './ClusterCard.module.css'

const money = (v: number) => (v >= 1_000_000_000 ? `$${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`)
const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const CAP_LABEL = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' } as const

export function ClusterCard({ item, withNote = true }: { item: MarketCluster; withNote?: boolean }) {
  const { cluster } = item
  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.name}>
          <Link href={`/stock/${encodeURIComponent(item.symbol)}`}>{item.name}</Link>
          <span className={styles.sub}>
            {item.symbol} · {CAP_LABEL[capBucket(item.marketCap)]} {money(item.marketCap)} · dal {date(cluster.from)} al {date(cluster.to)}
          </span>
        </h2>
        <span className={styles.score} aria-label={`Punteggio ${cluster.score} su 100`}>
          {cluster.score}
        </span>
      </div>
      <p className={styles.stats}>
        <span>
          <strong>{cluster.insiders}</strong> insider
        </span>
        <span>
          <strong>{cluster.purchases}</strong> acquisti
        </span>
        <span>
          Totale <strong>{money(cluster.total)}</strong>
        </span>
        <span>
          Il più grosso <strong>{money(cluster.lead.value)}</strong> · {cluster.lead.name}
          {cluster.lead.role ? ` (${cluster.lead.role})` : ''}
        </span>
      </p>
      {withNote && (
        <Suspense fallback={null}>
          <ClusterNote symbol={item.symbol} name={item.name} marketCap={item.marketCap} cluster={cluster} />
        </Suspense>
      )}
      <details className={styles.details}>
        <summary>Vedi i {cluster.purchases} acquisti</summary>
        <div className={panel.tableWrap}>
          <table className={panel.table}>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Insider</th>
                <th scope="col">Ruolo</th>
                <th scope="col" className={panel.num}>
                  Azioni
                </th>
                <th scope="col" className={panel.num}>
                  Prezzo
                </th>
                <th scope="col" className={panel.num}>
                  Valore
                </th>
              </tr>
            </thead>
            <tbody>
              {cluster.trades.map((t, i) => (
                <tr key={`${t.name}-${t.date}-${i}`}>
                  <td className={panel.muted}>
                    <time dateTime={t.date}>{date(t.date)}</time>
                  </td>
                  <th scope="row" className={panel.who}>
                    {t.name}
                  </th>
                  <td className={panel.muted}>{t.role ?? '—'}</td>
                  <td className={panel.num}>{t.shares.toLocaleString('it-IT', { maximumFractionDigits: 0 })}</td>
                  <td className={panel.num}>${t.price.toFixed(2)}</td>
                  <td className={panel.num}>{money(t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  )
}
