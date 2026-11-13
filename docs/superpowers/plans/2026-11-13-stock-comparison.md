# Confronto titoli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dalla watchlist, selezionare 2-4 titoli con checkbox e vederli affiancati in una pagina `/confronta` su Evaluation, Fair Value, Solidità e Insight LLM, riusando i componenti già esistenti della pagina detail.

**Architecture:** Un nuovo modulo `lib/compare.ts` espone `parseCompareSymbols` (parsing/clamping puro della query string) e `loadComparisonStock` (carica dati di un singolo titolo già in watchlist, stesso sottoinsieme di query/chiamate della pagina detail). Un nuovo componente client `components/CompareSelection.tsx` gestisce la selezione via Context e naviga a `/confronta?symbols=...`. La nuova pagina `app/confronta/page.tsx` chiama `loadComparisonStock` in parallelo per ogni simbolo e renderizza una griglia CSS, una riga per sezione, riusando `EvaluationPanel`, `FairValueCard`, `FinancialAnalysis`, `InsightPanel` senza modificarli.

**Tech Stack:** Next.js 16 (App Router, React Server Components), Prisma 7 + Postgres, vitest + Testing Library, TypeScript senza punto e virgola / apici singoli (stile esistente in `lib/` e `components/`).

**Spec:** `docs/superpowers/specs/2026-11-13-stock-comparison-design.md`

## Global Constraints

- Nessuna nuova fonte dati o formula: riuso esclusivo di `evaluateStock` (`lib/evaluate.ts`), `altmanZ` (`lib/solidity.ts`), `getAnnualFinancials` (`lib/fundamentals.ts`), `getMetrics` (`lib/finnhub.ts`), e dei componenti `EvaluationPanel`, `FairValueCard`, `FinancialAnalysis`, `InsightPanel`.
- Nessuna sezione News/Insider/Video/AnalystTrendChart nel confronto.
- Massimo 4 titoli, minimo 2; simboli non in watchlist scartati in silenzio.
- Nessun refresh forzato: solo lettura di dati già in DB/cache, nessuna chiamata LLM durante il render.
- Testi UI in italiano, stesso linguaggio visivo esistente (CSS Modules, variabili `--rule`/`--brass`, font Geist) — nessun nuovo design token.
- Stile codice: niente punto e virgola, apici singoli, 2 spazi (come `lib/evaluate.ts`, `components/EvaluationPanel.tsx`).
- Test di integrazione (`lib/compare.ts`) richiedono il Postgres di test: `docker compose -f docker-compose.test.yml up -d` (porta 5433), poi `npx vitest run`.

## Review Focus

- Titolo con un solo snapshot (appena aggiunto) nel confronto: `EvaluationPanel` non deve mostrare since-watching o target price inventati — verificato passando gli stessi input di `evaluateStock` usati dalla pagina detail (incl. `earliestSnapshot: null` quando c'è un solo snapshot).
- Simbolo in query non trovato in watchlist (rimosso, typo, URL salvato vecchio): `loadComparisonStock` ritorna `null` e viene scartato, la pagina non deve rompersi né mostrare una colonna vuota.
- Meno di 2 simboli validi dopo parsing/filtro (0, 1, o tutti non trovati): la pagina mostra il messaggio guida, non una griglia vuota o un errore.
- Più di 4 simboli in query (URL modificato a mano, visto che la UI blocca la selezione a 4): `parseCompareSymbols` fa clamp silenzioso ai primi 4, senza errore.
- Titolo senza `insight` generato (nessuna riga `StockInsight`): la colonna Insight resta vuota (nessun box), non un errore o un placeholder fuorviante — comportamento già garantito da `{insight && <InsightPanel insight={insight} />}` nella pagina detail, va solo replicato.

## File Structure

- Create `lib/compare.ts`: `parseCompareSymbols(raw)`, `ComparisonStock` type, `loadComparisonStock(symbol)`.
- Create `tests/lib/compare.test.ts`.
- Create `components/CompareSelection.tsx` + `components/CompareSelection.module.css`: `CompareSelectionProvider`, `CompareCheckbox`, `CompareBar`.
- Create `tests/components/CompareSelection.test.tsx`.
- Modify `app/page.tsx`: wrap list in `CompareSelectionProvider`, aggiungere `CompareCheckbox` per riga, `CompareBar` dopo la lista.
- Modify `app/page.module.css`: nuova classe `.titleRow` (flex, per affiancare checkbox e link simbolo dentro `.titleCell`).
- Create `app/confronta/page.tsx` + `app/confronta/page.module.css`.

---

### Task 1: `parseCompareSymbols` — parsing e clamping della query string

**Files:**
- Create: `lib/compare.ts`
- Test: `tests/lib/compare.test.ts`

**Interfaces:**
- Produces: `export function parseCompareSymbols(raw: string | string[] | undefined): string[]` — uppercase, dedup, clamp ai primi 4, ignora voci vuote. Usata da Task 5.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/lib/compare.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseCompareSymbols } from '@/lib/compare'

