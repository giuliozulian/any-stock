# Minervini Trend Template (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla pagina del titolo una tab "Minervini" con Trend Template (8 criteri), Relative Strength percentile e stato VCP.

**Architecture:** Funzioni pure in `lib/minervini.ts` (SMA, trend template, VCP, RS) alimentate da barre giornaliere a 2 anni (nuovo `getDailyBars` in `lib/history.ts`, senza toccare `getPriceHistory`). Un data layer `lib/minervini-data.ts` calcola il percentile RS contro watchlist + candidati. La UI è un pannello server renderizzato in `Suspense` dentro `StockTabs`.

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript, CSS modules, Prisma, vitest + Testing Library.

## Global Constraints

- Testi UI in italiano.
- I test vivono in `tests/lib/*.test.ts` e `tests/components/*.test.tsx`; alias `@/` = radice del repo. Comando: `npx vitest run <file>`.
- `app/stock/[symbol]/page.tsx` ha **modifiche non committate dell'utente**: nel commit includere solo le righe di questo piano (`git add -p`), mai `git add` dell'intero file.
- Spec: `docs/superpowers/specs/2026-11-16-minervini-trend-template-design.md`. Deviazione intenzionale: invece di cambiare `getPriceHistory` (1y, usato dal grafico) si aggiunge `getDailyBars` (2y + OHLC volume).
- Soglie: SMA 50/150/200; pendenza SMA200 su 22 barre; ≥30% sopra il minimo 52w; entro 25% dal massimo 52w; RS ≥ 70; RS non affidabile con meno di 5 pari; stop suggerito 8% sotto il pivot.

---

### Task 1: Barre giornaliere (`getDailyBars`)

**Files:**
- Modify: `lib/history.ts` (append in fondo)
- Test: `tests/lib/history-bars.test.ts`

**Interfaces:**
- Produces: `interface Bar { t: number; high: number; low: number; close: number; volume: number }`, `parseChartBars(json: unknown): Bar[]` (oldest first, scarta righe senza close/high/low positivi, volume mancante → 0), `getDailyBars(symbol: string): Promise<Bar[]>` (2y, cache 6h, `[]` su errore).

- [ ] **Step 1: Write the failing test** — crea `tests/lib/history-bars.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseChartBars } from '@/lib/history'

const body = (q: Record<string, unknown>) => ({ chart: { result: [{ timestamp: [100, 200, 300], indicators: { quote: [q] } }] } })

describe('parseChartBars', () => {
  it('maps OHLC rows to bars in milliseconds, oldest first', () => {
    const bars = parseChartBars(body({ high: [11, 12, 13], low: [9, 10, 11], close: [10, 11, 12], volume: [1000, 2000, 3000] }))
    expect(bars).toEqual([
      { t: 100_000, high: 11, low: 9, close: 10, volume: 1000 },
      { t: 200_000, high: 12, low: 10, close: 11, volume: 2000 },
      { t: 300_000, high: 13, low: 11, close: 12, volume: 3000 },
    ])
  })

  it('drops rows without a valid close/high/low and defaults a missing volume to 0', () => {
    const bars = parseChartBars(body({ high: [11, null, 13], low: [9, 10, 11], close: [10, 11, 12], volume: [null, 2000, 3000] }))
    expect(bars.map((b) => [b.t, b.volume])).toEqual([[100_000, 0], [300_000, 3000]])
  })

  it('returns an empty list for malformed payloads', () => {
    expect(parseChartBars(null)).toEqual([])
    expect(parseChartBars({ chart: { result: null } })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/history-bars.test.ts`
Expected: FAIL (`parseChartBars` is not exported / not a function).

- [ ] **Step 3: Implement** — in coda a `lib/history.ts`:

