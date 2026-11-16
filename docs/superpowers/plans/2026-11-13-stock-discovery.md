# Discovery di nuovi titoli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pagina `/scopri` con bottone "Scansiona ora" che propone titoli nuovi (USA+Italia, non in watchlist) con punteggio 0-100 trasparente, combinando segnali già esistenti nell'app (momentum Yahoo, acquisti Congress USA, fondamentali Finnhub, insider Form 4).

**Architecture:** Nuovo modulo `lib/discover.ts` fa tutto il lavoro non-UI: `sourceCandidates` unisce 3 feed già esistenti e bounded (niente scansione di mercato), `selectForEnrichment` applica una quota fissa 14 USA / 6 Italia, `scoreCandidate` è una funzione pura (nessuna rete) che calcola il punteggio, `runDiscoveryScan` orchestra tutto e scrive `DiscoveredCandidate` via upsert. Una route `POST /api/discover` (bottone) e una `PATCH /api/discover/[symbol]` (scarta) espongono questo al frontend; `app/scopri/page.tsx` legge l'ultimo scan dal DB.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + Postgres, vitest, riuso di `lib/congress.ts`, `lib/market.ts`, `lib/finnhub.ts`, `lib/insider-data.ts`, `lib/congress-signals.ts`, `lib/politician-profiles.ts`.

**Spec:** `docs/superpowers/specs/2026-11-13-stock-discovery-design.md`

## Global Constraints

- Nessuna fonte dati nuova, nessuno scraping nuovo, nessun ML/backtest — solo funzioni già esistenti, formule a soglie fisse.
- Scan solo manuale (bottone), nessun cron.
- Upsert per simbolo: ogni scan sovrascrive il precedente, nessuno storico.
- Quota fissa 14 USA / 6 Italia (non un cap totale condiviso) — l'Italia non perde spazio quando il mercato USA è rumoroso.
- Per l'Italia, `insiderScore` è sempre 0 (nessun segnale Congress/Form4 possibile) — dichiarato nella nota.
- Per i candidati da fonte `"congress"`, il punteggio congress riusa `rankSignals` con una `Map` vuota per i profili membri (`new Map()`), **senza chiamare `getMemberProfiles`** — quella funzione chiama un LLM (Gemini) per ogni membro nuovo, costo/dipendenza non previsti dallo scopo di questo scan; si perde solo il piccolo bonus "membro influente" (+1.5 su una scala tipica 0-15), non il resto del punteggio.
- `export const maxDuration = 60` sulla route `POST /api/discover` (il default serverless di 10s non basta).
- Concorrenza massima 5 chiamate in parallelo durante l'arricchimento, per non sommare troppe richieste simultanee a Finnhub.
- Stile codice `lib/`: senza punto e virgola, apici singoli, 2 spazi (come `lib/evaluate.ts`, `lib/congress.ts`).
- Test di integrazione richiedono il Postgres di test: `docker compose -f docker-compose.test.yml up -d` (porta 5433).

## Review Focus