describe('parseCompareSymbols', () => {
  it('uppercases and dedups symbols from a CSV string', () => {
    expect(parseCompareSymbols('aapl,MSFT,aapl')).toEqual(['AAPL', 'MSFT'])
  })

  it('clamps to the first 4 symbols', () => {
    expect(parseCompareSymbols('AAPL,MSFT,GOOGL,NVDA,TSLA')).toEqual(['AAPL', 'MSFT', 'GOOGL', 'NVDA'])
  })

  it('drops empty entries from stray commas', () => {
    expect(parseCompareSymbols('AAPL,,MSFT,')).toEqual(['AAPL', 'MSFT'])
  })

  it('returns an empty array for undefined or empty input', () => {
    expect(parseCompareSymbols(undefined)).toEqual([])
    expect(parseCompareSymbols('')).toEqual([])
  })

  it('takes the first value when Next.js passes a string array (repeated query key)', () => {
    expect(parseCompareSymbols(['AAPL,MSFT', 'GOOGL'])).toEqual(['AAPL', 'MSFT'])
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/lib/compare.test.ts`
Expected: FAIL — `lib/compare.ts` non esiste ancora.

- [ ] **Step 3: Implementare `parseCompareSymbols`**

Creare `lib/compare.ts` con:

```ts
export function parseCompareSymbols(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return []
  const seen = new Set<string>()
  for (const part of value.split(',')) {
    const symbol = part.trim().toUpperCase()
    if (symbol) seen.add(symbol)
    if (seen.size === 4) break
  }
  return [...seen]
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/lib/compare.test.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add lib/compare.ts tests/lib/compare.test.ts
git commit -m "feat: add symbol parsing for stock comparison"
```

---

### Task 2: `loadComparisonStock` — caricamento dati di un titolo

**Files:**
- Modify: `lib/compare.ts` (aggiunge a quanto creato nel Task 1)
- Test: `tests/lib/compare.test.ts` (aggiunge a quanto creato nel Task 1)

**Interfaces:**
- Consumes: `evaluateStock`, `EvaluateInput`, `Evaluation` da `@/lib/evaluate`; `altmanZ`, `AltmanResult` da `@/lib/solidity`; `getAnnualFinancials`, `YearFinancials` da `@/lib/fundamentals`; `getMetrics` da `@/lib/finnhub`; `prisma` da `@/lib/db`.
- Produces: `export interface ComparisonStock { stock: { symbol: string; name: string }; latest: { price: number; changePct: number; marketCap: number | null } | null; evaluation: Evaluation | null; fairValueInput: { price: number; epsTTM: number | null; bookValuePerShare: number | null; cashFlowPerShare: number | null; epsGrowth5Y: number | null; dividendYield: number | null } | null; altman: AltmanResult | null; financials: YearFinancials[]; insight: { summary: string; keyPoints: string[]; risks: string[]; verdict: string; generatedAt: Date } | null }` e `export async function loadComparisonStock(symbol: string): Promise<ComparisonStock | null>`. Usata da Task 5.

- [ ] **Step 1: Avviare il Postgres di test (se non già avviato)**

Run: `docker compose -f docker-compose.test.yml up -d`

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere a `tests/lib/compare.test.ts`:

```ts
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as fundamentals from '@/lib/fundamentals'
import { resetDb } from '../helpers/db'
import { loadComparisonStock } from '@/lib/compare'

describe('loadComparisonStock', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('returns null for a symbol not in the watchlist', async () => {
    const result = await loadComparisonStock('ZZZZ')
    expect(result).toBeNull()
  })

  it('loads a stock with full data', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        price: 150,
        changePct: 1.1,
        marketCap: 3_000_000,
        week52High: 180,
        week52Low: 120,
        pegRatio: 1.4,
        roe: 22.5,
        debtToEquity: 0.8,
        epsTTM: 6.4,
        epsGrowth5Y: 12.5,
      },
    })
    await prisma.stockInsight.create({
      data: { stockId: stock.id, summary: 'Riassunto.', verdict: 'positive', score: 4, keyPoints: ['A'], risks: ['B'], confidence: 'high', inputHash: 'h', model: 'gemini' },
    })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([
      { year: 2025, revenue: 400_000, grossProfit: 180_000, operatingIncome: 120_000, netIncome: 95_000, eps: 6.1, operatingCashFlow: 110_000, totalAssets: 350_000, totalLiabilities: 280_000, currentAssets: 140_000, currentLiabilities: 120_000, retainedEarnings: 50_000, longTermDebt: 90_000, shares: 15_000 },
    ])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: 28, week52High: 180, week52Low: 120, pegRatio: 1.4, roe: 22.5, netMargin: 25, debtToEquity: 0.8, dividendYield: 0.5, payoutRatio: 10, relativePerf13W: 2, epsTTM: 6.4, epsGrowth5Y: 12.5, bookValuePerShare: 4.2, cashFlowPerShare: 7.1,
    })

    const result = await loadComparisonStock('AAPL')

    expect(result?.stock.symbol).toBe('AAPL')
    expect(result?.evaluation?.targetPrice.value).not.toBeNull()
    expect(result?.insight?.summary).toBe('Riassunto.')
    expect(result?.altman).not.toBeNull()
  })

  it('loads a freshly-added stock with partial data without throwing', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'IPO1', name: 'New Co.', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 10, changePct: 0 } })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue(null as unknown as Awaited<ReturnType<typeof finnhub.getMetrics>>)

    const result = await loadComparisonStock('IPO1')

    expect(result?.stock.symbol).toBe('IPO1')
    expect(result?.insight).toBeNull()
    expect(result?.altman).toBeNull()
    expect(result?.evaluation?.sinceWatching.pct).toBeNull()
  })

  it('does not fail the whole load when getMetrics rejects', async () => {
    const stock = await prisma.stock.create({ data: { symbol: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ' } })
    await prisma.priceSnapshot.create({ data: { stockId: stock.id, price: 300, changePct: 0.5 } })
    vi.spyOn(fundamentals, 'getAnnualFinancials').mockResolvedValue([])
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('rate limited'))

    const result = await loadComparisonStock('MSFT')

    expect(result?.stock.symbol).toBe('MSFT')
    expect(result?.fairValueInput).toBeNull()
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/lib/compare.test.ts`
Expected: FAIL — `loadComparisonStock` non esiste ancora.

- [ ] **Step 4: Implementare `loadComparisonStock`**

Aggiungere a `lib/compare.ts`:

```ts
import { prisma } from './db'
import { evaluateStock, type Evaluation } from './evaluate'
import { altmanZ, type AltmanResult } from './solidity'
import { getAnnualFinancials, type YearFinancials } from './fundamentals'
import { getMetrics } from './finnhub'

export interface ComparisonStock {
  stock: { symbol: string; name: string }
  latest: { price: number; changePct: number; marketCap: number | null } | null
  evaluation: Evaluation | null
  fairValueInput: {
    price: number
    epsTTM: number | null
    bookValuePerShare: number | null
    cashFlowPerShare: number | null
    epsGrowth5Y: number | null
    dividendYield: number | null
  } | null
  altman: AltmanResult | null
  financials: YearFinancials[]
  insight: { summary: string; keyPoints: string[]; risks: string[]; verdict: string; generatedAt: Date } | null
}

export async function loadComparisonStock(symbol: string): Promise<ComparisonStock | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 2 },
      insight: true,
    },
  })
  if (!stock) return null

  const latest = stock.snapshots[0] ?? null
  const earliest = stock.snapshots[1] ?? null

  const [financials, metrics] = await Promise.all([
    getAnnualFinancials(symbol),
    getMetrics(symbol).catch(() => null),
  ])

  const evaluation = latest
    ? evaluateStock({
        latestSnapshot: {
          price: latest.price,
          week52High: latest.week52High,
          week52Low: latest.week52Low,
          relativePerf13W: latest.relativePerf13W,
          pegRatio: latest.pegRatio,
          roe: latest.roe,
          debtToEquity: latest.debtToEquity,
          netMargin: latest.netMargin,
          dividendYield: latest.dividendYield,
          payoutRatio: latest.payoutRatio,
          epsTTM: latest.epsTTM,
          epsGrowth5Y: latest.epsGrowth5Y,
        },
        earliestSnapshot: earliest ? { price: earliest.price, timestamp: earliest.timestamp } : null,
        recentRecommendations: [],
      })
    : null

  const altman =
    financials.length > 0 && latest
      ? altmanZ(financials[financials.length - 1], latest.marketCap === null ? null : latest.marketCap * 1e6)
      : null

  const fairValueInput =
    latest && metrics
      ? {
          price: latest.price,
          epsTTM: metrics.epsTTM,
          bookValuePerShare: metrics.bookValuePerShare ?? null,
          cashFlowPerShare: metrics.cashFlowPerShare ?? null,
          epsGrowth5Y: metrics.epsGrowth5Y,
          dividendYield: metrics.dividendYield,
        }
      : null

  return {
    stock: { symbol: stock.symbol, name: stock.name },
    latest: latest ? { price: latest.price, changePct: latest.changePct, marketCap: latest.marketCap } : null,
    evaluation,
    fairValueInput,
    altman,
    financials,
    insight: stock.insight,
  }
}
```

Nota: `recentRecommendations: []` — il confronto non mostra il segnale medio termine basato sul consenso analisti (fuori scope per questa colonna leggera); `evaluateStock` gestisce già correttamente un array vuoto mostrando "Nessun dato disponibile" per `mediumTerm`, comportamento identico a un titolo senza copertura analisti, già testato in `tests/lib/evaluate.test.ts`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `npx vitest run tests/lib/compare.test.ts`
Expected: PASS (9 test in totale col Task 1)

- [ ] **Step 6: Commit**

```bash
git add lib/compare.ts tests/lib/compare.test.ts
git commit -m "feat: load per-stock comparison data"
```

---

### Task 3: `CompareSelection` — selezione checkbox e barra di confronto

**Files:**
- Create: `components/CompareSelection.tsx`
- Create: `components/CompareSelection.module.css`
- Test: `tests/components/CompareSelection.test.tsx`

**Interfaces:**
- Consumes: `useRouter` da `next/navigation`.
- Produces: `export function CompareSelectionProvider({ children }: { children: React.ReactNode })`, `export function CompareCheckbox({ symbol }: { symbol: string })`, `export function CompareBar({ maxCount }: { maxCount: number })`. Usati da Task 4.

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `tests/components/CompareSelection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { CompareSelectionProvider, CompareCheckbox, CompareBar } from '@/components/CompareSelection'

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }))