```ts
export interface Bar {
  t: number
  high: number
  low: number
  close: number
  volume: number
}

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

// Daily OHLCV bars from a Yahoo chart payload, oldest first. Rows without positive close/high/low are dropped.
export function parseChartBars(json: unknown): Bar[] {
  const result = (json as { chart?: { result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<Record<string, unknown>> } }> | null } } | null)?.chart?.result?.[0]
  const stamps = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(stamps) || !q) return []
  const { high, low, close, volume } = q as Record<string, unknown[] | undefined>
  const bars: Bar[] = []
  stamps.forEach((t, i) => {
    const h = high?.[i]
    const l = low?.[i]
    const c = close?.[i]
    if (typeof t !== 'number' || !isPositive(h) || !isPositive(l) || !isPositive(c)) return
    const v = volume?.[i]
    bars.push({ t: t * 1000, high: h, low: l, close: c, volume: typeof v === 'number' && Number.isFinite(v) ? v : 0 })
  })
  return bars.sort((a, b) => a.t - b.t)
}

const BARS_TTL_MS = 6 * 60 * 60 * 1000
const barsCache = new Map<string, { at: number; bars: Bar[] }>()

// Two years of daily bars (a 200-day average plus its one-month slope needs about 14 months). Falls back to the stale series on failure.
export async function getDailyBars(symbol: string): Promise<Bar[]> {
  const key = symbol.toUpperCase()
  const hit = barsCache.get(key)
  if (hit && Date.now() - hit.at < BARS_TTL_MS) return hit.bars

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=2y&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return hit?.bars ?? []
    const bars = parseChartBars(await res.json())
    if (bars.length > 0) barsCache.set(key, { at: Date.now(), bars })
    return bars.length > 0 ? bars : (hit?.bars ?? [])
  } catch {
    return hit?.bars ?? []
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/history-bars.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/history.ts tests/lib/history-bars.test.ts
git commit -m "feat: add daily OHLCV bars history

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Trend Template e RS (`lib/minervini.ts`)

**Files:**
- Create: `lib/minervini.ts`
- Test: `tests/lib/minervini.test.ts`

**Interfaces:**
- Consumes: `Bar` da `@/lib/history`.
- Produces:
  - `sma(values: number[], n: number, end?: number): number | null` — media delle `n` chiusure che terminano all'indice `end` escluso (default `values.length`).
  - `weightedReturn(closes: number[]): number | null` — 40% ultimo trimestre (63 barre) + 20% ciascuno dei 3 precedenti; `null` con meno di 253 chiusure.
  - `percentileRank(value: number, peers: number[]): number` — 0–100, pari = mezzo punto.
  - `interface Criterion { id: number; label: string; ok: boolean; value: string }`
  - `interface TrendTemplate { criteria: Criterion[]; passedCount: number; total: number; passed: boolean; stage2: boolean }`
  - `evaluateTrendTemplate(bars: Bar[], rsPercentile: number | null): TrendTemplate | null` — `null` con meno di 222 barre. Con `rsPercentile === null` il criterio 8 resta in lista con `ok: false`, `value: 'non affidabile'` ma non conta: `total = 7`. `passed` = tutti i criteri contati OK; `stage2` = criteri 1–5 OK.

- [ ] **Step 1: Write the failing test** — crea `tests/lib/minervini.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { evaluateTrendTemplate, percentileRank, sma, weightedReturn } from '@/lib/minervini'

const bar = (i: number, close: number): Bar => ({ t: i * 86_400_000, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 })
const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => bar(i, f(i)))

describe('sma', () => {
  it('averages the last n values, optionally ending before an index', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4)
    expect(sma([1, 2, 3, 4, 5], 3, 4)).toBe(3)
  })
  it('returns null when there are not enough values', () => {
    expect(sma([1, 2], 3)).toBeNull()
  })
})

describe('weightedReturn', () => {
  it('weights the last quarter 40% and the three before 20% each', () => {
    const closes = Array.from({ length: 253 }, (_, i) => 100 * Math.pow(1.001, i))
    const q = Math.pow(1.001, 63) - 1
    expect(weightedReturn(closes)).toBeCloseTo(q * 1.0, 3)
  })
  it('needs 253 closes', () => {
    expect(weightedReturn(Array(252).fill(100))).toBeNull()
  })
})