- Un candidato arricchito a metà (una chiamata Finnhub o insider fallita) non deve mai sparire silenziosamente né mostrare un punteggio che sembra completo senza il flag `partial`.
- Un candidato "congress" senza alcun prezzo utilizzabile (sia `getQuote` sia `getMetrics` falliscono) deve essere scartato dallo scan, non salvato con `momentumScore` a zero che sembrerebbe un dato reale.
- L'Italia non deve mai restare completamente fuori dai risultati solo perché il mercato USA ha prodotto più candidati quel giorno — la quota 14/6 è fissa.
- Un simbolo già in watchlist non deve mai apparire come candidato (escluso a monte, prima dell'arricchimento).
- Uno scan in cui zero fonti producono candidati non deve cancellare le righe dello scan precedente (nessun upsert eseguito).

## File Structure

- Modify `prisma/schema.prisma`: nuovo modello `DiscoveredCandidate`.
- Modify `tests/helpers/db.ts`: `resetDb()` pulisce anche `discoveredCandidate` (nessuna relazione con `Stock`, va pulito esplicitamente).
- Create `lib/discover.ts`: tutti i tipi e le funzioni (`scoreCandidate`, `sourceCandidates`, `selectForEnrichment`, `runDiscoveryScan`).
- Create `tests/lib/discover.test.ts`.
- Create `app/api/discover/route.ts` (`POST`).
- Create `app/api/discover/[symbol]/route.ts` (`PATCH`, scarta).
- Create `tests/api/discover.test.ts`.
- Create `components/ScanButton.tsx` + `components/ScanButton.module.css`.
- Create `components/CandidateCard.tsx` + `components/CandidateCard.module.css`.
- Create `tests/components/ScanButton.test.tsx`, `tests/components/CandidateCard.test.tsx`.
- Create `app/scopri/page.tsx` + `app/scopri/page.module.css`.

---

### Task 1: Modello `DiscoveredCandidate` e migrazione

**Files:**
- Modify: `prisma/schema.prisma` (append in coda, dopo il modello `StockInsight`)
- Modify: `tests/helpers/db.ts`
- Test: `tests/helpers/db.test.ts` (esteso)

**Interfaces:**
- Produces: modello Prisma `DiscoveredCandidate` con client generato `prisma.discoveredCandidate.*`. Usato da Task 4 e 5.

- [ ] **Step 1: Aggiungere il modello a `prisma/schema.prisma`**

In coda al file (dopo la chiusura del modello `StockInsight`):

```prisma
model DiscoveredCandidate {
  id                String    @id @default(cuid())
  symbol            String    @unique
  name              String
  market            String
  score             Float
  momentumScore     Float
  fundamentalsScore Float
  insiderScore      Float
  reason            String
  source            String
  partial           Boolean   @default(false)
  scannedAt         DateTime  @default(now())
  dismissedAt       DateTime?

  @@index([score])
}
```

- [ ] **Step 2: Generare la migrazione sul DB di sviluppo**

Run: `npx prisma migrate dev --name add_discovered_candidate`
Expected: crea `prisma/migrations/<timestamp>_add_discovered_candidate/migration.sql`, applica al DB di `.env.local`, rigenera il client Prisma.

- [ ] **Step 3: Applicare la migrazione al DB di test**

Run: `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy`
Expected: `1 migration found... Applied`

- [ ] **Step 4: Scrivere il test che fallisce per il nuovo modello in `resetDb`**

Aggiungere a `tests/helpers/db.test.ts` (nel blocco `describe('database setup')` esistente):

```ts
it('resetDb also clears discovered candidates (no relation to Stock)', async () => {
  await prisma.discoveredCandidate.create({
    data: { symbol: 'ZZZZ', name: 'Test Co.', market: 'US', score: 50, momentumScore: 50, fundamentalsScore: 50, insiderScore: 50, reason: 'test', source: 'congress' },
  })

  await resetDb()

  const remaining = await prisma.discoveredCandidate.findMany()
  expect(remaining).toHaveLength(0)
})
```

- [ ] **Step 5: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/helpers/db.test.ts`
Expected: FAIL — il record `ZZZZ` resta dopo `resetDb()`, `remaining` ha lunghezza 1, non 0.

- [ ] **Step 6: Aggiungere la pulizia a `resetDb()`**

In `tests/helpers/db.ts`, aggiungere `await prisma.discoveredCandidate.deleteMany()` prima delle righe esistenti (nessuna relazione, va bene in qualsiasi punto, ma per chiarezza prima delle altre):

```ts
export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('test')) {
    throw new Error(
      `resetDb() refused: DATABASE_URL does not look like a test database (${url || '(empty)'})`
    )
  }

  await prisma.discoveredCandidate.deleteMany()
  await prisma.analystRecommendation.deleteMany()
  await prisma.newsItem.deleteMany()
  await prisma.priceSnapshot.deleteMany()
  await prisma.stock.deleteMany()
}
```

- [ ] **Step 7: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/helpers/db.test.ts`
Expected: PASS (4 test: i 3 esistenti + quello nuovo)

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts tests/helpers/db.test.ts
git commit -m "feat: add DiscoveredCandidate model"
```

---

### Task 2: `scoreCandidate` — punteggio puro, nessuna rete

**Files:**
- Create: `lib/discover.ts`
- Test: `tests/lib/discover.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ScoreInput {
    price: number
    week52High: number | null
    week52Low: number | null
    changePct: number
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    congressSignalScore: number | null
    insiderBuyerCount: number
    market: 'US' | 'IT'
  }
  export interface CandidateScore {
    momentumScore: number
    fundamentalsScore: number
    insiderScore: number
    score: number
    reason: string
  }
  export function scoreCandidate(input: ScoreInput): CandidateScore
  ```
  Usata da Task 4. Nota: `partial` NON fa parte di `CandidateScore` — è un flag di orchestrazione (una chiamata di rete è fallita o no), deciso dal chiamante in Task 4, non da questa funzione pura.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/lib/discover.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreCandidate, type ScoreInput } from '@/lib/discover'

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    price: 100,
    week52High: null,
    week52Low: null,
    changePct: 0,
    pegRatio: null,
    roe: null,
    debtToEquity: null,
    congressSignalScore: null,
    insiderBuyerCount: 0,
    market: 'US',
    ...overrides,
  }
}

describe('scoreCandidate — momentum', () => {
  it('scores purely on move size when 52-week range is missing', () => {
    const result = scoreCandidate(baseInput({ changePct: 30 }))
    expect(result.momentumScore).toBe(100)
  })

  it('averages range position and move size when both are available', () => {
    // price at the exact 52-week high -> rangePoints = 100; changePct 15 -> movePoints = 50
    const result = scoreCandidate(baseInput({ price: 180, week52High: 180, week52Low: 120, changePct: 15 }))
    expect(result.momentumScore).toBe(75)
  })

  it('caps move points at 100 for moves at or above 30%', () => {
    const result = scoreCandidate(baseInput({ changePct: -45 }))
    expect(result.momentumScore).toBe(100)
  })
})

describe('scoreCandidate — fundamentals', () => {
  it('gives full points for PEG<=1, ROE>15, debt<1', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.fundamentalsScore).toBe(100)
  })

  it('gives partial points for mid-band values', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 1.5, roe: 10, debtToEquity: 1.5 }))
    expect(result.fundamentalsScore).toBe(20 + 20 + 10)
  })

  it('gives zero points for a loss-making, overleveraged, overpriced stock', () => {
    const result = scoreCandidate(baseInput({ pegRatio: 3, roe: -5, debtToEquity: 2.5 }))
    expect(result.fundamentalsScore).toBe(0)
  })

  it('treats null fundamentals as zero points, never a crash', () => {
    const result = scoreCandidate(baseInput())
    expect(result.fundamentalsScore).toBe(0)
  })
})

describe('scoreCandidate — insider/congress', () => {
  it('is always zero for the Italian market, regardless of other inputs', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', congressSignalScore: 15, insiderBuyerCount: 5 }))
    expect(result.insiderScore).toBe(0)
  })

  it('normalizes a congress signal score onto the 0-100 scale', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6 }))
    expect(result.insiderScore).toBe(50)
  })

  it('takes the stronger of congress and insider signals, not their sum', () => {
    const result = scoreCandidate(baseInput({ congressSignalScore: 6, insiderBuyerCount: 4 }))
    expect(result.insiderScore).toBe(100)
  })

  it('is zero when there is no signal at all', () => {
    const result = scoreCandidate(baseInput())
    expect(result.insiderScore).toBe(0)
  })
})

describe('scoreCandidate — combined score and reason', () => {
  it('averages three pillars for US stocks', () => {
    const result = scoreCandidate(baseInput({ changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5, congressSignalScore: 12 }))
    expect(result.score).toBe(100)
  })

  it('averages only two pillars for IT stocks', () => {
    const result = scoreCandidate(baseInput({ market: 'IT', changePct: 30, pegRatio: 0.8, roe: 20, debtToEquity: 0.5 }))
    expect(result.score).toBe(100)
  })

  it('mentions the Italian market disclaimer in the reason', () => {
    const result = scoreCandidate(baseInput({ market: 'IT' }))
    expect(result.reason).toContain('Mercato italiano')
  })

  it('falls back to a generic reason when every pillar is weak', () => {
    const result = scoreCandidate(baseInput())
    expect(result.reason).toContain('Segnale debole')
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: FAIL — `lib/discover.ts` non esiste ancora.

- [ ] **Step 3: Implementare `scoreCandidate`**

Creare `lib/discover.ts`:

```ts
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v)

