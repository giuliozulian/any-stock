'use client'

import { useCallback, useSyncExternalStore } from 'react'

interface LiveQuote {
  price: number
  changePct: number
  at: number
}

const POLL_MS = 30_000

let quotes: Record<string, LiveQuote> = {}
const listeners = new Map<() => void, string | string[] | null>()
let timer: ReturnType<typeof setInterval> | null = null

function symbolsInUse(): string[] {
  return [...new Set([...listeners.values()].flat().filter((s): s is string => !!s))]
}

let lastPoll = 0

async function poll(): Promise<void> {
  const symbols = symbolsInUse()
  if (symbols.length === 0 || document.visibilityState !== 'visible') return
  // Many components subscribe at once on mount; collapse them into one request
  if (Date.now() - lastPoll < 5_000) return
  lastPoll = Date.now()
  try {
    const res = await fetch(`/api/quotes?symbols=${symbols.join(',')}`, { cache: 'no-store' })
    if (!res.ok) return
    const data: { quotes: Record<string, { price: number; changePct: number }>; at: number } = await res.json()
    const next = { ...quotes }
    for (const [symbol, q] of Object.entries(data.quotes)) next[symbol] = { ...q, at: data.at }
    quotes = next
    listeners.forEach((_, notify) => notify())
  } catch {
    // keep the last known value; the next tick retries
  }
}

function subscribe(symbol: string | string[] | null, notify: () => void): () => void {
  listeners.set(notify, symbol)
  if (!timer) {
    timer = setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', poll)
  }
  setTimeout(poll, 50)
  return () => {
    listeners.delete(notify)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', poll)
    }
  }
}

export function useLiveQuote(symbol: string | null): LiveQuote | null {
  // Stable subscribe identity: a new function per render would resubscribe (and refetch) in a loop
  const sub = useCallback((notify: () => void) => subscribe(symbol, notify), [symbol])
  return useSyncExternalStore(
    sub,
    () => (symbol ? (quotes[symbol] ?? null) : null),
    () => null
  )
}

export function useLiveQuotes(symbols: string[]): Record<string, LiveQuote> {
  const key = symbols.join(',')
  const sub = useCallback((notify: () => void) => subscribe(key ? key.split(',') : null, notify), [key])
  return useSyncExternalStore(sub, () => quotes, () => EMPTY_QUOTES)
}

const EMPTY_QUOTES: Record<string, LiveQuote> = {}

export function useLivePrice(symbol: string | null, initial: number): number {
  return useLiveQuote(symbol)?.price ?? initial
}

export interface Tones {
  gain: string
  loss: string
  flat: string
}

export const toneOf = (n: number | null, tones: Tones) => (n === null || n === 0 ? tones.flat : n > 0 ? tones.gain : tones.loss)
export const signedPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`

export function LivePrice({ symbol, initial }: { symbol: string; initial: number }) {
  return <>${useLivePrice(symbol, initial).toFixed(2)}</>
}

export function LiveChange({ symbol, initial, tones, className = '' }: { symbol: string; initial: number; tones: Tones; className?: string }) {
  const pct = useLiveQuote(symbol)?.changePct ?? initial
  return <span className={`${className} ${toneOf(pct, tones)}`.trim()}>{signedPct(pct)}</span>
}

export function LiveSince({ symbol, entryPrice, initialPrice, tones }: { symbol: string; entryPrice: number | null; initialPrice: number | null; tones: Tones }) {
  const price = useLiveQuote(symbol)?.price ?? initialPrice
  const pct = entryPrice && entryPrice > 0 && price !== null ? ((price - entryPrice) / entryPrice) * 100 : null
  return <span className={toneOf(pct, tones)}>{pct === null ? '—' : signedPct(pct)}</span>
}

export function LiveCounts({ items, labels }: { items: { symbol: string; entryPrice: number | null; price: number | null }[]; labels: { gainClass: string; lossClass: string; kpi: string; kpiLabel: string; kpiValue: string; kpiNote: string } }) {
  const live = useLiveQuotes(items.map((i) => i.symbol))
  let gaining = 0
  let losing = 0
  for (const i of items) {
    const price = live[i.symbol]?.price ?? i.price
    if (!i.entryPrice || i.entryPrice <= 0 || price === null) continue
    const pct = ((price - i.entryPrice) / i.entryPrice) * 100
    if (pct > 0) gaining++
    else if (pct < 0) losing++
  }
  return (
    <>
      <div className={labels.kpi}>
        <span className={labels.kpiLabel}>In guadagno</span>
        <span className={`${labels.kpiValue} ${labels.gainClass}`}>{gaining}</span>
        <span className={labels.kpiNote}>da quando li segui</span>
      </div>
      <div className={labels.kpi}>
        <span className={labels.kpiLabel}>In perdita</span>
        <span className={`${labels.kpiValue} ${labels.lossClass}`}>{losing}</span>
        <span className={labels.kpiNote}>da quando li segui</span>
      </div>
    </>
  )
}

export function LiveStamp({ symbol, fallback }: { symbol: string; fallback: string }) {
  const quote = useLiveQuote(symbol)
  if (!quote) return <>{fallback}</>
  return <>Live · {new Date(quote.at).toLocaleTimeString('it-IT')}</>
}