describe('percentileRank', () => {
  it('ranks a value among its peers', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11])).toBe(40)
    expect(percentileRank(2, [2, 2])).toBe(50)
  })
})

describe('evaluateTrendTemplate', () => {
  const uptrend = series(300, (i) => 50 + i * 0.5)

  it('passes all 8 criteria on a steady uptrend with strong RS', () => {
    const t = evaluateTrendTemplate(uptrend, 85)!
    expect(t.criteria).toHaveLength(8)
    expect(t.total).toBe(8)
    expect(t.passedCount).toBe(8)
    expect(t.passed).toBe(true)
    expect(t.stage2).toBe(true)
  })

  it('fails on a downtrend', () => {
    const t = evaluateTrendTemplate(series(300, (i) => 200 - i * 0.4), 85)!
    expect(t.passed).toBe(false)
    expect(t.stage2).toBe(false)
    expect(t.criteria.find((c) => c.id === 1)!.ok).toBe(false)
  })

  it('fails criterion 8 when RS is below 70', () => {
    const t = evaluateTrendTemplate(uptrend, 40)!
    expect(t.criteria.find((c) => c.id === 8)!.ok).toBe(false)
    expect(t.passed).toBe(false)
    expect(t.stage2).toBe(true)
  })

  it('leaves criterion 8 out of the count when RS is unreliable', () => {
    const t = evaluateTrendTemplate(uptrend, null)!
    expect(t.total).toBe(7)
    expect(t.passedCount).toBe(7)
    expect(t.passed).toBe(true)
    expect(t.criteria.find((c) => c.id === 8)!.value).toBe('non affidabile')
  })

  it('returns null with fewer than 222 bars', () => {
    expect(evaluateTrendTemplate(series(221, (i) => 100 + i), 80)).toBeNull()
  })
})
```

Nota sul test `weightedReturn`: su una serie esponenziale ogni trimestre rende `q`, quindi la somma pesata è `q × (0.4 + 0.2×3) = q`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/minervini.test.ts`
Expected: FAIL (module `@/lib/minervini` not found).

- [ ] **Step 3: Implement** — crea `lib/minervini.ts`:

```ts
import type { Bar } from '@/lib/history'

const WEEK52 = 252
const SLOPE_BARS = 22
const QUARTER = 63

export function sma(values: number[], n: number, end = values.length): number | null {
  if (end < n || end > values.length) return null
  let sum = 0
  for (let i = end - n; i < end; i++) sum += values[i]
  return sum / n
}

// Quarterly returns over the last year, the most recent quarter counting double.
export function weightedReturn(closes: number[]): number | null {
  const n = closes.length
  if (n < QUARTER * 4 + 1) return null
  const ret = (k: number) => closes[n - 1 - k * QUARTER] / closes[n - 1 - (k + 1) * QUARTER] - 1
  return 0.4 * ret(0) + 0.2 * (ret(1) + ret(2) + ret(3))
}

export function percentileRank(value: number, peers: number[]): number {
  if (peers.length === 0) return 0
  const below = peers.filter((p) => p < value).length
  const equal = peers.filter((p) => p === value).length
  return ((below + equal / 2) / peers.length) * 100
}

export interface Criterion {
  id: number
  label: string
  ok: boolean
  value: string
}

export interface TrendTemplate {
  criteria: Criterion[]
  passedCount: number
  total: number
  passed: boolean
  stage2: boolean
}

const fmt = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2 })
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`

