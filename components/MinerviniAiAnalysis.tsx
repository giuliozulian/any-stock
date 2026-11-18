'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AiResult, Outcome, Verdict } from '@/lib/minervini-ai'
import styles from './MinerviniAiAnalysis.module.css'

const VERDICT: Record<Verdict, { title: string; tone: 'gain' | 'warn' | 'loss' }> = {
  ready: { title: 'Setup in linea con il metodo', tone: 'gain' },
  wait: { title: 'Da attendere', tone: 'warn' },
  no: { title: 'Setup non in linea', tone: 'loss' },
}

const OUTCOME: Record<Outcome, string> = {
  met: 'Soddisfatto',
  not_met: 'Non soddisfatto',
  not_assessable: 'Non valutabile',
}

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: AiResult } | { kind: 'error' }

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className={styles.block}>
      <h4 className={styles.blockTitle}>{title}</h4>
      <ul className={styles.list}>
        {items.map((t, i) => (
          <li key={`${i}-${t}`}>{t}</li>
        ))}
      </ul>
    </section>
  )
}

async function fetchState(symbol: string): Promise<State> {
  try {
    const res = await fetch(`/api/minervini-ai/${encodeURIComponent(symbol)}`, { method: 'POST' })
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as { result: AiResult }
    return { kind: 'done', result: body.result }
  } catch {
    return { kind: 'error' }
  }
}

export function MinerviniAiAnalysis({ symbol, autoStart = false }: { symbol: string; autoStart?: boolean }) {
  const [state, setState] = useState<State>({ kind: autoStart ? 'loading' : 'idle' })

  const run = useCallback(() => {
    setState({ kind: 'loading' })
    void fetchState(symbol).then(setState)
  }, [symbol])

  useEffect(() => {
    if (!autoStart) return
    let cancelled = false
    void fetchState(symbol).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [autoStart, symbol])

  if (state.kind === 'idle') {
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.button} onClick={run}>
          Analisi AI
        </button>
        <p className={styles.muted}>Valutazione del setup secondo il metodo di Minervini. Non è consulenza finanziaria.</p>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className={styles.wrap} role="status" aria-label="Analisi in corso">
        <div className={`${styles.sk} ${styles.skTitle}`} />
        <div className={`${styles.sk} ${styles.skLine}`} />
        <div className={`${styles.sk} ${styles.skLine}`} />
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.wrap}>
        <p className={styles.muted}>Analisi AI non disponibile. Resta il pannello a regole qui sopra.</p>
        <button type="button" className={styles.button} onClick={run}>
          Riprova
        </button>
      </div>
    )
  }

  const { result } = state
  const v = VERDICT[result.verdict]
  return (
    <section className={styles.wrap} data-tone={v.tone} aria-label="Analisi AI">
      <h3 className={styles.title}>{v.title}</h3>
      {result.adjusted && <p className={styles.muted}>Verdetto abbassato: i numeri non soddisfano tutti i controlli del Trend Template o manca una base pronta.</p>}
      <p className={styles.summary}>{result.summary}</p>
      <ul className={styles.criteria}>
        {result.criteria.map((c, i) => (
          <li key={`${i}-${c.ruleId}`} className={styles.criterion} data-outcome={c.outcome}>
            <span className={styles.ruleId}>{c.ruleId}</span>
            <span className={styles.outcome}>{OUTCOME[c.outcome]}</span>
            <span className={styles.note}>{c.note}</span>
          </li>
        ))}
      </ul>
      <List title="Cosa manca" items={result.missing} />
      <List title="Rischi" items={result.risks} />
      <List title="Non coperto dalle regole" items={result.uncovered} />
      <p className={styles.muted}>Valutazione del setup secondo il metodo di Minervini. Non è consulenza finanziaria.</p>
    </section>
  )
}