export interface ScoreInput {
  price: number
  week52High: number | null
  week52Low: number | null
  changePct: number
  pegRatio: number | null
  roe: number | null
  debtToEquity: number | null
  congressSignalScore: number | null
  insiderBuyerCount: number
  market: 'US' | 'IT'
}

export interface CandidateScore {
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  score: number
  reason: string
}

function momentumScoreOf(input: ScoreInput): number {
  const movePoints = clamp(Math.abs(input.changePct) / 30 * 100, 0, 100)
  if (input.week52High === null || input.week52Low === null || input.week52High <= input.week52Low) {
    return round(movePoints)
  }
  const rangePoints = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1) * 100
  return round((rangePoints + movePoints) / 2)
}

function fundamentalsScoreOf(input: ScoreInput): number {
  const pegPoints = input.pegRatio === null || input.pegRatio <= 0 ? 0 : input.pegRatio <= 1 ? 40 : input.pegRatio <= 2 ? 20 : 0
  const roePoints = input.roe === null ? 0 : input.roe > 15 ? 40 : input.roe > 0 ? 20 : 0
  const debtPoints = input.debtToEquity === null ? 0 : input.debtToEquity < 1 ? 20 : input.debtToEquity < 2 ? 10 : 0
  return pegPoints + roePoints + debtPoints
}

function insiderScoreOf(input: ScoreInput): number {
  if (input.market === 'IT') return 0
  const congressPoints = input.congressSignalScore === null ? 0 : clamp(input.congressSignalScore / 12 * 100, 0, 100)
  const insiderPoints = clamp(input.insiderBuyerCount * 25, 0, 100)
  return round(Math.max(congressPoints, insiderPoints))
}

function buildReason(input: ScoreInput, s: { momentumScore: number; fundamentalsScore: number; insiderScore: number }): string {
  const parts: string[] = []
  if (s.momentumScore >= 60) {
    const sign = input.changePct >= 0 ? '+' : ''
    parts.push(`movimento forte (${sign}${input.changePct.toFixed(1)}%)`)
  }
  if (s.fundamentalsScore >= 60) {
    parts.push(`fondamentali solidi (PEG ${input.pegRatio?.toFixed(1) ?? '—'}, ROE ${input.roe?.toFixed(0) ?? '—'}%)`)
  }
  if (input.market === 'US' && s.insiderScore >= 50) {
    parts.push(input.congressSignalScore !== null ? 'acquisto recente di membri del Congresso' : 'acquisti insider recenti')
  }
  if (parts.length === 0) {
    parts.push('segnale debole su tutti i fronti, incluso solo perché tra i candidati del giorno')
  }
  let reason = parts.join(', ')
  reason = reason.charAt(0).toUpperCase() + reason.slice(1) + '.'
  if (input.market === 'IT') {
    reason += ' Mercato italiano: nessun segnale insider/congress disponibile per questo titolo — solo momentum e fondamentali.'
  }
  return reason
}

