import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getMarketBigMovers, BIG_MOVE_THRESHOLD_PCT, type Market, type MarketMover } from '@/lib/market'
import { InfoTip } from '@/components/InfoTip'
import styles from '../section.module.css'
import table from './movimenti.module.css'

function formatMoney(n: number, currency: string): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} mld ${currency}`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} mln ${currency}`
  return `${n.toFixed(0)} ${currency}`
}


const THRESHOLDS = [5, 10, BIG_MOVE_THRESHOLD_PCT]
const MARKETS: Array<{ key: Market; label: string; currency: string }> = [
  { key: 'us', label: 'USA', currency: '$' },
  { key: 'it', label: 'Italia', currency: '€' },
  { key: 'cn', label: 'Cina', currency: '¥' },
]
type Search = { soglia?: string; mercato?: string; ordina?: string; dir?: string }

type SortKey = 'var' | 'sym' | 'price' | 'cap' | 'vol'
const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'var', label: 'Variazione', numeric: true },
  { key: 'sym', label: 'Titolo', numeric: false },
  { key: 'price', label: 'Prezzo', numeric: true },
  { key: 'cap', label: 'Capitalizzazione', numeric: true },
  { key: 'vol', label: 'Volume', numeric: true },
]

function sortValue(m: MarketMover, key: SortKey): number | string {
  switch (key) {
    case 'sym':
      return m.symbol
    case 'price':
      return m.price
    case 'cap':
      return m.marketCap ?? -1
    case 'vol':
      return m.volume ?? -1
    default:
      return Math.abs(m.changePct)
  }
}

function formatVolume(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} mln`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} mila`
  return String(n)
}

async function BigMovers({ searchParams }: { searchParams: Promise<Search> }) {
  await connection()
  const { soglia, mercato, ordina, dir } = await searchParams
  const sortKey: SortKey = COLUMNS.find((c) => c.key === ordina)?.key ?? 'var'
  const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc'
  const market = MARKETS.find((m) => m.key === mercato) ?? MARKETS[0]
  const parsed = Number(soglia)
  const threshold = THRESHOLDS.includes(parsed) ? parsed : BIG_MOVE_THRESHOLD_PCT
  const [watched, marketResult] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true } }),
    getMarketBigMovers(threshold, market.key).then(
      (movers) => ({ movers, failed: false }),
      (err) => {
        console.error('Market movers failed:', err instanceof Error ? err.message : err)
        return { movers: [] as MarketMover[], failed: true }
      }
    ),
  ])
  const watchedSymbols = new Set(watched.map((s) => s.symbol))
  const { failed } = marketResult
  const movers = [...marketResult.movers].sort((a, b) => {
    const x = sortValue(a, sortKey)
    const y = sortValue(b, sortKey)
    const cmp = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
    return sortDir === 'asc' ? cmp : -cmp
  })
  const href = (over: Partial<{ mercato: string; soglia: number; ordina: string; dir: string }>) => {
    const q = new URLSearchParams({ mercato: market.key, soglia: String(threshold), ordina: sortKey, dir: sortDir, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) })
    return `/movimenti?${q.toString()}`
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        Movimenti forti
        <InfoTip
          label="Cos’è questa sezione"
          source="Yahoo Finance, classifiche pubbliche dei titoli che salgono e scendono di più oggi (USA, Borsa Italiana, Shanghai e Shenzhen)"
          formula={`Compare un titolo se la variazione giornaliera è almeno ±${threshold}% e il prezzo è almeno 1 e la capitalizzazione almeno 100 mln (fuori dagli USA)`}
        >
          <strong>Movimenti forti</strong>
          <span>Titoli che oggi hanno guadagnato o perso almeno il {threshold}%, non solo quelli che segui.</span>
          <span>Ho escluso i titoli sotto 1 perché sono quasi sempre rumore e, fuori dagli USA, quelli sotto 100 mln di capitalizzazione (warrant e certificati). La Cina ha un limite giornaliero del 10-20%. Yahoo pubblica solo le sue classifiche dei titoli che salgono e scendono di più, quindi nei giorni tranquilli i risultati sono pochi.</span>
        </InfoTip>
      </h2>
      <p className={styles.lead}>Titoli di tutto il mercato ({market.label}) che oggi si sono mossi di almeno il {threshold}%. Quelli in watchlist sono segnati.</p>
      <div className={table.filters}>
        <nav className={table.group} aria-label="Mercato">
          {MARKETS.map((m) => (
            <Link key={m.key} href={href({ mercato: m.key })} aria-current={m.key === market.key ? 'page' : undefined}>
              {m.label}
            </Link>
          ))}
        </nav>
        <nav className={table.group} aria-label="Soglia di variazione">
          {THRESHOLDS.map((t) => (
            <Link key={t} href={href({ soglia: t })} aria-current={t === threshold ? 'page' : undefined}>
              ±{t}%
            </Link>
          ))}
        </nav>
      </div>
      {failed ? (
        <p className={styles.empty}>Non riesco a scaricare le classifiche del mercato in questo momento. Riprova tra qualche minuto.</p>
      ) : movers.length === 0 ? (
        <p className={styles.empty}>Oggi nessun titolo ha superato ±{threshold}%. Prova una soglia più bassa.</p>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const active = c.key === sortKey
                  const nextDir = active && sortDir === 'desc' ? 'asc' : 'desc'
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? table.num : undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <Link href={href({ ordina: c.key, dir: c.key === 'sym' && !active ? 'asc' : nextDir })} className={table.sort} data-active={active || undefined}>
                        {c.label}
                        <span aria-hidden="true" className={table.arrow}>
                          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </Link>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {movers.map((m) => (
                <tr key={m.symbol}>
                  <td className={`${table.num} ${m.changePct >= 0 ? styles.gain : styles.loss}`}>
                    {m.changePct >= 0 ? '+' : '−'}
                    {Math.abs(m.changePct).toFixed(2)}%
                  </td>
                  <td>
                    <Link href={`/stock/${encodeURIComponent(m.symbol)}`} className={table.symbol}>
                      {m.symbol}
                    </Link>
                    <span className={table.name}>
                      {m.name}
                      {watchedSymbols.has(m.symbol) ? ' · in watchlist' : ''}
                    </span>
                  </td>
                  <td className={table.num}>
                    {market.currency}
                    {m.price.toFixed(2)}
                  </td>
                  <td className={table.num}>{m.marketCap ? formatMoney(m.marketCap, market.currency) : '–'}</td>
                  <td className={table.num}>{m.volume ? formatVolume(m.volume) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function MoversPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Movimenti forti</h1>
      <Suspense fallback={<p className={styles.empty}>Carico i movimenti…</p>}>
        <BigMovers searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