function Harness({ symbols, maxCount = 4 }: { symbols: string[]; maxCount?: number }) {
  return (
    <CompareSelectionProvider>
      {symbols.map((s) => (
        <CompareCheckbox key={s} symbol={s} />
      ))}
      <CompareBar maxCount={maxCount} />
    </CompareSelectionProvider>
  )
}

describe('CompareSelection', () => {
  const push = vi.fn()

  beforeEach(() => {
    push.mockReset()
    ;(useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push })
  })

  it('hides the bar when nothing is selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT']} />)
    expect(screen.queryByRole('button', { name: /confronta/i })).not.toBeInTheDocument()
  })

  it('disables the Confronta button with only 1 selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT']} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    expect(screen.getByRole('button', { name: /confronta/i })).toBeDisabled()
  })

  it('enables the button and navigates with the selected symbols on click', () => {
    render(<Harness symbols={['AAPL', 'MSFT', 'GOOGL']} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    fireEvent.click(screen.getByLabelText('MSFT'))
    const button = screen.getByRole('button', { name: /confronta/i })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(push).toHaveBeenCalledWith('/confronta?symbols=AAPL,MSFT')
  })

  it('disables unselected checkboxes once 4 are selected', () => {
    render(<Harness symbols={['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA']} maxCount={4} />)
    fireEvent.click(screen.getByLabelText('AAPL'))
    fireEvent.click(screen.getByLabelText('MSFT'))
    fireEvent.click(screen.getByLabelText('GOOGL'))
    fireEvent.click(screen.getByLabelText('NVDA'))
    expect(screen.getByLabelText('TSLA')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/components/CompareSelection.test.tsx`
Expected: FAIL — `components/CompareSelection.tsx` non esiste ancora.

- [ ] **Step 3: Implementare `CompareSelection.tsx`**

```tsx
'use client'

import { createContext, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './CompareSelection.module.css'

interface CompareContextValue {
  selected: Set<string>
  toggle: (symbol: string) => void
  maxCount: number
}

const CompareContext = createContext<CompareContextValue | null>(null)

export function CompareSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(symbol: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  return <CompareContext.Provider value={{ selected, toggle, maxCount: 4 }}>{children}</CompareContext.Provider>
}

function useCompareSelection() {
  const ctx = useContext(CompareContext)
  if (!ctx) throw new Error('CompareCheckbox/CompareBar must be used inside CompareSelectionProvider')
  return ctx
}

export function CompareCheckbox({ symbol }: { symbol: string }) {
  const { selected, toggle, maxCount } = useCompareSelection()
  const checked = selected.has(symbol)
  const disabled = !checked && selected.size >= maxCount
  return (
    <input
      type="checkbox"
      className={styles.checkbox}
      aria-label={symbol}
      checked={checked}
      disabled={disabled}
      title={disabled ? `Massimo ${maxCount} titoli` : undefined}
      onChange={() => toggle(symbol)}
    />
  )
}

export function CompareBar({ maxCount }: { maxCount: number }) {
  const { selected } = useCompareSelection()
  const router = useRouter()

  if (selected.size === 0) return null

  return (
    <div className={styles.bar} role="toolbar" aria-label="Confronto titoli">
      <span className={styles.count}>
        {selected.size} selezionat{selected.size === 1 ? 'o' : 'i'}
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={selected.size < 2}
        onClick={() => router.push(`/confronta?symbols=${[...selected].join(',')}`)}
      >
        Confronta
      </button>
    </div>
  )
}
```

Nota: `maxCount` passato a `CompareBar` è ignorato nel calcolo interno (il limite reale vive nel Provider, fissato a 4 per coerenza con `parseCompareSymbols`); il parametro resta per permettere di mostrare testi diversi in futuro senza toccare il Provider — qui viene solo accettato e non usato per il limite, che è sempre quello del Provider.

Creare `components/CompareSelection.module.css`:

```css
.checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--brass);
  cursor: pointer;
}

.checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  margin-top: 16px;
  background: var(--surface-raised);
  border-top: 1px solid var(--rule);
}

.count {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--muted);
}

.button {
  font-family: var(--font-display);
  font-size: 13px;
  padding: 6px 16px;
  border: 1px solid var(--brass);
  background: transparent;
  color: var(--brass);
  cursor: pointer;
}

.button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

`--surface-raised`, `--rule`, `--muted`, `--brass`, `--font-mono`, `--font-display` sono tutte definite in `app/globals.css` (righe 20-28) e già usate altrove (es. `app/page.module.css`) — nessun nuovo token da introdurre.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/components/CompareSelection.test.tsx`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add components/CompareSelection.tsx components/CompareSelection.module.css tests/components/CompareSelection.test.tsx
git commit -m "feat: add checkbox selection and compare bar to watchlist"
```

---

### Task 4: Agganciare la selezione alla watchlist

**Files:**
- Modify: `app/page.tsx` (sezione `WatchlistTable`, intorno alle righe 121-172 viste nell'esplorazione — verificare i numeri di riga esatti prima di modificare, potrebbero essere leggermente diversi)
- Modify: `app/page.module.css` (classe `.titleCell`, intorno alla riga 144)

**Interfaces:**
- Consumes: `CompareSelectionProvider`, `CompareCheckbox`, `CompareBar` da `@/components/CompareSelection` (Task 3).

- [ ] **Step 1: Aggiungere l'import**

In `app/page.tsx`, aggiungere vicino agli altri import di componenti:

```ts
import { CompareSelectionProvider, CompareCheckbox, CompareBar } from '@/components/CompareSelection'
```

- [ ] **Step 2: Wrappare la lista e aggiungere la barra**

Individuare il blocco:

```tsx
      <ul className={styles.list}>
        {rows.map(({ stock, latest, ext, extPct, entryPrice, sector }) => {
```

e la sua chiusura:

```tsx
      </ul>
      </section>
```

Sostituire con (wrapping della `<ul>...</ul>` in `CompareSelectionProvider` e aggiunta di `CompareBar` subito dopo):

```tsx
      <CompareSelectionProvider>
      <ul className={styles.list}>
        {rows.map(({ stock, latest, ext, extPct, entryPrice, sector }) => {
```

```tsx
      </ul>
      <CompareBar maxCount={4} />
      </CompareSelectionProvider>
      </section>
```

- [ ] **Step 3: Aggiungere il checkbox dentro `.titleCell`**

Individuare:

```tsx
              <div className={styles.titleCell}>
                <Link href={`/stock/${stock.symbol}`} className={styles.symbol}>
                  {stock.symbol}
                </Link>
                <span className={styles.name}>{stock.name}</span>
```

Sostituire l'apertura con una riga flex che contiene checkbox + link:

```tsx
              <div className={styles.titleCell}>
                <div className={styles.titleRow}>
                  <CompareCheckbox symbol={stock.symbol} />
                  <Link href={`/stock/${stock.symbol}`} className={styles.symbol}>
                    {stock.symbol}
                  </Link>
                </div>
                <span className={styles.name}>{stock.name}</span>
```

(la `</div>` di chiusura di `.titleRow` va aggiunta subito prima di `<span className={styles.name}>`, già mostrato sopra; il resto di `.titleCell` — `AlertTargets`, ecc. — resta invariato dopo `<span className={styles.name}>`).

- [ ] **Step 4: Aggiungere lo stile `.titleRow`**

In `app/page.module.css`, subito prima della regola `.titleCell` esistente:

```css
.titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 5: Verifica manuale**

Run: `npm run dev`, aprire `/`, selezionare 2 checkbox, verificare che appaia la barra sticky in fondo con "2 selezionati" e bottone "Confronta" abilitato; cliccarlo e verificare la navigazione a `/confronta?symbols=...`.

- [ ] **Step 6: Eseguire la suite esistente per verificare nessuna regressione**

Run: `npx vitest run`
Expected: PASS (tutti i test esistenti, inclusi quelli di `app/page.tsx` se presenti)

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/page.module.css
git commit -m "feat: wire compare selection into the watchlist"
```

---

### Task 5: Pagina `/confronta`

**Files:**
- Create: `app/confronta/page.tsx`
- Create: `app/confronta/page.module.css`

**Interfaces:**
- Consumes: `parseCompareSymbols`, `loadComparisonStock`, `ComparisonStock` da `@/lib/compare` (Task 1-2); `EvaluationPanel` da `@/components/EvaluationPanel`; `FairValueCard` da `@/components/FairValueCard`; `FinancialAnalysis` da `@/components/FinancialAnalysis`; `InsightPanel` da `@/components/InsightPanel`.

- [ ] **Step 1: Implementare la pagina**

```tsx
import Link from 'next/link'
import { parseCompareSymbols, loadComparisonStock, type ComparisonStock } from '@/lib/compare'
import { EvaluationPanel } from '@/components/EvaluationPanel'
import { FairValueCard } from '@/components/FairValueCard'
import { FinancialAnalysis } from '@/components/FinancialAnalysis'
import { InsightPanel } from '@/components/InsightPanel'
import styles from './page.module.css'

function EmptyState() {
  return (
    <main className={styles.shell}>
      <p className={styles.empty}>Seleziona almeno 2 titoli dalla watchlist.</p>
      <Link href="/" className={styles.back}>
        ← Torna alla watchlist
      </Link>
    </main>
  )
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ symbols?: string }> }) {
  const { symbols: raw } = await searchParams
  const symbols = parseCompareSymbols(raw)
  if (symbols.length < 2) return <EmptyState />

  const loaded = await Promise.all(symbols.map(loadComparisonStock))
  const stocks = loaded.filter((s): s is ComparisonStock => s !== null)
  if (stocks.length < 2) return <EmptyState />

  const columns = `repeat(${stocks.length}, 1fr)`

  return (
    <main className={styles.shell}>
      <Link href="/" className={styles.back}>
        ← Watchlist
      </Link>
      <h1 className={styles.title}>Confronto titoli</h1>

      <section className={styles.sectionRow} style={{ gridTemplateColumns: columns }}>
        {stocks.map(({ stock, latest }) => (
          <div key={stock.symbol} className={styles.header}>
            <p className={styles.symbol}>{stock.symbol}</p>
            <p className={styles.name}>{stock.name}</p>
            <p className={styles.price}>{latest ? `$${latest.price.toFixed(2)}` : '—'}</p>
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
    </main>
  )
}
```

- [ ] **Step 2: Implementare lo stile**

Creare `app/confronta/page.module.css`, riusando le variabili esistenti definite in `app/globals.css` (`--rule`, `--muted`, `--font-mono`, `--font-display`, righe 20-26) — non introdurne di nuove:

```css
.shell {
  max-width: 1400px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.back {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
}

.title {
  font-family: var(--font-display);
  font-size: 22px;
  margin: 16px 0 24px;
}

.sectionRow {
  display: grid;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--rule);
  overflow-x: auto;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.symbol {
  font-family: var(--font-display);
  font-size: 18px;
}

.name {
  font-size: 13px;
  color: var(--muted);
}

.price {
  font-family: var(--font-mono);
  font-size: 20px;
}

.empty {
  font-size: 14px;
  color: var(--muted);
  margin-bottom: 12px;
}
```

- [ ] **Step 3: Verifica manuale**

Run: `npm run dev`, navigare a `/confronta?symbols=AAPL,MSFT` (con due simboli realmente in watchlist) e verificare: header con prezzo, riga Evaluation, riga Fair Value, riga Solidità, riga Insight (vuota se non generato) — tutte affiancate in colonne. Poi navigare a `/confronta?symbols=ZZZZ` (simbolo inesistente) e verificare il messaggio "Seleziona almeno 2 titoli dalla watchlist."

- [ ] **Step 4: Eseguire l'intera suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/confronta/page.tsx app/confronta/page.module.css
git commit -m "feat: add side-by-side stock comparison page"
```