export function scoreCandidate(input: ScoreInput): CandidateScore {
  const momentumScore = momentumScoreOf(input)
  const fundamentalsScore = fundamentalsScoreOf(input)
  const insiderScore = insiderScoreOf(input)
  const score = round(
    input.market === 'IT'
      ? (momentumScore + fundamentalsScore) / 2
      : (momentumScore + fundamentalsScore + insiderScore) / 3
  )
  const reason = buildReason(input, { momentumScore, fundamentalsScore, insiderScore })
  return { momentumScore, fundamentalsScore, insiderScore, score, reason }
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: PASS (14 test)

- [ ] **Step 5: Commit**

```bash
git add lib/discover.ts tests/lib/discover.test.ts
git commit -m "feat: add discovery candidate scoring"
```

---

### Task 3: `sourceCandidates` e `selectForEnrichment`

**Files:**
- Modify: `lib/discover.ts`
- Test: `tests/lib/discover.test.ts`

**Interfaces:**
- Consumes: `getRecentCongressBuys`, `CongressBuy` da `@/lib/congress`; `memberStats` da `@/lib/politician-profiles`; `rankSignals` da `@/lib/congress-signals`; `getMarketBigMovers` da `@/lib/market`.
- Produces:
  ```typescript
  export interface CandidateSeed {
    symbol: string
    name: string
    market: 'US' | 'IT'
    source: string[]
    seedPrice: number | null
    seedChangePct: number | null
    congressScore: number | null
  }
  export async function sourceCandidates(excludeSymbols: Set<string>): Promise<CandidateSeed[]>
  export function selectForEnrichment(seeds: CandidateSeed[], maxUS?: number, maxIT?: number): CandidateSeed[]
  ```
  Usate da Task 4.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `tests/lib/discover.test.ts`:

```ts
import * as congress from '@/lib/congress'
import * as politicianProfiles from '@/lib/politician-profiles'
import * as congressSignals from '@/lib/congress-signals'
import * as market from '@/lib/market'
import { vi, beforeEach } from 'vitest'
import { sourceCandidates, selectForEnrichment, type CandidateSeed } from '@/lib/discover'

describe('sourceCandidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('combines congress buys and US/IT movers into one deduped list', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us'
        ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }]
        : [{ symbol: 'ENI.MI', name: 'Eni', changePct: -16, price: 14, marketCap: null, volume: null, exchange: null }]
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol).sort()).toEqual(['ENI.MI', 'MSFT', 'NVDA'])
    const nvda = seeds.find((s) => s.symbol === 'NVDA')!
    expect(nvda.market).toBe('US')
    expect(nvda.source).toEqual(['congress'])
    expect(nvda.congressScore).toBe(8)
    const eni = seeds.find((s) => s.symbol === 'ENI.MI')!
    expect(eni.market).toBe('IT')
    expect(eni.congressScore).toBeNull()
  })

  it('merges sources for a symbol that appears in more than one feed', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([
      { ticker: 'NVDA', asset: 'Nvidia Corp', members: ['Jane Doe'], trades: 1, totalLow: 50_000, totalHigh: 100_000, firstDate: '2026-11-01', lastDisclosedAt: '2026-11-05', avgPerfPct: null, timing: 'unknown', score: 8, reasons: [] },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'NVDA', name: 'Nvidia', changePct: 22, price: 500, marketCap: null, volume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds).toHaveLength(1)
    expect(seeds[0].source.sort()).toEqual(['congress', 'yahoo-movers-us'])
    expect(seeds[0].seedChangePct).toBe(22)
  })

  it('excludes symbols already in the watchlist', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(politicianProfiles, 'memberStats').mockReturnValue(new Map())
    vi.spyOn(congressSignals, 'rankSignals').mockReturnValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set(['MSFT']))

    expect(seeds).toHaveLength(0)
  })

  it('does not let one failing source block the others', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockRejectedValue(new Error('down'))
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )

    const seeds = await sourceCandidates(new Set())

    expect(seeds.map((s) => s.symbol)).toEqual(['MSFT'])
  })
})

describe('selectForEnrichment', () => {
  function seed(symbol: string, market: 'US' | 'IT'): CandidateSeed {
    return { symbol, name: symbol, market, source: ['yahoo-movers-us'], seedPrice: 10, seedChangePct: 20, congressScore: null }
  }

  it('takes at most 14 US and 6 IT candidates by default', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([...Array(10)].map((_, i) => seed(`IT${i}`, 'IT')))
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(14)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(6)
  })

  it('does not give IT leftover US slots when IT has fewer candidates than its quota', () => {
    const seeds = [...Array(20)].map((_, i) => seed(`US${i}`, 'US')).concat([seed('ENI.MI', 'IT')])
    const result = selectForEnrichment(seeds)
    expect(result.filter((s) => s.market === 'US')).toHaveLength(14)
    expect(result.filter((s) => s.market === 'IT')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: FAIL — `sourceCandidates`/`selectForEnrichment` non esistono ancora.

- [ ] **Step 3: Implementare `sourceCandidates` e `selectForEnrichment`**

Aggiungere a `lib/discover.ts`:

```ts
import { getRecentCongressBuys } from './congress'
import { memberStats } from './politician-profiles'
import { rankSignals } from './congress-signals'
import { getMarketBigMovers } from './market'

export interface CandidateSeed {
  symbol: string
  name: string
  market: 'US' | 'IT'
  source: string[]
  seedPrice: number | null
  seedChangePct: number | null
  congressScore: number | null
}

export async function sourceCandidates(excludeSymbols: Set<string>): Promise<CandidateSeed[]> {
  const seedMap = new Map<string, CandidateSeed>()

  function addSeed(symbol: string, name: string, market: 'US' | 'IT', source: string, seedPrice: number | null, seedChangePct: number | null, congressScore: number | null) {
    const existing = seedMap.get(symbol)
    if (existing) {
      if (!existing.source.includes(source)) existing.source.push(source)
      if (existing.seedPrice === null) existing.seedPrice = seedPrice
      if (existing.seedChangePct === null) existing.seedChangePct = seedChangePct
      if (existing.congressScore === null) existing.congressScore = congressScore
    } else {
      seedMap.set(symbol, { symbol, name, market, source: [source], seedPrice, seedChangePct, congressScore })
    }
  }

  try {
    const buys = await getRecentCongressBuys()
    if (buys && buys.length > 0) {
      const stats = memberStats(buys)
      const signals = rankSignals(buys, new Map(), stats)
      for (const s of signals) addSeed(s.ticker, s.asset, 'US', 'congress', null, null, s.score)
    }
  } catch (err) {
    console.error('Discovery: congress sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  try {
    const usMovers = await getMarketBigMovers(15, 'us')
    for (const m of usMovers) addSeed(m.symbol, m.name, 'US', 'yahoo-movers-us', m.price, m.changePct, null)
  } catch (err) {
    console.error('Discovery: US movers sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  try {
    const itMovers = await getMarketBigMovers(15, 'it')
    for (const m of itMovers) addSeed(m.symbol, m.name, 'IT', 'yahoo-movers-it', m.price, m.changePct, null)
  } catch (err) {
    console.error('Discovery: IT movers sourcing failed:', err instanceof Error ? err.message : String(err))
  }

  return [...seedMap.values()]
    .filter((s) => !excludeSymbols.has(s.symbol.toUpperCase()))
    .sort((a, b) => b.source.length - a.source.length || Math.abs(b.seedChangePct ?? 0) - Math.abs(a.seedChangePct ?? 0))
}

export function selectForEnrichment(seeds: CandidateSeed[], maxUS = 14, maxIT = 6): CandidateSeed[] {
  return [...seeds.filter((s) => s.market === 'US').slice(0, maxUS), ...seeds.filter((s) => s.market === 'IT').slice(0, maxIT)]
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: PASS (20 test in totale coi Task 2)

- [ ] **Step 5: Commit**

```bash
git add lib/discover.ts tests/lib/discover.test.ts
git commit -m "feat: source discovery candidates from existing feeds"
```

---

### Task 4: `runDiscoveryScan` — orchestrazione e scrittura DB

**Files:**
- Modify: `lib/discover.ts`
- Test: `tests/lib/discover.test.ts`

**Interfaces:**
- Consumes: `getQuote`, `getMetrics`, `FinnhubMetrics` da `@/lib/finnhub`; `getInsiderData` da `@/lib/insider-data`; `prisma` da `@/lib/db`; `scoreCandidate`, `sourceCandidates`, `selectForEnrichment`, `CandidateSeed` (già in questo file).
- Produces: `export async function runDiscoveryScan(): Promise<{ scannedAt: Date; candidates: number }>`. Usata da Task 5.

- [ ] **Step 1: Avviare il Postgres di test (se non già avviato)**

Run: `docker compose -f docker-compose.test.yml up -d`

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere a `tests/lib/discover.test.ts`:

```ts
import { prisma } from '@/lib/db'
import * as finnhub from '@/lib/finnhub'
import * as insiderData from '@/lib/insider-data'
import { resetDb } from '../helpers/db'
import { runDiscoveryScan } from '@/lib/discover'

describe('runDiscoveryScan', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('upserts a scored candidate sourced from a US mover', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: 28, week52High: 420, week52Low: 300, pegRatio: 1.2, roe: 30, netMargin: 25, debtToEquity: 0.5, dividendYield: 0.8, payoutRatio: 20, relativePerf13W: 5, epsTTM: 10, epsGrowth5Y: 15, bookValuePerShare: 20, cashFlowPerShare: 12,
    })
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue({ trades: [], sentiment: [] })

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.market).toBe('US')
    expect(stored?.partial).toBe(false)
    expect(stored?.scannedAt).toEqual(result.scannedAt)
  })

  it('flags a candidate as partial when getMetrics fails, but keeps it', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('rate limited'))
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue({ trades: [], sentiment: [] })

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(1)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.partial).toBe(true)
  })

  it('drops a congress-only candidate when both getQuote and getMetrics fail (no usable price)', async () => {
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([
      { member: 'Jane Doe', chamber: 'house', state: 'CA', side: 'buy', amountLow: 50_000, amountHigh: 100_000, date: '2026-11-01', disclosedAt: '2026-11-05', ticker: 'NVDA', asset: 'Nvidia Corp', perfPct: null },
    ])
    vi.spyOn(market, 'getMarketBigMovers').mockResolvedValue([])
    vi.spyOn(finnhub, 'getQuote').mockRejectedValue(new Error('down'))
    vi.spyOn(finnhub, 'getMetrics').mockRejectedValue(new Error('down'))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(0)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'NVDA' } })
    expect(stored).toBeNull()
  })

  it('does not touch existing rows when every source fails', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'OLD', name: 'Old Co.', market: 'US', score: 70, momentumScore: 70, fundamentalsScore: 70, insiderScore: 70, reason: 'previous scan', source: 'yahoo-movers-us' },
    })
    vi.spyOn(congress, 'getRecentCongressBuys').mockRejectedValue(new Error('down'))
    vi.spyOn(market, 'getMarketBigMovers').mockRejectedValue(new Error('down'))

    const result = await runDiscoveryScan()

    expect(result.candidates).toBe(0)
    const stillThere = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'OLD' } })
    expect(stillThere).not.toBeNull()
  })

  it('un-dismisses a candidate that reappears in a new scan', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'MSFT', name: 'Microsoft', market: 'US', score: 10, momentumScore: 10, fundamentalsScore: 10, insiderScore: 10, reason: 'old', source: 'yahoo-movers-us', dismissedAt: new Date() },
    })
    vi.spyOn(congress, 'getRecentCongressBuys').mockResolvedValue([])
    vi.spyOn(market, 'getMarketBigMovers').mockImplementation(async (_t, m) =>
      m === 'us' ? [{ symbol: 'MSFT', name: 'Microsoft', changePct: 18, price: 400, marketCap: null, volume: null, exchange: null }] : []
    )
    vi.spyOn(finnhub, 'getMetrics').mockResolvedValue({
      peRatio: null, week52High: null, week52Low: null, pegRatio: null, roe: null, netMargin: null, debtToEquity: null, dividendYield: null, payoutRatio: null, relativePerf13W: null, epsTTM: null, epsGrowth5Y: null,
    })
    vi.spyOn(insiderData, 'getInsiderData').mockResolvedValue(null)

    await runDiscoveryScan()

    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.dismissedAt).toBeNull()
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: FAIL — `runDiscoveryScan` non esiste ancora.

- [ ] **Step 4: Implementare `runDiscoveryScan`**

Aggiungere a `lib/discover.ts`:

```ts
import { prisma } from './db'
import { getQuote, getMetrics } from './finnhub'
import { getInsiderData } from './insider-data'

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function enrichAndScore(seed: CandidateSeed): Promise<{ score: CandidateScore; partial: boolean } | null> {
  let price = seed.seedPrice
  let changePct = seed.seedChangePct ?? 0

  if (price === null) {
    try {
      const quote = await getQuote(seed.symbol)
      price = quote.currentPrice
      changePct = quote.changePercent
    } catch {
      price = null
    }
  }

  let metrics: Awaited<ReturnType<typeof getMetrics>> | null = null
  let metricsFailed = false
  try {
    metrics = await getMetrics(seed.symbol)
  } catch {
    metricsFailed = true
  }

  if (price === null) return null

  let insiderBuyerCount = 0
  let insiderFailed = false
  if (seed.market === 'US') {
    try {
      const insider = await getInsiderData(seed.symbol)
      if (insider) {
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000
        insiderBuyerCount = new Set(
          insider.trades.filter((t) => t.side === 'buy' && new Date(t.date).getTime() >= since).map((t) => t.name)
        ).size
      } else {
        insiderFailed = true
      }
    } catch {
      insiderFailed = true
    }
  }

  const score = scoreCandidate({
    price,
    week52High: metrics?.week52High ?? null,
    week52Low: metrics?.week52Low ?? null,
    changePct,
    pegRatio: metrics?.pegRatio ?? null,
    roe: metrics?.roe ?? null,
    debtToEquity: metrics?.debtToEquity ?? null,
    congressSignalScore: seed.congressScore,
    insiderBuyerCount,
    market: seed.market,
  })

  return { score, partial: metricsFailed || insiderFailed }
}

export async function runDiscoveryScan(): Promise<{ scannedAt: Date; candidates: number }> {
  const scannedAt = new Date()
  const watched = await prisma.stock.findMany({ select: { symbol: true } })
  const excludeSymbols = new Set(watched.map((w) => w.symbol.toUpperCase()))

  const seeds = await sourceCandidates(excludeSymbols)
  const selected = selectForEnrichment(seeds)

  const results: Array<{ seed: CandidateSeed; score: CandidateScore; partial: boolean }> = []
  await runWithConcurrency(selected, 5, async (seed) => {
    const enriched = await enrichAndScore(seed)
    if (enriched) results.push({ seed, score: enriched.score, partial: enriched.partial })
  })

  if (results.length === 0) return { scannedAt, candidates: 0 }

  for (const { seed, score, partial } of results) {
    await prisma.discoveredCandidate.upsert({
      where: { symbol: seed.symbol },
      create: {
        symbol: seed.symbol, name: seed.name, market: seed.market,
        score: score.score, momentumScore: score.momentumScore, fundamentalsScore: score.fundamentalsScore, insiderScore: score.insiderScore,
        reason: score.reason, source: seed.source.join(','), partial, scannedAt,
      },
      update: {
        name: seed.name, market: seed.market,
        score: score.score, momentumScore: score.momentumScore, fundamentalsScore: score.fundamentalsScore, insiderScore: score.insiderScore,
        reason: score.reason, source: seed.source.join(','), partial, scannedAt, dismissedAt: null,
      },
    })
  }

  return { scannedAt, candidates: results.length }
}
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `npx vitest run tests/lib/discover.test.ts`
Expected: PASS (25 test in totale coi Task 2-3)

- [ ] **Step 6: Commit**

```bash
git add lib/discover.ts tests/lib/discover.test.ts
git commit -m "feat: orchestrate discovery scan and persist candidates"
```

---

### Task 5: API `POST /api/discover` e `PATCH /api/discover/[symbol]`

**Files:**
- Create: `app/api/discover/route.ts`
- Create: `app/api/discover/[symbol]/route.ts`
- Test: `tests/api/discover.test.ts`

**Interfaces:**
- Consumes: `runDiscoveryScan` da `@/lib/discover` (Task 4); `prisma` da `@/lib/db`.
- Produces: route handlers `POST` (in `app/api/discover/route.ts`) e `PATCH` (in `app/api/discover/[symbol]/route.ts`). Usati da Task 6.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/api/discover.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import * as discoverLib from '@/lib/discover'
import { resetDb } from '../helpers/db'
import { POST as scan } from '@/app/api/discover/route'
import { PATCH as dismiss } from '@/app/api/discover/[symbol]/route'

describe('discover API', () => {
  beforeEach(async () => {
    await resetDb()
    vi.restoreAllMocks()
  })

  it('POST runs a scan and returns its summary', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockResolvedValue({ scannedAt: new Date('2026-11-13T10:00:00Z'), candidates: 3 })

    const res = await scan()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.candidates).toBe(3)
  })

  it('POST returns 500 on an unexpected error', async () => {
    vi.spyOn(discoverLib, 'runDiscoveryScan').mockRejectedValue(new Error('boom'))

    const res = await scan()

    expect(res.status).toBe(500)
  })

  it('PATCH marks a candidate as dismissed', async () => {
    await prisma.discoveredCandidate.create({
      data: { symbol: 'MSFT', name: 'Microsoft', market: 'US', score: 50, momentumScore: 50, fundamentalsScore: 50, insiderScore: 50, reason: 'test', source: 'yahoo-movers-us' },
    })

    const res = await dismiss(new Request('http://localhost/api/discover/MSFT', { method: 'PATCH' }), { params: Promise.resolve({ symbol: 'MSFT' }) })

    expect(res.status).toBe(200)
    const stored = await prisma.discoveredCandidate.findUnique({ where: { symbol: 'MSFT' } })
    expect(stored?.dismissedAt).not.toBeNull()
  })

  it('PATCH returns 404 for an unknown candidate', async () => {
    const res = await dismiss(new Request('http://localhost/api/discover/ZZZZ', { method: 'PATCH' }), { params: Promise.resolve({ symbol: 'ZZZZ' }) })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/api/discover.test.ts`
Expected: FAIL — le route non esistono ancora.

- [ ] **Step 3: Implementare le route**

Creare `app/api/discover/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { runDiscoveryScan } from '@/lib/discover'

export const maxDuration = 60

export async function POST() {
  try {
    const result = await runDiscoveryScan()
    return NextResponse.json(result)
  } catch (err) {
    console.error('Discovery scan failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Discovery scan failed' }, { status: 500 })
  }
}
```

Creare `app/api/discover/[symbol]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PATCH(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  const candidate = await prisma.discoveredCandidate.findUnique({ where: { symbol } })
  if (!candidate) {
    return NextResponse.json({ error: `${symbol} is not a known candidate` }, { status: 404 })
  }

  const updated = await prisma.discoveredCandidate.update({
    where: { symbol },
    data: { dismissedAt: new Date() },
  })
  return NextResponse.json({ candidate: updated })
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `npx vitest run tests/api/discover.test.ts`
Expected: PASS (4 test)

- [ ] **Step 5: Commit**

```bash
git add app/api/discover tests/api/discover.test.ts
git commit -m "feat: add discover scan and dismiss API routes"
```

---

### Task 6: Pagina `/scopri` e componenti

**Files:**
- Create: `components/ScanButton.tsx` + `components/ScanButton.module.css`
- Create: `components/CandidateCard.tsx` + `components/CandidateCard.module.css`
- Test: `tests/components/ScanButton.test.tsx`, `tests/components/CandidateCard.test.tsx`
- Create: `app/scopri/page.tsx` + `app/scopri/page.module.css`

**Interfaces:**
- Consumes: `prisma` da `@/lib/db` (nella pagina); nessuna interfaccia nuova esportata oltre ai componenti React stessi.

- [ ] **Step 1: Scrivere il test che fallisce per `ScanButton`**

Creare `tests/components/ScanButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScanButton } from '@/components/ScanButton'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('ScanButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls POST /api/discover when clicked and shows a loading state', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    ;(fetch as any).mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    render(<ScanButton />)
    fireEvent.click(screen.getByRole('button', { name: /scansiona ora/i }))

    expect(screen.getByRole('button', { name: /scansiona ora/i })).toBeDisabled()
    expect(fetch).toHaveBeenCalledWith('/api/discover', expect.objectContaining({ method: 'POST' }))

    resolveFetch({ ok: true, json: () => Promise.resolve({ scannedAt: '2026-11-13T10:00:00Z', candidates: 2 }) })
    await waitFor(() => expect(screen.getByRole('button', { name: /scansiona ora/i })).not.toBeDisabled())
  })

  it('shows an error message when the scan fails', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Discovery scan failed' }) })

    render(<ScanButton />)
    fireEvent.click(screen.getByRole('button', { name: /scansiona ora/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Discovery scan failed')
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/components/ScanButton.test.tsx`
Expected: FAIL — `components/ScanButton.tsx` non esiste ancora.

- [ ] **Step 3: Implementare `ScanButton`**

Creare `components/ScanButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScanButton.module.css'

export function ScanButton() {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/discover', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Scansione falliquita' }))
        setError(data.error ?? 'Scansione falliquita')
        return
      }
      router.refresh()
    } catch {
      setError('Scansione falliquita')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" onClick={handleClick} disabled={scanning} className={styles.button}>
        {scanning ? 'Scansione in corso, può richiedere fino a un minuto…' : 'Scansiona ora'}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
```

Creare `components/ScanButton.module.css`:

```css
.wrap {
  margin-bottom: 24px;
}

.button {
  font-family: var(--font-display);
  font-size: 14px;
  padding: 10px 20px;
  border: 1px solid var(--brass);
  background: transparent;
  color: var(--brass);
  cursor: pointer;
}

.button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.error {
  margin-top: 8px;
  font-size: 13px;
  color: var(--loss);
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/components/ScanButton.test.tsx`
Expected: PASS (2 test)

- [ ] **Step 5: Scrivere il test che fallisce per `CandidateCard`**

Creare `tests/components/CandidateCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CandidateCard } from '@/components/CandidateCard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const CANDIDATE = {
  symbol: 'MSFT',
  name: 'Microsoft',
  market: 'US' as const,
  score: 72,
  reason: 'Movimento forte, fondamentali solidi.',
  partial: false,
}

describe('CandidateCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders symbol, score and reason', () => {
    render(<CandidateCard candidate={CANDIDATE} />)
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText(/Movimento forte/)).toBeInTheDocument()
  })

  it('shows a "dati parziali" badge when partial is true', () => {
    render(<CandidateCard candidate={{ ...CANDIDATE, partial: true }} />)
    expect(screen.getByText(/dati parziali/i)).toBeInTheDocument()
  })

  it('adds the symbol to the watchlist and hides the card on success', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ stock: { symbol: 'MSFT' } }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi a watchlist/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stocks', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.queryByText('MSFT')).not.toBeInTheDocument())
  })

  it('shows "già in watchlist" instead of a generic error on a 409', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: 'MSFT is already in the watchlist' }) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /aggiungi a watchlist/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already in the watchlist')
  })

  it('dismisses the candidate and hides the card', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    render(<CandidateCard candidate={CANDIDATE} />)

    fireEvent.click(screen.getByRole('button', { name: /scarta/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/discover/MSFT', expect.objectContaining({ method: 'PATCH' })))
    await waitFor(() => expect(screen.queryByText('MSFT')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 6: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/components/CandidateCard.test.tsx`
Expected: FAIL — `components/CandidateCard.tsx` non esiste ancora.

- [ ] **Step 7: Implementare `CandidateCard`**

Creare `components/CandidateCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import styles from './CandidateCard.module.css'

export interface CandidateCardData {
  symbol: string
  name: string
  market: 'US' | 'IT'
  score: number
  reason: string
  partial: boolean
}

export function CandidateCard({ candidate }: { candidate: CandidateCardData }) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (hidden) return null

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: candidate.symbol }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Impossibile aggiungere il titolo' }))
        setError(data.error ?? 'Impossibile aggiungere il titolo')
        return
      }
      setHidden(true)
    } catch {
      setError('Impossibile aggiungere il titolo')
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/discover/${candidate.symbol}`, { method: 'PATCH' })
      if (!res.ok) {
        setError('Impossibile scartare il candidato')
        return
      }
      setHidden(true)
    } catch {
      setError('Impossibile scartare il candidato')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={`${styles.marketBadge} ${candidate.market === 'US' ? styles.us : styles.it}`}>{candidate.market}</span>
        <span className={styles.symbol}>{candidate.symbol}</span>
        <span className={styles.name}>{candidate.name}</span>
        {candidate.partial && <span className={styles.partialBadge}>Dati parziali</span>}
        <span className={styles.score}>{candidate.score}</span>
      </div>
      <p className={styles.reason}>{candidate.reason}</p>
      <div className={styles.actions}>
        <button type="button" onClick={add} disabled={busy} className={styles.addButton}>
          Aggiungi a watchlist
        </button>
        <button type="button" onClick={dismiss} disabled={busy} className={styles.dismissButton}>
          Scarta
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
```

Creare `components/CandidateCard.module.css`:

```css
.card {
  border: 1px solid var(--rule);
  border-radius: var(--radius-inner);
  padding: 16px;
  margin-bottom: 12px;
  background: var(--surface-raised);
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.marketBadge {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.us {
  background: color-mix(in srgb, var(--brass) 20%, transparent);
  color: var(--brass);
}

.it {
  background: color-mix(in srgb, var(--amber-bright) 20%, transparent);
  color: var(--amber-bright);
}

.symbol {
  font-family: var(--font-display);
  font-size: 16px;
}

.name {
  font-size: 13px;
  color: var(--muted);
}

.partialBadge {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 2px 6px;
}

.score {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 20px;
}

.reason {
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
}

.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.addButton {
  font-size: 13px;
  padding: 6px 14px;
  border: 1px solid var(--brass);
  background: transparent;
  color: var(--brass);
  cursor: pointer;
}

.dismissButton {
  font-size: 13px;
  padding: 6px 14px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.error {
  margin-top: 8px;
  font-size: 13px;
  color: var(--loss);
}
```

- [ ] **Step 8: Eseguire il test e verificare che passi**

Run: `npx vitest run tests/components/CandidateCard.test.tsx`
Expected: PASS (5 test)

- [ ] **Step 9: Implementare la pagina `/scopri`**

Creare `app/scopri/page.tsx`:

```tsx
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScanButton } from '@/components/ScanButton'
import { CandidateCard } from '@/components/CandidateCard'
import styles from './page.module.css'

async function Candidates() {
  await connection()
  const latest = await prisma.discoveredCandidate.aggregate({ _max: { scannedAt: true } })
  const scannedAt = latest._max.scannedAt

  if (!scannedAt) {
    return <p className={styles.empty}>Nessuno scan ancora eseguito. Premi "Scansiona ora" per iniziare.</p>
  }

  const candidates = await prisma.discoveredCandidate.findMany({
    where: { scannedAt, dismissedAt: null },
    orderBy: { score: 'desc' },
  })

  return (
    <>
      <p className={styles.scannedAt}>
        Ultimo scan: {scannedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle{' '}
        {scannedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {candidates.length === 0 ? (
        <p className={styles.empty}>Nessun candidato trovato in questo scan (o li hai già scartati tutti).</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.symbol}
            candidate={{ symbol: c.symbol, name: c.name, market: c.market as 'US' | 'IT', score: c.score, reason: c.reason, partial: c.partial }}
          />
        ))
      )}
    </>
  )
}

export default function DiscoverPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Scopri nuovi titoli</h1>
      <ScanButton />
      <Candidates />
    </main>
  )
}
```

Creare `app/scopri/page.module.css`:

```css
.shell {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.title {
  font-family: var(--font-display);
  font-size: 22px;
  margin-bottom: 24px;
}

.scannedAt {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}

.empty {
  font-size: 14px;
  color: var(--muted);
}
```

- [ ] **Step 10: Verifica manuale**

Run: `npm run dev`, aprire `/scopri`, cliccare "Scansiona ora", attendere il completamento, verificare che appaiano candidati con punteggio/motivo, badge mercato, badge "Dati parziali" quando presente. Cliccare "Aggiungi a watchlist" su uno e verificare che compaia in `/`. Cliccare "Scarta" su un altro e verificare che non riappaia dopo un reload della pagina (ma torni se si rilancia uno scan che lo ritrova).

- [ ] **Step 11: Eseguire l'intera suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add components/ScanButton.tsx components/ScanButton.module.css components/CandidateCard.tsx components/CandidateCard.module.css tests/components/ScanButton.test.tsx tests/components/CandidateCard.test.tsx app/scopri
git commit -m "feat: add /scopri discovery page"
```
