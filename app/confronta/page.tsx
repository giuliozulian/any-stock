import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { parseCompareSymbols, selectComparableStocks } from '@/lib/compare'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import { FairValueCard } from '@/components/FairValueCard'
import { FinancialAnalysis } from '@/components/FinancialAnalysis'
import { InsightPanel } from '@/components/InsightPanel'
import styles from './page.module.css'

function EmptyState() {
  return <p className={styles.empty}>Seleziona almeno 2 titoli dalla watchlist.</p>
}

function changeTone(pct: number): string {
  return pct > 0 ? styles.gain : pct < 0 ? styles.loss : ''
}

async function Comparison({ searchParams }: { searchParams: Promise<{ symbols?: string }> }) {
  await connection()
  const { symbols: raw } = await searchParams
  const symbols = parseCompareSymbols(raw)
  if (symbols.length < 2) return <EmptyState />

  const stocks = await selectComparableStocks(symbols)
  if (stocks.length < 2) return <EmptyState />

  const columns = `repeat(${stocks.length}, 1fr)`

  return (
    <>
      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, latest }) => (
          <div key={stock.symbol} className={styles.header}>
            <p className={styles.symbol}>{stock.symbol}</p>
            <p className={styles.name}>{stock.name}</p>
            <p className={styles.price}>{latest ? `$${latest.price.toFixed(2)}` : '—'}</p>
            {latest && (
              <p className={`${styles.change} ${changeTone(latest.changePct)}`}>
                {latest.changePct >= 0 ? '+' : '−'}
                {Math.abs(latest.changePct).toFixed(2)}%
              </p>
            )}
          </div>
        ))}
      </section>

      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, evaluation }) => (
          <div key={stock.symbol}>{evaluation && <EvaluationPanel evaluation={evaluation} />}</div>
        ))}
      </section>

      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, fairValueInput, altman }) => (
          <div key={stock.symbol}>{fairValueInput && <FairValueCard embedded input={fairValueInput} altman={altman} />}</div>
        ))}
      </section>

      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, financials, latest }) => (
          <div key={stock.symbol}>
            <FinancialAnalysis years={financials} marketCapMillions={latest?.marketCap ?? null} />
          </div>
        ))}
      </section>

      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, insight }) => (
          <div key={stock.symbol}>{insight && <InsightPanel insight={insight} />}</div>
        ))}
      </section>
    </>
  )
}

export default function ComparePage({ searchParams }: { searchParams: Promise<{ symbols?: string }> }) {
  return (
    <main className={styles.shell}>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>
      <h1 className={styles.title}>Confronto titoli</h1>
      <Suspense fallback={<p className={styles.empty}>Carico il confronto…</p>}>
        <Comparison searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