export function evaluateTrendTemplate(bars: Bar[], rsPercentile: number | null): TrendTemplate | null {
  if (bars.length < 200 + SLOPE_BARS) return null
  const closes = bars.map((b) => b.close)
  const price = closes[closes.length - 1]
  const sma50 = sma(closes, 50)!
  const sma150 = sma(closes, 150)!
  const sma200 = sma(closes, 200)!
  const sma200Before = sma(closes, 200, closes.length - SLOPE_BARS)!
  const year = bars.slice(-WEEK52)
  const high52 = Math.max(...year.map((b) => b.high))
  const low52 = Math.min(...year.map((b) => b.low))

  const criteria: Criterion[] = [
    { id: 1, label: 'Prezzo sopra le medie a 150 e 200 giorni', ok: price > sma150 && price > sma200, value: `${fmt(price)} vs ${fmt(sma150)} / ${fmt(sma200)}` },
    { id: 2, label: 'Media a 150 giorni sopra quella a 200', ok: sma150 > sma200, value: `${fmt(sma150)} vs ${fmt(sma200)}` },
    { id: 3, label: 'Media a 200 giorni in salita da almeno un mese', ok: sma200 > sma200Before, value: `${fmt(sma200Before)} → ${fmt(sma200)}` },
    { id: 4, label: 'Media a 50 giorni sopra quelle a 150 e 200', ok: sma50 > sma150 && sma50 > sma200, value: `${fmt(sma50)} vs ${fmt(sma150)} / ${fmt(sma200)}` },
    { id: 5, label: 'Prezzo sopra la media a 50 giorni', ok: price > sma50, value: `${fmt(price)} vs ${fmt(sma50)}` },
    { id: 6, label: 'Almeno 30% sopra il minimo a 52 settimane', ok: price >= low52 * 1.3, value: pct(price / low52 - 1) },
    { id: 7, label: 'Entro il 25% dal massimo a 52 settimane', ok: price >= high52 * 0.75, value: pct(price / high52 - 1) },
    {
      id: 8,
      label: 'Forza relativa almeno 70',
      ok: rsPercentile !== null && rsPercentile >= 70,
      value: rsPercentile === null ? 'non affidabile' : String(Math.round(rsPercentile)),
    },
  ]
  const counted = rsPercentile === null ? criteria.slice(0, 7) : criteria
  const passedCount = counted.filter((c) => c.ok).length
  return {
    criteria,
    passedCount,
    total: counted.length,
    passed: passedCount === counted.length,
    stage2: criteria.slice(0, 5).every((c) => c.ok),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/minervini.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini.ts tests/lib/minervini.test.ts
git commit -m "feat: add Minervini trend template evaluation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Rilevamento VCP

**Files:**
- Modify: `lib/minervini.ts` (append)
- Modify: `tests/lib/minervini.test.ts` (append `describe`, riusa `bar`/`series`)

**Interfaces:**
- Consumes: `Bar`.
- Produces: `interface Vcp { contractions: number[]; pivot: number | null; volumeDryUp: boolean; suggestedStop: number | null }` (contrazioni come frazioni, es. `0.25`) e `detectVcp(bars: Bar[]): Vcp`. Usa gli ultimi 150 giorni, zigzag con inversione del 5% sulle chiusure; contrazioni = ultimo tratto di ritracciamenti strettamente decrescenti (almeno 2), altrimenti `contractions: []`, `pivot: null`, `suggestedStop: null`. Il pivot è l'ultimo massimo di swing; `suggestedStop = pivot × 0.92`; `volumeDryUp` = media volume ultime 10 barre < media ultime 50.

- [ ] **Step 1: Write the failing test** — in coda a `tests/lib/minervini.test.ts` (aggiungi `detectVcp` all'import da `@/lib/minervini`):

```ts
// Piecewise-linear closes through the given turning points, `leg` bars per leg.
const path = (points: number[], leg = 10, volume = 1_000_000): Bar[] => {
  const closes: number[] = [points[0]]
  for (let k = 1; k < points.length; k++) {
    for (let s = 1; s <= leg; s++) closes.push(points[k - 1] + ((points[k] - points[k - 1]) * s) / leg)
  }
  return closes.map((c, i) => ({ t: i * 86_400_000, high: c, low: c, close: c, volume }))
}

describe('detectVcp', () => {
  // 25% → 12% → 6% pullbacks, each rally failing to exceed the previous peak by much.
  const base = path([80, 100, 75, 95, 83.6, 94, 88.36, 93])

  it('finds progressively smaller contractions and the pivot', () => {
    const v = detectVcp(base)
    expect(v.contractions).toHaveLength(3)
    expect(v.contractions[0]).toBeCloseTo(0.25, 2)
    expect(v.contractions[1]).toBeCloseTo(0.12, 2)
    expect(v.contractions[2]).toBeCloseTo(0.06, 2)
    expect(v.pivot).toBeCloseTo(94, 1)
    expect(v.suggestedStop).toBeCloseTo(94 * 0.92, 1)
  })

  it('does not flag a base whose pullbacks grow', () => {
    const v = detectVcp(path([80, 100, 94, 99, 80, 95]))
    expect(v.contractions).toEqual([])
    expect(v.pivot).toBeNull()
    expect(v.suggestedStop).toBeNull()
  })

  it('flags volume dry-up when recent volume is below the 50-bar average', () => {
    const loud = base.map((b, i) => ({ ...b, volume: i >= base.length - 10 ? 300_000 : 1_000_000 }))
    expect(detectVcp(loud).volumeDryUp).toBe(true)
    expect(detectVcp(base).volumeDryUp).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/minervini.test.ts -t detectVcp`
Expected: FAIL (`detectVcp` is not a function).

- [ ] **Step 3: Implement** — in coda a `lib/minervini.ts`:

```ts
interface Swing {
  value: number
  type: 'high' | 'low'
}

// Zigzag on closes: a swing is confirmed once price reverses by `reversal` from its extreme.
function swings(closes: number[], reversal: number): Swing[] {
  const out: Swing[] = []
  let hi = 0
  let lo = 0
  let dir: 'up' | 'down' | null = null
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i]
    if (dir === null) {
      if (c >= closes[lo] * (1 + reversal)) {
        out.push({ value: closes[lo], type: 'low' })
        dir = 'up'
        hi = i
      } else if (c <= closes[hi] * (1 - reversal)) {
        out.push({ value: closes[hi], type: 'high' })
        dir = 'down'
        lo = i
      } else {
        if (c > closes[hi]) hi = i
        if (c < closes[lo]) lo = i
      }
    } else if (dir === 'up') {
      if (c > closes[hi]) hi = i
      else if (c <= closes[hi] * (1 - reversal)) {
        out.push({ value: closes[hi], type: 'high' })
        dir = 'down'
        lo = i
      }
    } else if (c < closes[lo]) lo = i
    else if (c >= closes[lo] * (1 + reversal)) {
      out.push({ value: closes[lo], type: 'low' })
      dir = 'up'
      hi = i
    }
  }
  if (dir === 'up') out.push({ value: closes[hi], type: 'high' })
  else if (dir === 'down') out.push({ value: closes[lo], type: 'low' })
  return out
}

export interface Vcp {
  contractions: number[]
  pivot: number | null
  volumeDryUp: boolean
  suggestedStop: number | null
}

const VCP_WINDOW = 150
const VCP_REVERSAL = 0.05
const STOP_BELOW_PIVOT = 0.08

const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length

export function detectVcp(bars: Bar[]): Vcp {
  const recent = bars.slice(-VCP_WINDOW)
  const volumes = recent.map((b) => b.volume)
  const volumeDryUp = volumes.length >= 50 && avg(volumes.slice(-10)) < avg(volumes.slice(-50))

  const points = swings(recent.map((b) => b.close), VCP_REVERSAL)
  const depths: number[] = []
  const highs: number[] = []
  points.forEach((p, k) => {
    const next = points[k + 1]
    if (p.type === 'high' && next?.type === 'low') {
      depths.push((p.value - next.value) / p.value)
      highs.push(p.value)
    }
  })

  // Walk back over the trailing run of strictly shrinking pullbacks.
  let start = depths.length - 1
  while (start > 0 && depths[start] < depths[start - 1]) start--
  const contractions = start >= 0 ? depths.slice(start) : []
  if (contractions.length < 2) return { contractions: [], pivot: null, volumeDryUp, suggestedStop: null }
  // The pivot is the peak just before the last pullback, not a rally still in progress.
  const pivot = highs[highs.length - 1]
  return { contractions, pivot, volumeDryUp, suggestedStop: pivot * (1 - STOP_BELOW_PIVOT) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/minervini.test.ts`
Expected: PASS (tutti).

- [ ] **Step 5: Commit**

```bash
git add lib/minervini.ts tests/lib/minervini.test.ts
git commit -m "feat: detect volatility contraction patterns

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Data layer (RS contro watchlist + candidati)

**Files:**
- Create: `lib/minervini-data.ts`
- Test: `tests/lib/minervini-data.test.ts`

**Interfaces:**
- Consumes: `getDailyBars`, `prisma` (`@/lib/db`), `evaluateTrendTemplate`, `detectVcp`, `weightedReturn`, `percentileRank`.
- Produces: `interface MinerviniAnalysis { template: TrendTemplate; vcp: Vcp; peerCount: number }`, `buildAnalysis(bars: Bar[], peerReturns: number[]): MinerviniAnalysis | null` (puro; RS `null` con meno di 5 pari o rendimento proprio non calcolabile), `getMinerviniAnalysis(symbol: string): Promise<MinerviniAnalysis | null>` (max 40 pari da watchlist + candidati non scartati).

- [ ] **Step 1: Write the failing test** — crea `tests/lib/minervini-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { buildAnalysis } from '@/lib/minervini-data'

const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const c = 50 + i * 0.5
  return { t: i * 86_400_000, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }
})

describe('buildAnalysis', () => {
  it('ranks the stock against peers and counts all 8 criteria', () => {
    const a = buildAnalysis(bars, [-0.2, -0.1, 0, 0.05, 0.1, 0.15])!
    expect(a.peerCount).toBe(6)
    expect(a.template.total).toBe(8)
  })

  it('marks RS unreliable with fewer than 5 peers', () => {
    const a = buildAnalysis(bars, [0.1, 0.2])!
    expect(a.template.total).toBe(7)
  })

  it('returns null without enough history', () => {
    expect(buildAnalysis(bars.slice(0, 100), [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/minervini-data.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — crea `lib/minervini-data.ts`:

```ts
import { prisma } from '@/lib/db'
import { getDailyBars, type Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate, percentileRank, weightedReturn, type TrendTemplate, type Vcp } from '@/lib/minervini'

const MIN_PEERS = 5
const MAX_PEERS = 40

export interface MinerviniAnalysis {
  template: TrendTemplate
  vcp: Vcp
  peerCount: number
}

export function buildAnalysis(bars: Bar[], peerReturns: number[]): MinerviniAnalysis | null {
  const own = weightedReturn(bars.map((b) => b.close))
  const rs = own !== null && peerReturns.length >= MIN_PEERS ? percentileRank(own, peerReturns) : null
  const template = evaluateTrendTemplate(bars, rs)
  if (!template) return null
  return { template, vcp: detectVcp(bars), peerCount: peerReturns.length }
}

async function peerSymbols(symbol: string): Promise<string[]> {
  const [watched, discovered] = await Promise.all([
    prisma.stock.findMany({ select: { symbol: true } }),
    prisma.discoveredCandidate.findMany({ where: { dismissedAt: null }, select: { symbol: true } }),
  ])
  const own = symbol.toUpperCase()
  const all = new Set([...watched, ...discovered].map((s) => s.symbol.toUpperCase()))
  all.delete(own)
  return [...all].slice(0, MAX_PEERS)
}

export async function getMinerviniAnalysis(symbol: string): Promise<MinerviniAnalysis | null> {
  const [bars, peers] = await Promise.all([getDailyBars(symbol), peerSymbols(symbol)])
  if (bars.length === 0) return null
  const returns = await Promise.all(peers.map(async (s) => weightedReturn((await getDailyBars(s)).map((b) => b.close))))
  return buildAnalysis(bars, returns.filter((r): r is number => r !== null))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/minervini-data.test.ts`
Expected: PASS. Se l'import di `@/lib/db` richiede `DATABASE_URL` all'import, verificare l'esito: gli altri test (`tests/lib/discover.test.ts`) importano già `db`, quindi l'ambiente è lo stesso.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini-data.ts tests/lib/minervini-data.test.ts
git commit -m "feat: compute Minervini analysis with peer RS percentile

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Pannello UI e tab

**Files:**
- Create: `components/MinerviniPanel.tsx`, `components/MinerviniPanel.module.css`, `components/MinerviniSection.tsx`
- Modify: `app/stock/[symbol]/page.tsx` (import + una voce di tab; dopo `id: 'andamento'`)
- Test: `tests/components/MinerviniPanel.test.tsx`

**Interfaces:**
- Consumes: `MinerviniAnalysis` da `@/lib/minervini-data`, `getMinerviniAnalysis`.
- Produces: `MinerviniPanel({ analysis }: { analysis: MinerviniAnalysis | null })` (sincrono, testabile), `MinerviniSection({ symbol }: { symbol: string })` (async server component).

- [ ] **Step 1: Write the failing test** — crea `tests/components/MinerviniPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import type { MinerviniAnalysis } from '@/lib/minervini-data'

const criteria = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, label: `Criterio ${i + 1}`, ok: i !== 7, value: `v${i + 1}` }))
const analysis: MinerviniAnalysis = {
  template: { criteria, passedCount: 7, total: 8, passed: false, stage2: true },
  vcp: { contractions: [0.25, 0.12, 0.06], pivot: 94, volumeDryUp: true, suggestedStop: 86.48 },
  peerCount: 12,
}

describe('MinerviniPanel', () => {
  it('shows the score, the criteria and the VCP levels', () => {
    render(<MinerviniPanel analysis={analysis} />)
    expect(screen.getByText('7/8 criteri')).toBeInTheDocument()
    expect(screen.getByText('Stage 2')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByText(/25% → 12% → 6%/)).toBeInTheDocument()
    expect(screen.getByText(/Pivot/)).toBeInTheDocument()
    expect(screen.getByText(/Stop suggerito/)).toBeInTheDocument()
  })

  it('says when no VCP is detected', () => {
    render(<MinerviniPanel analysis={{ ...analysis, vcp: { contractions: [], pivot: null, volumeDryUp: false, suggestedStop: null } }} />)
    expect(screen.getByText(/Nessuna base VCP rilevata/)).toBeInTheDocument()
  })

  it('says the data is insufficient when there is no analysis', () => {
    render(<MinerviniPanel analysis={null} />)
    expect(screen.getByText(/Dati insufficienti/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/components/MinerviniPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`components/MinerviniPanel.module.css`:

```css
.panel {
  display: grid;
  gap: 16px;
  margin-top: 24px;
  min-width: 0;
}

.card {
  min-width: 0;
  padding: 20px 20px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--card-shadow);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.title {
  font-size: 17px;
  font-weight: 600;
}

.score {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.badge {
  padding: 2px 10px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  font-size: 13px;
}

.list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 15px;
}

.value {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.empty,
.note {
  font-size: 14px;
  line-height: 1.5;
}
```

`components/MinerviniPanel.tsx`:

```tsx
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import styles from './MinerviniPanel.module.css'

const pct = (v: number) => `${Math.round(v * 100)}%`
const price = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function MinerviniPanel({ analysis }: { analysis: MinerviniAnalysis | null }) {
  if (!analysis) return <p className={styles.empty}>Dati insufficienti: servono almeno 222 giorni di quotazioni per valutare il Trend Template.</p>

  const { template, vcp, peerCount } = analysis
  return (
    <div className={styles.panel}>
      <section className={styles.card} aria-labelledby="minervini-template-title">
        <div className={styles.head}>
          <h2 id="minervini-template-title" className={styles.title}>
            Trend Template
          </h2>
          <span className={styles.score}>{`${template.passedCount}/${template.total} criteri`}</span>
          {template.stage2 && <span className={styles.badge}>Stage 2</span>}
        </div>
        <ul className={styles.list}>
          {template.criteria.map((c) => (
            <li key={c.id} className={styles.item}>
              <span>
                <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}
                <span className="sr-only">{c.ok ? ': soddisfatto' : ': non soddisfatto'}</span>
              </span>
              <span className={styles.value}>{c.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.card} aria-labelledby="minervini-vcp-title">
        <h2 id="minervini-vcp-title" className={styles.title}>
          Contrazione di volatilità (VCP)
        </h2>
        {vcp.pivot === null ? (
          <p className={styles.empty}>Nessuna base VCP rilevata: servono almeno due contrazioni via via più piccole.</p>
        ) : (
          <>
            <p className={styles.empty}>{`Contrazioni: ${vcp.contractions.map(pct).join(' → ')}. Volume ${vcp.volumeDryUp ? 'in calo' : 'non in calo'} nelle ultime 10 sedute.`}</p>
            <p className={styles.empty}>{`Pivot ${price(vcp.pivot)}. Stop suggerito ${price(vcp.suggestedStop!)} (8% sotto il pivot).`}</p>
          </>
        )}
      </section>

      <p className={styles.note}>
        {peerCount >= 5
          ? `Forza relativa calcolata sul rendimento a 12 mesi, rispetto a ${peerCount} titoli tra watchlist e candidati.`
          : 'Forza relativa non affidabile: servono almeno 5 altri titoli tra watchlist e candidati.'}{' '}
        Strumento di analisi, non un consiglio di investimento. Fonte: Yahoo Finance.
      </p>
    </div>
  )
}
```

`components/MinerviniSection.tsx`:

```tsx
import { getMinerviniAnalysis } from '@/lib/minervini-data'
import { MinerviniPanel } from '@/components/MinerviniPanel'

export async function MinerviniSection({ symbol }: { symbol: string }) {
  const analysis = await getMinerviniAnalysis(symbol).catch(() => null)
  return <MinerviniPanel analysis={analysis} />
}
```

In `app/stock/[symbol]/page.tsx`: aggiungere agli import `import { MinerviniSection } from '@/components/MinerviniSection'` e, subito dopo la voce `id: 'andamento'` (righe ~519-523), inserire:

```tsx
          {
            id: 'minervini',
            label: 'Minervini',
            content: (
              <Suspense fallback={<p className={styles.stale}>Calcolo il Trend Template…</p>}>
                <MinerviniSection symbol={stock.symbol} />
              </Suspense>
            ),
          },
```

Verificare che la classe `sr-only` esista (`grep -n "sr-only" app/globals.css`); se manca, sostituire lo `span` nascosto con `aria-label` sull'`li` (`aria-label={\`${c.label}: ${c.ok ? 'soddisfatto' : 'non soddisfatto'}\`}`) e rimuovere lo span `sr-only`.

- [ ] **Step 4: Run tests, lint and type-check**

Run: `npx vitest run tests/components/MinerviniPanel.test.tsx tests/lib/minervini.test.ts tests/lib/minervini-data.test.ts tests/lib/history-bars.test.ts && npx eslint components/Minervini* lib/minervini* lib/history.ts && npx tsc --noEmit`
Expected: tutto verde. Se il test `getAllByRole('listitem')` conta anche altri elementi, restringere con `within(screen.getByRole('list'))`.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, aprire `/stock/AAPL#minervini` (o un titolo in watchlist) e controllare: 8 criteri, badge Stage 2 coerente, sezione VCP, nota sulla RS. Poi fermare il server.

- [ ] **Step 6: Commit** (page.tsx ha modifiche dell'utente: stage solo le righe del piano)

```bash
git add components/MinerviniPanel.tsx components/MinerviniPanel.module.css components/MinerviniSection.tsx tests/components/MinerviniPanel.test.tsx
git add -p "app/stock/[symbol]/page.tsx"   # accettare solo l'import e la voce di tab 'minervini'
git commit -m "feat: add Minervini tab to the stock page

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
