# Scanner Minervini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pagina `/scanner` che, con un click, scansiona i titoli dell'S&P 500 con il Trend Template di Minervini, calcola la forza relativa sull'universo intero e mostra chi supera 8 criteri su 8 (e chi 7 su 8), con stato VCP e pivot.

**Architecture:** Funzioni pure in `lib/scanner.ts` (`scanSymbol`, `finalize`) riusano `lib/minervini.ts`. Stato della scansione in DB (`ScanRun`, `ScanResult`); la pagina chiama `POST /api/scanner/step` a blocchi di 25 titoli finché la scansione è chiusa. Il passo finale calcola RS e conteggio su 8 per tutte le righe.

**Tech Stack:** Next.js 16 (App Router, route handler, server components), TypeScript, Prisma 7 + Postgres, CSS modules, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-minervini-scanner-design.md`. Deviazioni intenzionali: (1) lo script di aggiornamento dell'universo sta in `data/update-sp500.mjs`, perché `scripts/` è ignorata da git; (2) il componente del pulsante si chiama `ScannerButton`, perché `components/ScanButton.tsx` esiste già (Scopri); (3) in `stepRun` le righe si scrivono **prima** di avanzare il cursore (scrittura idempotente grazie a `skipDuplicates`), così il cursore avanza solo a dati salvati e una seconda scheda sullo stesso blocco non duplica nulla.

## Global Constraints

- Testi UI in italiano; messaggi di commit in inglese, stile convenzionale (`feat:`, `fix:`, `refactor:`, `docs:`), **senza trailer `Co-Authored-By` e senza menzionare Claude o AI** (regola utente in `~/.claude/CLAUDE.md`).
- AGENTS.md: questo Next.js ha differenze rispetto al noto. Prima di scrivere le route leggere `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`; le pagine seguono `app/scopri/page.tsx` (`await connection()` prima di leggere dal DB, dentro `Suspense`).
- Test in `tests/lib/*.test.ts`, `tests/api/*.test.ts`, `tests/components/*.test.tsx`; alias `@/` = radice. Comando: `npx vitest run <file>`. I test su DB richiedono Postgres di test: `docker compose -f docker-compose.test.yml up -d` e, la prima volta, `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy`.
- Soglia unica per la storia minima: `RS_MIN_BARS = 253` (`QUARTER * 4 + 1`, richiesto da `weightedReturn`); `evaluateTrendTemplate` ne chiede 222, quindi 253 è sempre sufficiente.
- RS: soglia `RS_MIN = 70`; il percentile di ogni titolo è calcolato contro **tutti gli altri** titoli letti (come in `lib/minervini-data.ts`), con almeno `MIN_PEERS = 5` pari, altrimenti `rs = null`.
- Blocco di scansione: 25 titoli, 5 richieste Yahoo in parallelo, timeout 10 s ciascuna (già in `getDailyBars`). Il secondo tentativo sui falliti parte solo se sono passati meno di 30 s dall'inizio del blocco, per restare sotto `maxDuration = 60`.
- Attesa minima tra due scansioni complete: 1 ora. Si tengono le ultime 2 scansioni complete.
- `scripts/` è ignorata da git: nessun file da committare lì.
- Nessuna modifica a `components/ScanButton.tsx`, `lib/minervini-data.ts` né alla scheda titolo oltre a quanto scritto nel Task 1.

## Review Focus

Ingressi e condizioni che la spec implica ma non descrive passo per passo; ognuno ha un test nel task indicato.

1. Yahoo restituisce meno di 253 barre o nessuna barra → riga `unread`, la scansione continua (Task 3 e 5).
2. Quasi tutti i titoli non letti, oppure 0/1 titolo leggibile → `finalize` non divide per zero, `rs = null`, scansione chiusa, avviso "dati parziali" in pagina (Task 3, 5, 7).
3. Due schede eseguono lo stesso blocco → una sola avanza il cursore, nessuna riga duplicata, chiusura una sola volta (Task 5).
4. `step` con `runId` sconosciuto, mancante o di una scansione già chiusa → 404/400/409 senza scrivere nulla (Task 6).
5. `POST /api/scanner` entro 1 ora da una scansione completa → 429 con ora di ripresa; con una scansione `running` la riprende (Task 5 e 6).
6. Simboli con punto (`BRK.B`, `BF.B`): Yahoo riceve `BRK-B`, il DB e la pagina mostrano `BRK.B` (Task 2 e 5).

---

### Task 1: Costanti condivise in `lib/minervini.ts`

**Files:**
- Modify: `lib/minervini.ts`
- Modify: `components/MinerviniPanel.tsx:171`
- Test: `tests/lib/minervini.test.ts`

**Interfaces:**
- Produces (da `lib/minervini.ts`):
  - `export const RS_MIN = 70`
  - `export const RS_MIN_BARS = 253`
  - `export const TREND_TEMPLATE_LABELS: readonly [string, string, string, string, string, string, string, string]` (indice 0 = criterio 1 … indice 7 = criterio 8)
  - `export const VCP_STATUS_LABEL: Record<VcpStatus, string>`

- [ ] **Step 1: Write the failing test** — in `tests/lib/minervini.test.ts` aggiungere agli import `RS_MIN, RS_MIN_BARS, TREND_TEMPLATE_LABELS, VCP_STATUS_LABEL` da `@/lib/minervini` e in fondo al file:

```ts
describe('shared constants', () => {
  it('exposes the RS threshold and the minimum history for the weighted return', () => {
    expect(RS_MIN).toBe(70)
    expect(RS_MIN_BARS).toBe(253)
    expect(weightedReturn(Array.from({ length: RS_MIN_BARS - 1 }, () => 100))).toBeNull()
    expect(weightedReturn(Array.from({ length: RS_MIN_BARS }, () => 100))).not.toBeNull()
  })

  it('uses the exported labels for the eight criteria, in order', () => {
    const template = evaluateTrendTemplate(series(300, (i) => 100 + i), 80)!
    expect(TREND_TEMPLATE_LABELS).toHaveLength(8)
    expect(template.criteria.map((c) => c.label)).toEqual([...TREND_TEMPLATE_LABELS])
  })

  it('labels every VCP status', () => {
    expect(VCP_STATUS_LABEL).toEqual({ forming: 'Base pronta', breakout: 'In rottura', extended: 'Troppo tardi', failed: 'Base rotta' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/minervini.test.ts`
Expected: FAIL (`RS_MIN` / `TREND_TEMPLATE_LABELS` non esportati).

- [ ] **Step 3: Write minimal implementation** — in `lib/minervini.ts`, dopo la riga `const QUARTER = 63` aggiungere:

```ts
export const RS_MIN = 70
// weightedReturn needs four full quarters plus the starting close.
export const RS_MIN_BARS = QUARTER * 4 + 1

export const TREND_TEMPLATE_LABELS = [
  'Prezzo sopra le medie a 150 e 200 giorni',
  'Media a 150 giorni sopra quella a 200',
  'Media a 200 giorni in salita da almeno un mese',
  'Media a 50 giorni sopra quelle a 150 e 200',
  'Prezzo sopra la media a 50 giorni',
  'Almeno 30% sopra il minimo dell’ultimo anno',
  'Al massimo 25% sotto il massimo dell’ultimo anno',
  'Forza relativa almeno 70',
] as const
```

Dopo la definizione di `export type VcpStatus = ...` aggiungere:

```ts
export const VCP_STATUS_LABEL: Record<VcpStatus, string> = {
  forming: 'Base pronta',
  breakout: 'In rottura',
  extended: 'Troppo tardi',
  failed: 'Base rotta',
}
```

In `weightedReturn` sostituire `if (n < QUARTER * 4 + 1) return null` con `if (n < RS_MIN_BARS) return null`.

In `evaluateTrendTemplate` sostituire ogni `label: '...'` con il riferimento alla costante (stesso testo, quindi nessun cambio di comportamento): `label: TREND_TEMPLATE_LABELS[0]` … `label: TREND_TEMPLATE_LABELS[7]` nell'ordine degli `id` 1–8, e `ok: rsPercentile !== null && rsPercentile >= 70` con `ok: rsPercentile !== null && rsPercentile >= RS_MIN`.

In `components/MinerviniPanel.tsx` aggiungere `VCP_STATUS_LABEL` all'import da `@/lib/minervini` e sostituire la riga 171 con:

```tsx
  const chip = !hasBase ? 'Nessuna base' : VCP_STATUS_LABEL[vcp.status!]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/minervini.test.ts tests/lib/minervini-data.test.ts tests/components/MinerviniPanel.test.tsx`
Expected: PASS (nessuna regressione nel pannello).

- [ ] **Step 5: Commit**

```bash
git add lib/minervini.ts components/MinerviniPanel.tsx tests/lib/minervini.test.ts
git commit -m "refactor: share Minervini thresholds and labels"
```

---

### Task 2: Universo S&P 500

**Files:**
- Create: `data/update-sp500.mjs`
- Create: `data/sp500.json` (generato)
- Create: `lib/universe.ts`
- Test: `tests/lib/universe.test.ts`

**Interfaces:**
- Produces (da `lib/universe.ts`):
  - `export interface UniverseEntry { symbol: string; name: string; sector: string | null }`
  - `export function toYahooSymbol(symbol: string): string` (`BRK.B` → `BRK-B`)
  - `export function loadUniverse(): UniverseEntry[]`

- [ ] **Step 1: Write the failing test** — crea `tests/lib/universe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadUniverse, toYahooSymbol } from '@/lib/universe'

describe('toYahooSymbol', () => {
  it('turns class-share dots into dashes', () => {
    expect(toYahooSymbol('BRK.B')).toBe('BRK-B')
    expect(toYahooSymbol('BF.B')).toBe('BF-B')
    expect(toYahooSymbol('AAPL')).toBe('AAPL')
  })
})

describe('loadUniverse', () => {
  const universe = loadUniverse()

  it('lists about five hundred companies', () => {
    expect(universe.length).toBeGreaterThan(450)
    expect(universe.length).toBeLessThan(520)
  })

  it('has unique, non-empty symbols and keeps the original dotted form', () => {
    const symbols = universe.map((e) => e.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
    expect(symbols.every((s) => /^[A-Z.]+$/.test(s))).toBe(true)
    expect(symbols).toContain('BRK.B')
  })

  it('gives every entry a name', () => {
    expect(universe.every((e) => e.name.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/universe.test.ts`
Expected: FAIL (modulo `@/lib/universe` non esiste).

- [ ] **Step 3: Write minimal implementation**

`data/update-sp500.mjs` (Node, nessuna dipendenza; il CSV ha intestazione `Symbol,Security,GICS Sector,...` e campi tra virgolette):

```js
// Rigenera data/sp500.json dai componenti dell'S&P 500.
// Uso: node data/update-sp500.mjs [url-csv]
import { writeFile } from 'node:fs/promises'

const DEFAULT_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
const url = process.argv[2] ?? DEFAULT_URL

function parseLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const res = await fetch(url)
if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
const [header, ...lines] = (await res.text()).split(/\r?\n/).filter(Boolean)
const cols = parseLine(header)
const iSymbol = cols.indexOf('Symbol')
const iName = cols.indexOf('Security')
const iSector = cols.indexOf('GICS Sector')
if ([iSymbol, iName, iSector].includes(-1)) throw new Error(`Unexpected header: ${header}`)

const entries = lines
  .map(parseLine)
  .map((c) => ({ symbol: c[iSymbol].trim().toUpperCase(), name: c[iName].trim(), sector: c[iSector].trim() || null }))
  .filter((e) => e.symbol && e.name)
  .sort((a, b) => a.symbol.localeCompare(b.symbol))

await writeFile(new URL('./sp500.json', import.meta.url), JSON.stringify(entries, null, 2) + '\n')
console.log(`Wrote ${entries.length} companies`)
```

Poi eseguire `node data/update-sp500.mjs` (atteso: `Wrote 50x companies`, circa 503). Se l'URL non è raggiungibile, passare un altro CSV con le stesse colonne come argomento.

`lib/universe.ts`:

```ts
import universe from '@/data/sp500.json'

export interface UniverseEntry {
  symbol: string
  name: string
  sector: string | null
}

// Yahoo writes class shares with a dash: BRK.B is BRK-B there.
export function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-')
}

export function loadUniverse(): UniverseEntry[] {
  return universe as UniverseEntry[]
}
```

Se `tsc` si lamenta dell'import JSON, verificare `resolveJsonModule` in `tsconfig.json` (di norma già attivo con Next).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/universe.test.ts && npx tsc --noEmit`
Expected: PASS, nessun errore di tipi.

- [ ] **Step 5: Commit**

```bash
git add data/update-sp500.mjs data/sp500.json lib/universe.ts tests/lib/universe.test.ts
git commit -m "feat: add S&P 500 universe for the scanner"
```

---

### Task 3: Logica pura dello scanner (`lib/scanner.ts`)

**Files:**
- Create: `lib/scanner.ts`
- Test: `tests/lib/scanner.test.ts`

**Interfaces:**
- Consumes (Task 1): `RS_MIN`, `RS_MIN_BARS`, `TREND_TEMPLATE_LABELS`, `VcpStatus`; da `lib/minervini.ts` già esistenti: `weightedReturn`, `percentileRank`, `evaluateTrendTemplate`, `detectVcp`, `Criterion`; da `lib/history.ts`: `Bar`.
- Produces:
  - `export const MIN_PEERS = 5`
  - `export interface ScanSymbolResult { price: number; barDate: Date; weightedReturn: number; criteria: Criterion[]; vcpStatus: VcpStatus | null; pivot: number | null; pivotDistancePct: number | null; contractions: number[]; volumeDryUp: boolean }`
  - `export function scanSymbol(bars: Bar[]): ScanSymbolResult | null`
  - `export interface FinalizeInput { symbol: string; weightedReturn: number; criteria: Criterion[] }`
  - `export interface FinalizeOutput { symbol: string; rs: number | null; passedCount: number }`
  - `export function finalize(rows: FinalizeInput[]): FinalizeOutput[]`
  - `export function missingCriterion(criteria: Criterion[], rs: number | null): string | null`

- [ ] **Step 1: Write the failing test** — crea `tests/lib/scanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { RS_MIN_BARS, TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import { finalize, missingCriterion, scanSymbol, type FinalizeInput } from '@/lib/scanner'

const DAY = 86_400_000
const bar = (i: number, close: number): Bar => ({ t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 })
const series = (n: number, f: (i: number) => number): Bar[] => Array.from({ length: n }, (_, i) => bar(i, f(i)))

describe('scanSymbol', () => {
  it('returns null below the minimum history', () => {
    expect(scanSymbol(series(RS_MIN_BARS - 1, (i) => 100 + i))).toBeNull()
    expect(scanSymbol([])).toBeNull()
  })

  it('evaluates a steady uptrend: seven criteria, all passed', () => {
    const bars = series(300, (i) => 100 + i * 0.5)
    const r = scanSymbol(bars)!
    expect(r.criteria).toHaveLength(7)
    expect(r.criteria.every((c) => c.ok)).toBe(true)
    expect(r.price).toBeCloseTo(bars[299].close, 6)
    expect(r.barDate).toEqual(new Date(bars[299].t))
    expect(r.weightedReturn).toBeGreaterThan(0)
  })

  it('fails the trend criteria on a downtrend', () => {
    const r = scanSymbol(series(300, (i) => 300 - i * 0.5))!
    expect(r.criteria.some((c) => !c.ok)).toBe(true)
    expect(r.weightedReturn).toBeLessThan(0)
  })

  it('reports the distance from the pivot when a base exists', () => {
    const r = scanSymbol(series(300, (i) => 100 + i * 0.5))!
    if (r.pivot !== null) expect(r.pivotDistancePct).toBeCloseTo((r.price / r.pivot - 1) * 100, 6)
    else expect(r.pivotDistancePct).toBeNull()
  })
})

const row = (symbol: string, weightedReturn: number, okCount = 7): FinalizeInput => ({
  symbol,
  weightedReturn,
  criteria: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: TREND_TEMPLATE_LABELS[i], ok: i < okCount, value: '', margin: null })),
})

describe('finalize', () => {
  it('ranks each row against all the other rows, so the best reaches 100', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`S${i}`, i / 10))
    const out = new Map(finalize(rows).map((o) => [o.symbol, o]))
    expect(out.get('S9')!.rs).toBeCloseTo(100, 6)
    expect(out.get('S0')!.rs).toBeCloseTo(0, 6)
  })

  it('adds the RS criterion only at 70 or more', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`S${i}`, i / 10))
    const out = new Map(finalize(rows).map((o) => [o.symbol, o]))
    // S9 is above everyone: 7 trend criteria + RS = 8. S0 is below everyone: 7 + nothing = 7.
    expect(out.get('S9')!.passedCount).toBe(8)
    expect(out.get('S0')!.passedCount).toBe(7)
  })

  it('counts only the criteria that passed', () => {
    const rows = [row('A', 1, 4), ...Array.from({ length: 9 }, (_, i) => row(`S${i}`, i / 10))]
    expect(finalize(rows).find((o) => o.symbol === 'A')!.passedCount).toBe(5)
  })

  it('leaves rs null and never divides by zero with too few rows', () => {
    expect(finalize([])).toEqual([])
    const one = finalize([row('A', 0.5)])
    expect(one).toEqual([{ symbol: 'A', rs: null, passedCount: 7 }])
    const four = finalize(Array.from({ length: 4 }, (_, i) => row(`S${i}`, i)))
    expect(four.every((o) => o.rs === null)).toBe(true)
  })
})

describe('missingCriterion', () => {
  it('names the failed trend criterion', () => {
    const criteria = row('A', 0, 7).criteria.map((c) => (c.id === 5 ? { ...c, ok: false } : c))
    expect(missingCriterion(criteria, 90)).toBe(TREND_TEMPLATE_LABELS[4])
  })

  it('names the RS criterion when only RS is missing', () => {
    expect(missingCriterion(row('A', 0, 7).criteria, 55)).toBe(TREND_TEMPLATE_LABELS[7])
  })

  it('returns null when nothing is missing', () => {
    expect(missingCriterion(row('A', 0, 7).criteria, 90)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scanner.test.ts`
Expected: FAIL (modulo `@/lib/scanner` non esiste).

- [ ] **Step 3: Write minimal implementation** — crea `lib/scanner.ts`:

```ts
import type { Bar } from '@/lib/history'
import {
  RS_MIN,
  RS_MIN_BARS,
  TREND_TEMPLATE_LABELS,
  detectVcp,
  evaluateTrendTemplate,
  percentileRank,
  weightedReturn,
  type Criterion,
  type VcpStatus,
} from '@/lib/minervini'

// Same floor as the single-stock analysis: below five peers a percentile means nothing.
export const MIN_PEERS = 5

export interface ScanSymbolResult {
  price: number
  barDate: Date
  weightedReturn: number
  criteria: Criterion[]
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  contractions: number[]
  volumeDryUp: boolean
}

// Everything that does not depend on the other stocks. Null when the history is too short to rank.
export function scanSymbol(bars: Bar[]): ScanSymbolResult | null {
  if (bars.length < RS_MIN_BARS) return null
  const closes = bars.map((b) => b.close)
  const ret = weightedReturn(closes)
  const template = evaluateTrendTemplate(bars, null)
  if (ret === null || !template) return null
  const vcp = detectVcp(bars)
  const last = bars[bars.length - 1]
  return {
    price: last.close,
    barDate: new Date(last.t),
    weightedReturn: ret,
    criteria: template.criteria.slice(0, 7),
    vcpStatus: vcp.status,
    pivot: vcp.pivot,
    pivotDistancePct: vcp.pivot === null ? null : (last.close / vcp.pivot - 1) * 100,
    contractions: vcp.contractions,
    volumeDryUp: vcp.volumeDryUp,
  }
}

export interface FinalizeInput {
  symbol: string
  weightedReturn: number
  criteria: Criterion[]
}

export interface FinalizeOutput {
  symbol: string
  rs: number | null
  passedCount: number
}

// Second pass: rank every stock against all the others, add the eighth criterion and count the passed ones out of eight.
export function finalize(rows: FinalizeInput[]): FinalizeOutput[] {
  return rows.map((row, i) => {
    const peers = rows.filter((_, j) => j !== i).map((r) => r.weightedReturn)
    const rs = peers.length >= MIN_PEERS ? percentileRank(row.weightedReturn, peers) : null
    const trend = row.criteria.filter((c) => c.ok).length
    return { symbol: row.symbol, rs, passedCount: trend + (rs !== null && rs >= RS_MIN ? 1 : 0) }
  })
}

// The label of the first criterion a 7-of-8 stock fails; the stored criteria hold only the first seven.
export function missingCriterion(criteria: Criterion[], rs: number | null): string | null {
  const failed = criteria.find((c) => !c.ok)
  if (failed) return failed.label
  return rs === null || rs < RS_MIN ? TREND_TEMPLATE_LABELS[7] : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/scanner.test.ts`
Expected: PASS. Se il test "uptrend" fallisce su un criterio (es. 30% sopra il minimo), alzare la pendenza della serie sintetica: il comportamento da verificare è che `scanSymbol` restituisca i 7 criteri così come li calcola `evaluateTrendTemplate`.

- [ ] **Step 5: Commit**

```bash
git add lib/scanner.ts tests/lib/scanner.test.ts
git commit -m "feat: add scanner symbol evaluation and relative strength pass"
```

---

### Task 4: Schema Prisma e migrazione

**Files:**
- Modify: `prisma/schema.prisma` (aggiungere in fondo)
- Create: `prisma/migrations/<timestamp>_add_scan_run/migration.sql` (generata)
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces: modelli Prisma `ScanRun` e `ScanResult` come da spec; `resetDb()` svuota anche le due tabelle.

- [ ] **Step 1: Aggiungere i modelli** in fondo a `prisma/schema.prisma`:

```prisma
model ScanRun {
  id          String       @id @default(cuid())
  status      String // 'running' | 'done'
  total       Int
  cursor      Int          @default(0)
  unreadCount Int          @default(0)
  startedAt   DateTime     @default(now())
  finishedAt  DateTime?
  results     ScanResult[]

  @@index([status, finishedAt])
}

model ScanResult {
  id               String   @id @default(cuid())
  runId            String
  run              ScanRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  symbol           String
  name             String
  sector           String?
  status           String // 'ok' | 'unread'
  price            Float?
  barDate          DateTime?
  weightedReturn   Float?
  criteria         Json?
  rs               Float?
  passedCount      Int?
  vcpStatus        String?
  pivot            Float?
  pivotDistancePct Float?
  contractions     Json?
  volumeDryUp      Boolean?

  @@unique([runId, symbol])
  @@index([runId, passedCount])
}
```

- [ ] **Step 2: Migrazione sul DB di sviluppo**

Run: `npx prisma migrate dev --name add_scan_run`
Expected: crea `prisma/migrations/<timestamp>_add_scan_run/migration.sql` con `CREATE TABLE "ScanRun"` e `"ScanResult"`, rigenera il client.

- [ ] **Step 3: Migrazione sul DB di test**

Run: `docker compose -f docker-compose.test.yml up -d && DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy`
Expected: applica `add_scan_run` senza errori.

- [ ] **Step 4: Aggiornare `resetDb()`** — in `tests/helpers/db.ts`, prima di `prisma.discoveredCandidate.deleteMany()` aggiungere:

```ts
  await prisma.scanResult.deleteMany()
  await prisma.scanRun.deleteMany()
```

- [ ] **Step 5: Verificare e committare**

Run: `npx tsc --noEmit && npx vitest run tests/helpers/db.test.ts`
Expected: PASS.

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts
git commit -m "feat: add scan run and scan result tables"
```

---

### Task 5: Esecuzione della scansione (`lib/scanner-run.ts`)

**Files:**
- Create: `lib/scanner-run.ts`
- Test: `tests/lib/scanner-run.test.ts`

**Interfaces:**
- Consumes: Task 2 (`UniverseEntry`, `loadUniverse`, `toYahooSymbol`), Task 3 (`scanSymbol`, `finalize`, `FinalizeInput`), `getDailyBars` e `Bar` da `@/lib/history`, `prisma` da `@/lib/db`.
- Produces:
  - `export const BLOCK_SIZE = 25`, `export const CONCURRENCY = 5`, `export const RETRY_DEADLINE_MS = 30_000`, `export const MIN_INTERVAL_MS = 60 * 60 * 1000`, `export const KEEP_RUNS = 2`
  - `export const PARTIAL_UNREAD_SHARE = 0.1`
  - `export interface RunState { id: string; status: string; total: number; cursor: number }`
  - `export type StartResult = { kind: 'started' | 'resumed'; run: RunState } | { kind: 'too-soon'; retryAt: Date }`
  - `export async function startRun(universe?: UniverseEntry[], now?: Date): Promise<StartResult>`
  - `export type StepResult = { kind: 'advanced' | 'stale' | 'done'; run: RunState } | { kind: 'not-found' }`
  - `export async function stepRun(runId: string, deps?: { universe?: UniverseEntry[]; fetchBars?: (yahooSymbol: string) => Promise<Bar[]>; now?: () => number }): Promise<StepResult>`
  - `export async function latestCompleteRun()` e `export async function runningRun()` per la pagina

- [ ] **Step 1: Write the failing test** — crea `tests/lib/scanner-run.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import { BLOCK_SIZE, MIN_INTERVAL_MS, latestCompleteRun, startRun, stepRun } from '@/lib/scanner-run'
import type { UniverseEntry } from '@/lib/universe'
import { resetDb } from '../helpers/db'

const DAY = 86_400_000
const uptrend = (slope: number): Bar[] =>
  Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * slope
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })

const entries = (n: number): UniverseEntry[] => Array.from({ length: n }, (_, i) => ({ symbol: `S${i}`, name: `Stock ${i}`, sector: 'Tech' }))

describe('scanner run', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('starts a run sized on the universe, then resumes it instead of starting another', async () => {
    const first = await startRun(entries(7))
    expect(first.kind).toBe('started')
    const again = await startRun(entries(7))
    expect(again.kind).toBe('resumed')
    if (first.kind !== 'too-soon' && again.kind !== 'too-soon') expect(again.run.id).toBe(first.run.id)
    expect(await prisma.scanRun.count()).toBe(1)
  })

  it('refuses a new run within an hour of the last complete one and gives the retry time', async () => {
    const finishedAt = new Date('2026-11-16T10:00:00Z')
    await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt } })
    const r = await startRun(entries(5), new Date('2026-11-16T10:30:00Z'))
    expect(r.kind).toBe('too-soon')
    if (r.kind === 'too-soon') expect(r.retryAt).toEqual(new Date(finishedAt.getTime() + MIN_INTERVAL_MS))
    const later = await startRun(entries(5), new Date('2026-11-16T11:00:01Z'))
    expect(later.kind).toBe('started')
  })

  it('processes a block, stores one row per stock and advances the cursor only after saving', async () => {
    const universe = entries(BLOCK_SIZE + 3)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = vi.fn(async () => uptrend(0.5))

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step).toMatchObject({ kind: 'advanced', run: { cursor: BLOCK_SIZE, status: 'running' } })
    expect(await prisma.scanResult.count({ where: { runId: started.run.id } })).toBe(BLOCK_SIZE)
    expect(fetchBars).toHaveBeenCalledTimes(BLOCK_SIZE)
  })

  it('marks short or missing history as unread and keeps going', async () => {
    const universe = entries(6)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (symbol: string) => (symbol === 'S0' ? [] : symbol === 'S1' ? uptrend(0.5).slice(0, 100) : uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    const rows = await prisma.scanResult.findMany({ where: { runId: started.run.id }, orderBy: { symbol: 'asc' } })
    expect(rows.filter((r) => r.status === 'unread').map((r) => r.symbol)).toEqual(['S0', 'S1'])
    expect(rows.find((r) => r.symbol === 'S0')!.criteria).toBeNull()
    expect(rows.filter((r) => r.status === 'ok')).toHaveLength(4)
  })

  it('asks Yahoo for dashed symbols but stores the dotted ones', async () => {
    const universe: UniverseEntry[] = [{ symbol: 'BRK.B', name: 'Berkshire', sector: 'Financials' }, { symbol: 'BF.B', name: 'Brown-Forman', sector: null }]
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = vi.fn(async () => uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    expect(fetchBars.mock.calls.map((c) => c[0]).sort()).toEqual(['BF-B', 'BRK-B'])
    const symbols = (await prisma.scanResult.findMany({ where: { runId: started.run.id } })).map((r) => r.symbol).sort()
    expect(symbols).toEqual(['BF.B', 'BRK.B'])
  })

  it('retries a failed fetch once', async () => {
    const universe = entries(1)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    let calls = 0
    const fetchBars = async () => (++calls === 1 ? [] : uptrend(0.5))

    await stepRun(started.run.id, { universe, fetchBars })

    expect(calls).toBe(2)
    expect((await prisma.scanResult.findFirst({ where: { runId: started.run.id } }))!.status).toBe('ok')
  })

  it('skips the retry pass when the block already took too long', async () => {
    const universe = entries(1)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const times = [0, 31_000]
    const now = () => times.shift() ?? 31_000
    let calls = 0
    const fetchBars = async () => (++calls, [] as Bar[])

    await stepRun(started.run.id, { universe, fetchBars, now })

    expect(calls).toBe(1)
    expect((await prisma.scanResult.findFirst({ where: { runId: started.run.id } }))!.status).toBe('unread')
  })

  it('closes the run: ranks the stocks, counts unread ones and keeps only the last two complete runs', async () => {
    for (const hoursAgo of [30, 20, 10]) {
      await prisma.scanRun.create({ data: { status: 'done', total: 1, cursor: 1, finishedAt: new Date(Date.now() - hoursAgo * 3_600_000) } })
    }
    const universe = entries(8)
    const started = await startRun(universe, new Date())
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (symbol: string) => (symbol === 'S7' ? [] : uptrend(0.1 + Number(symbol.slice(1)) * 0.1))

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step.kind).toBe('advanced')
    if (step.kind === 'advanced') expect(step.run.status).toBe('done')
    const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })
    expect(run.status).toBe('done')
    expect(run.unreadCount).toBe(1)
    expect(run.finishedAt).not.toBeNull()
    const best = await prisma.scanResult.findFirstOrThrow({ where: { runId: run.id, symbol: 'S6' } })
    expect(best.rs).toBeCloseTo(100, 6)
    expect(best.passedCount).not.toBeNull()
    const unread = await prisma.scanResult.findFirstOrThrow({ where: { runId: run.id, symbol: 'S7' } })
    expect(unread.rs).toBeNull()
    expect(unread.passedCount).toBeNull()
    expect(await prisma.scanRun.count({ where: { status: 'done' } })).toBe(2)
    expect((await latestCompleteRun())!.id).toBe(run.id)
  })

  it('closes cleanly when nothing could be read', async () => {
    const universe = entries(3)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    const step = await stepRun(started.run.id, { universe, fetchBars: async () => [] })

    expect(step).toMatchObject({ kind: 'advanced', run: { status: 'done' } })
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })).unreadCount).toBe(3)
  })

  it('lets only one of two concurrent steps on the same block advance', async () => {
    const universe = entries(BLOCK_SIZE + 5)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async () => uptrend(0.5)

    const [a, b] = await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect([a.kind, b.kind].sort()).toEqual(['advanced', 'stale'])
    const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: started.run.id } })
    expect(run.cursor).toBe(BLOCK_SIZE)
    expect(await prisma.scanResult.count({ where: { runId: run.id } })).toBe(BLOCK_SIZE)
  })

  it('finishes the run exactly once when two steps race on the last block', async () => {
    const universe = entries(4)
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')
    const fetchBars = async (s: string) => uptrend(0.1 + Number(s.slice(1)) * 0.1)

    await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect(await prisma.scanRun.count({ where: { status: 'done' } })).toBe(1)
    expect(await prisma.scanResult.count({ where: { runId: started.run.id } })).toBe(4)
  })

  it('reports an unknown run and a finished run without writing anything', async () => {
    expect(await stepRun('nope', { universe: entries(1), fetchBars: async () => [] })).toEqual({ kind: 'not-found' })
    const done = await prisma.scanRun.create({ data: { status: 'done', total: 1, cursor: 1, finishedAt: new Date() } })
    const r = await stepRun(done.id, { universe: entries(1), fetchBars: async () => uptrend(0.5) })
    expect(r.kind).toBe('done')
    expect(await prisma.scanResult.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scanner-run.test.ts`
Expected: FAIL (modulo `@/lib/scanner-run` non esiste).

- [ ] **Step 3: Write minimal implementation** — crea `lib/scanner-run.ts`:

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getDailyBars, type Bar } from '@/lib/history'
import { finalize, scanSymbol, type FinalizeInput, type ScanSymbolResult } from '@/lib/scanner'
import { loadUniverse, toYahooSymbol, type UniverseEntry } from '@/lib/universe'
import type { Criterion } from '@/lib/minervini'

export const BLOCK_SIZE = 25
export const CONCURRENCY = 5
// Block budget: 25 stocks at 5 in parallel with a 10 s timeout each is at most ~50 s without retries,
// so the retry pass only starts early in the block to stay under the route's 60 s.
export const RETRY_DEADLINE_MS = 30_000
export const MIN_INTERVAL_MS = 60 * 60 * 1000
export const KEEP_RUNS = 2
export const PARTIAL_UNREAD_SHARE = 0.1

export interface RunState {
  id: string
  status: string
  total: number
  cursor: number
}

export type StartResult = { kind: 'started' | 'resumed'; run: RunState } | { kind: 'too-soon'; retryAt: Date }
export type StepResult = { kind: 'advanced' | 'stale' | 'done'; run: RunState } | { kind: 'not-found' }

const state = (r: { id: string; status: string; total: number; cursor: number }): RunState => ({ id: r.id, status: r.status, total: r.total, cursor: r.cursor })

export function runningRun() {
  return prisma.scanRun.findFirst({ where: { status: 'running' }, orderBy: { startedAt: 'desc' } })
}

export function latestCompleteRun() {
  return prisma.scanRun.findFirst({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' } })
}

export async function startRun(universe: UniverseEntry[] = loadUniverse(), now: Date = new Date()): Promise<StartResult> {
  const running = await runningRun()
  if (running) return { kind: 'resumed', run: state(running) }
  const last = await latestCompleteRun()
  if (last?.finishedAt && now.getTime() - last.finishedAt.getTime() < MIN_INTERVAL_MS) {
    return { kind: 'too-soon', retryAt: new Date(last.finishedAt.getTime() + MIN_INTERVAL_MS) }
  }
  const run = await prisma.scanRun.create({ data: { status: 'running', total: universe.length } })
  return { kind: 'started', run: state(run) }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export interface StepDeps {
  universe?: UniverseEntry[]
  fetchBars?: (yahooSymbol: string) => Promise<Bar[]>
  now?: () => number
}

export async function stepRun(runId: string, deps: StepDeps = {}): Promise<StepResult> {
  const universe = deps.universe ?? loadUniverse()
  const fetchBars = deps.fetchBars ?? getDailyBars
  const now = deps.now ?? Date.now

  const run = await prisma.scanRun.findUnique({ where: { id: runId } })
  if (!run) return { kind: 'not-found' }
  if (run.status === 'done') return { kind: 'done', run: state(run) }

  const from = run.cursor
  const block = universe.slice(from, from + BLOCK_SIZE)
  const to = from + block.length
  const startedAt = now()

  const results = await mapLimit(block, CONCURRENCY, async (entry) => scanSymbol(await fetchBars(toYahooSymbol(entry.symbol))))
  if (now() - startedAt < RETRY_DEADLINE_MS) {
    const failed = block.map((entry, i) => [entry, i] as const).filter(([, i]) => results[i] === null)
    const retried = await mapLimit(failed, CONCURRENCY, async ([entry]) => scanSymbol(await fetchBars(toYahooSymbol(entry.symbol))))
    failed.forEach(([, i], k) => {
      results[i] = retried[k]
    })
  }

  // Rows first (idempotent through skipDuplicates), cursor second: a crash never skips a block,
  // and a second tab running the same block only re-writes rows that already exist.
  if (block.length > 0) {
    await prisma.scanResult.createMany({ data: block.map((entry, i) => toRow(runId, entry, results[i])), skipDuplicates: true })
  }
  const claimed = await prisma.scanRun.updateMany({ where: { id: runId, cursor: from, status: 'running' }, data: { cursor: to } })
  if (claimed.count !== 1) {
    const current = await prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
    return { kind: 'stale', run: state(current) }
  }
  if (to >= run.total) await closeRun(runId)
  const current = await prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
  return { kind: 'advanced', run: state(current) }
}

// Json columns reject a plain null: leave the key out for unread rows.
function toRow(runId: string, entry: UniverseEntry, r: ScanSymbolResult | null): Prisma.ScanResultCreateManyInput {
  const base = { runId, symbol: entry.symbol, name: entry.name, sector: entry.sector }
  if (!r) return { ...base, status: 'unread' }
  return {
    ...base,
    status: 'ok',
    price: r.price,
    barDate: r.barDate,
    weightedReturn: r.weightedReturn,
    criteria: r.criteria as unknown as Prisma.InputJsonValue,
    vcpStatus: r.vcpStatus,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    contractions: r.contractions,
    volumeDryUp: r.volumeDryUp,
  }
}

async function closeRun(runId: string): Promise<void> {
  const rows = await prisma.scanResult.findMany({ where: { runId } })
  const readable = rows.filter((r) => r.status === 'ok' && r.weightedReturn !== null && r.criteria !== null)
  const inputs: FinalizeInput[] = readable.map((r) => ({ symbol: r.symbol, weightedReturn: r.weightedReturn!, criteria: r.criteria as unknown as Criterion[] }))
  const out = new Map(finalize(inputs).map((o) => [o.symbol, o]))
  await prisma.$transaction(
    readable.map((r) => prisma.scanResult.update({ where: { id: r.id }, data: { rs: out.get(r.symbol)!.rs, passedCount: out.get(r.symbol)!.passedCount } })),
  )

  const closed = await prisma.scanRun.updateMany({
    where: { id: runId, status: 'running' },
    data: { status: 'done', finishedAt: new Date(), unreadCount: rows.length - readable.length },
  })
  if (closed.count !== 1) return
  const done = await prisma.scanRun.findMany({ where: { status: 'done' }, orderBy: { finishedAt: 'desc' }, select: { id: true } })
  const old = done.slice(KEEP_RUNS).map((r) => r.id)
  if (old.length > 0) await prisma.scanRun.deleteMany({ where: { id: { in: old } } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/scanner-run.test.ts && npx tsc --noEmit`
Expected: PASS. Note per chi esegue: nel test "retry" `fetchBars` viene chiamata di nuovo solo per i titoli rimasti `null`; nel test "skips the retry" `now()` restituisce `0` all'inizio e `31_000` dopo, quindi il secondo tentativo salta. Se `tsc` segnala che `Prisma.ScanResultCreateManyInput` non esiste, rigenerare il client con `npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add lib/scanner-run.ts tests/lib/scanner-run.test.ts
git commit -m "feat: run the Minervini scan in resumable blocks"
```

---

### Task 6: Route API

**Files:**
- Create: `app/api/scanner/route.ts`
- Create: `app/api/scanner/step/route.ts`
- Test: `tests/api/scanner.test.ts`

**Interfaces:**
- Consumes (Task 5): `startRun`, `stepRun`, tipo `RunState`.
- Produces:
  - `POST /api/scanner` → 200 `{ runId, cursor, total, status, resumed: boolean }`, oppure 429 `{ error, retryAt }`.
  - `POST /api/scanner/step` con body `{ runId: string }` → 200 `{ cursor, total, status, advanced: boolean }`; 400 se `runId` manca o il JSON non è valido; 404 se la scansione non esiste; 409 se è già chiusa.

- [ ] **Step 1: Leggere la guida delle route** — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (firma di `POST`, `maxDuration`); confermare che il pattern di `app/api/discover/route.ts` è ancora valido.

- [ ] **Step 2: Write the failing test** — crea `tests/api/scanner.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { POST as start } from '@/app/api/scanner/route'
import { POST as step } from '@/app/api/scanner/step/route'

vi.mock('@/lib/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/history')>()
  const DAY = 86_400_000
  const bars = Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * 0.5
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })
  return { ...actual, getDailyBars: vi.fn(async () => bars) }
})

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('scanner API', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('POST /api/scanner starts a run sized on the universe', async () => {
    const res = await start()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ cursor: 0, status: 'running', resumed: false })
    expect(body.total).toBeGreaterThan(450)
    expect(await prisma.scanRun.count()).toBe(1)
  })

  it('POST /api/scanner resumes a running scan', async () => {
    const first = await (await start()).json()
    const again = await (await start()).json()
    expect(again.runId).toBe(first.runId)
    expect(again.resumed).toBe(true)
  })

  it('POST /api/scanner answers 429 with the retry time within an hour of a complete scan', async () => {
    const finishedAt = new Date()
    await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt } })
    const res = await start()
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(new Date(body.retryAt).getTime()).toBe(finishedAt.getTime() + 60 * 60 * 1000)
    expect(await prisma.scanRun.count({ where: { status: 'running' } })).toBe(0)
  })

  it('POST /api/scanner/step processes the next block and reports the cursor', async () => {
    const { runId } = await (await start()).json()
    const res = await step(post('/api/scanner/step', { runId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cursor: 25, status: 'running', advanced: true })
    expect(await prisma.scanResult.count({ where: { runId } })).toBe(25)
  })

  it('POST /api/scanner/step rejects a missing runId and invalid JSON with 400', async () => {
    expect((await step(post('/api/scanner/step', {}))).status).toBe(400)
    expect((await step(new Request('http://localhost/api/scanner/step', { method: 'POST', body: '{not json' }))).status).toBe(400)
    expect(await prisma.scanResult.count()).toBe(0)
  })

  it('POST /api/scanner/step answers 404 for an unknown run', async () => {
    expect((await step(post('/api/scanner/step', { runId: 'nope' }))).status).toBe(404)
    expect(await prisma.scanResult.count()).toBe(0)
  })

  it('POST /api/scanner/step answers 409 for a finished run and writes nothing', async () => {
    const run = await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt: new Date() } })
    expect((await step(post('/api/scanner/step', { runId: run.id }))).status).toBe(409)
    expect(await prisma.scanResult.count()).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api/scanner.test.ts`
Expected: FAIL (route non esistono).

- [ ] **Step 4: Write minimal implementation**

`app/api/scanner/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { startRun } from '@/lib/scanner-run'

export async function POST() {
  try {
    const result = await startRun()
    if (result.kind === 'too-soon') {
      return NextResponse.json({ error: 'Ultima scansione troppo recente', retryAt: result.retryAt.toISOString() }, { status: 429 })
    }
    const { run } = result
    return NextResponse.json({ runId: run.id, cursor: run.cursor, total: run.total, status: run.status, resumed: result.kind === 'resumed' })
  } catch (err) {
    console.error('Scanner start failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Scanner start failed' }, { status: 500 })
  }
}
```

`app/api/scanner/step/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { stepRun } from '@/lib/scanner-run'

export const maxDuration = 60

export async function POST(request: Request) {
  let runId: unknown
  try {
    runId = ((await request.json()) as { runId?: unknown }).runId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof runId !== 'string' || runId.length === 0) return NextResponse.json({ error: 'runId required' }, { status: 400 })

  try {
    const result = await stepRun(runId)
    if (result.kind === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (result.kind === 'done') return NextResponse.json({ error: 'Scan already finished' }, { status: 409 })
    const { run } = result
    return NextResponse.json({ cursor: run.cursor, total: run.total, status: run.status, advanced: result.kind === 'advanced' })
  } catch (err) {
    console.error('Scanner step failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Scanner step failed' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/api/scanner.test.ts tests/lib/scanner-run.test.ts`
Expected: PASS.

```bash
git add app/api/scanner tests/api/scanner.test.ts
git commit -m "feat: add scanner start and step API routes"
```

---

### Task 7: Pagina `/scanner`

**Files:**
- Create: `components/ScannerButton.tsx`, `components/ScannerButton.module.css`
- Create: `components/ScannerInfo.tsx`, `components/ScannerInfo.module.css`
- Create: `components/ScannerTable.tsx`, `components/ScannerTable.module.css`
- Create: `app/scanner/page.tsx`, `app/scanner/page.module.css`
- Modify: `components/SiteNav.tsx` (voce di menu)
- Test: `tests/components/ScannerButton.test.tsx`, `tests/components/ScannerInfo.test.tsx`, `tests/components/ScannerTable.test.tsx`

**Interfaces:**
- Consumes: `TREND_TEMPLATE_LABELS`, `VCP_STATUS_LABEL`, `RS_MIN` (Task 1); `missingCriterion` (Task 3); `latestCompleteRun`, `runningRun`, `PARTIAL_UNREAD_SHARE` (Task 5); route del Task 6.
- Produces:
  - `export function ScannerButton({ resumable }: { resumable: boolean })` (client)
  - `export function ScannerInfo()` (server, statico)
  - `export interface ScannerRow { symbol: string; name: string; sector: string | null; price: number; rs: number | null; passedCount: number; vcpStatus: VcpStatus | null; pivot: number | null; pivotDistancePct: number | null; missing: string | null }`
  - `export function ScannerTable({ rows }: { rows: ScannerRow[] })` (client; filtro VCP)

- [ ] **Step 1: Write the failing tests**

`tests/components/ScannerButton.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScannerButton } from '@/components/ScannerButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

describe('ScannerButton', () => {
  beforeEach(() => {
    refresh.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('starts the scan, steps until it is done, shows progress and refreshes the page', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
      .mockResolvedValueOnce(ok({ cursor: 25, total: 50, status: 'running', advanced: true }))
      .mockResolvedValueOnce(ok({ cursor: 50, total: 50, status: 'done', advanced: true }))

    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))

    expect(screen.getByRole('button')).toBeDisabled()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/scanner', expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/scanner/step', expect.objectContaining({ method: 'POST', body: JSON.stringify({ runId: 'r1' }) }))
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('offers to resume an interrupted scan', () => {
    render(<ScannerButton resumable />)
    expect(screen.getByRole('button', { name: /riprendi scansione/i })).toBeInTheDocument()
  })

  it('tells when a scan is too recent and when it can be started again', async () => {
    ;(fetch as any).mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: 'Ultima scansione troppo recente', retryAt: '2026-11-16T11:30:00.000Z' }) })
    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/troppo recente/i)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('shows the error and lets the user resume when a step fails', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 0, total: 50, status: 'running', resumed: false }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Scanner step failed' }) })
    render(<ScannerButton resumable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /avvia scansione/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Scanner step failed')
    expect(screen.getByRole('button', { name: /riprendi scansione/i })).not.toBeDisabled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('treats a 409 from another tab as finished', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(ok({ runId: 'r1', cursor: 25, total: 50, status: 'running', resumed: true }))
      .mockResolvedValueOnce({ ok: false, status: 409, json: () => Promise.resolve({ error: 'Scan already finished' }) })
    render(<ScannerButton resumable />)
    fireEvent.click(screen.getByRole('button', { name: /riprendi scansione/i }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
```

`tests/components/ScannerInfo.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScannerInfo } from '@/components/ScannerInfo'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'

describe('ScannerInfo', () => {
  it('lists the eight criteria with the same labels as the stock page', () => {
    render(<ScannerInfo />)
    for (const label of TREND_TEMPLATE_LABELS) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('says where it looks, what it does not check, where the data comes from, and that it is not advice', () => {
    render(<ScannerInfo />)
    expect(screen.getByText(/S&P 500/)).toBeInTheDocument()
    expect(screen.getByText(/utili, ricavi/i)).toBeInTheDocument()
    expect(screen.getByText(/Yahoo Finance/)).toBeInTheDocument()
    expect(screen.getByText(/barra di oggi/i)).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })
})
```

`tests/components/ScannerTable.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'

const row = (over: Partial<ScannerRow>): ScannerRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 100, rs: 90, passedCount: 8, vcpStatus: null, pivot: null, pivotDistancePct: null, missing: null, ...over,
})

describe('ScannerTable', () => {
  const rows = [
    row({ symbol: 'LOW', name: 'Low RS', rs: 75 }),
    row({ symbol: 'TOP', name: 'Top RS', rs: 99, vcpStatus: 'forming', pivot: 105, pivotDistancePct: -4.8 }),
    row({ symbol: 'NEAR', name: 'Near miss', rs: 60, passedCount: 7, missing: TREND_TEMPLATE_LABELS[7] }),
  ]

  it('sorts the 8/8 stocks by RS and links each to its page', () => {
    render(<ScannerTable rows={rows} />)
    const section = screen.getByRole('region', { name: /8 criteri su 8/i })
    const links = within(section).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/stock/TOP', '/stock/LOW'])
  })

  it('shows VCP state, pivot and distance', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.getByText('Base pronta')).toBeInTheDocument()
    expect(screen.getByText('105.00')).toBeInTheDocument()
    expect(screen.getByText(/4,8% sotto/)).toBeInTheDocument()
  })

  it('lists the 7/8 stocks apart with the criterion they miss', () => {
    render(<ScannerTable rows={rows} />)
    const near = screen.getByRole('region', { name: /quasi/i })
    expect(within(near).getByText('Near miss')).toBeInTheDocument()
    expect(within(near).getByText(TREND_TEMPLATE_LABELS[7])).toBeInTheDocument()
  })

  it('filters to bases forming or breaking out', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /solo vcp/i }))
    const section = screen.getByRole('region', { name: /8 criteri su 8/i })
    expect(within(section).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/stock/TOP'])
  })

  it('shows an empty message when no stock passes', () => {
    render(<ScannerTable rows={[]} />)
    expect(screen.getByText(/nessun titolo/i)).toBeInTheDocument()
  })

  it('writes a dash for a missing RS or pivot', () => {
    render(<ScannerTable rows={[row({ symbol: 'NORS', rs: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/ScannerButton.test.tsx tests/components/ScannerInfo.test.tsx tests/components/ScannerTable.test.tsx`
Expected: FAIL (componenti non esistono).

- [ ] **Step 3: Write the components**

`components/ScannerButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './ScannerButton.module.css'

interface Progress {
  cursor: number
  total: number
}

export function ScannerButton({ resumable }: { resumable: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canResume, setCanResume] = useState(resumable)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const startRes = await fetch('/api/scanner', { method: 'POST' })
      const start = await startRes.json().catch(() => ({}))
      if (!startRes.ok) {
        setError(startRes.status === 429 ? `Ultima scansione troppo recente: puoi rilanciarla dopo le ${new Date(start.retryAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.` : (start.error ?? 'Scansione fallita'))
        return
      }
      setProgress({ cursor: start.cursor, total: start.total })
      let status: string = start.status
      while (status === 'running') {
        const res = await fetch('/api/scanner/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: start.runId }) })
        if (res.status === 409) break
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? 'Scansione fallita')
          setCanResume(true)
          return
        }
        setProgress({ cursor: body.cursor, total: body.total })
        status = body.status
      }
      setCanResume(false)
      router.refresh()
    } catch {
      setError('Scansione fallita')
      setCanResume(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" onClick={run} disabled={running} className={styles.button}>
        {running ? 'Scansione in corso…' : canResume ? 'Riprendi scansione' : 'Avvia scansione'}
      </button>
      {running && progress && (
        <div className={styles.progress}>
          <progress value={progress.cursor} max={progress.total} aria-label="Avanzamento scansione" />
          <span>
            {progress.cursor} di {progress.total}
          </span>
          <span className={styles.hint}>Lascia aperta questa pagina: servono 2–4 minuti.</span>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
```

`components/ScannerButton.module.css` (stesso aspetto di `ScanButton.module.css`, più il blocco avanzamento):

```css
.wrap {
  margin-bottom: 24px;
}

.button {
  font-family: var(--font-ui);
  font-size: 14px;
  min-height: 44px;
  padding: 0 20px;
  border-radius: 999px;
  border: 1px solid var(--brass);
  background: transparent;
  color: var(--brass);
  cursor: pointer;
}

.button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 12px;
  font-size: 14px;
  color: var(--muted);
}

.progress progress {
  width: min(320px, 100%);
  accent-color: var(--brass);
}

.hint {
  flex-basis: 100%;
  font-size: 13px;
}

.error {
  margin-top: 8px;
  font-size: 13px;
  color: var(--loss);
}
```

`components/ScannerInfo.tsx`:

```tsx
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'
import styles from './ScannerInfo.module.css'

export function ScannerInfo() {
  return (
    <section className={styles.box} aria-labelledby="scanner-info-title">
      <h2 id="scanner-info-title" className={styles.title}>
        Cosa comprende lo scanner
      </h2>
      <dl className={styles.list}>
        <div>
          <dt>Dove cerca</dt>
          <dd>I circa 500 titoli dell’S&amp;P 500, le maggiori società quotate negli Stati Uniti. Società più piccole e mercati fuori dagli USA restano fuori.</dd>
        </div>
        <div>
          <dt>Cosa controlla</dt>
          <dd>
            Gli 8 criteri del Trend Template di Minervini, gli stessi della scheda di ogni titolo:
            <ol className={styles.criteria}>
              {TREND_TEMPLATE_LABELS.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
          </dd>
        </div>
        <div>
          <dt>Forza relativa</dt>
          <dd>
            Posizione del titolo da 0 a 100 rispetto a tutti gli altri titoli scansionati, sul rendimento dell’ultimo anno con peso doppio all’ultimo trimestre. È un’approssimazione del rating IBD, non è lo stesso numero.
          </dd>
        </div>
        <div>
          <dt>VCP e pivot</dt>
          <dd>Ricerca automatica di ribassi sempre più piccoli prima di una possibile rottura, con il livello del pivot. Segnala candidati da verificare sul grafico, non punti d’acquisto.</dd>
        </div>
        <div>
          <dt>Cosa non controlla</dt>
          <dd>Utili, ricavi e altri fondamentali, notizie, liquidità degli scambi. Si guardano nella scheda del titolo.</dd>
        </div>
        <div>
          <dt>Dati</dt>
          <dd>Prezzi giornalieri degli ultimi 2 anni da Yahoo Finance. Se la scansione gira a mercato aperto, la barra di oggi è ancora incompleta.</dd>
        </div>
      </dl>
      <p className={styles.disclaimer}>Strumento di ricerca: non è consulenza finanziaria.</p>
    </section>
  )
}
```

`components/ScannerInfo.module.css`:

```css
.box {
  margin: 0 0 32px;
  padding: 20px 24px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  box-shadow: var(--card-shadow);
}

.title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
}

.list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.list dt {
  font-size: 14px;
  font-weight: 600;
}

.list dd {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}

.criteria {
  margin: 6px 0 0;
  padding-left: 20px;
}

.disclaimer {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 13px;
}
```

`components/ScannerTable.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { VCP_STATUS_LABEL, type VcpStatus } from '@/lib/minervini'
import styles from './ScannerTable.module.css'

export interface ScannerRow {
  symbol: string
  name: string
  sector: string | null
  price: number
  rs: number | null
  passedCount: number
  vcpStatus: VcpStatus | null
  pivot: number | null
  pivotDistancePct: number | null
  missing: string | null
}

const dash = '—'
const num = (v: number, digits = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const distance = (v: number | null) => (v === null ? dash : `${num(Math.abs(v))}% ${v >= 0 ? 'sopra' : 'sotto'}`)

function Rows({ rows, showMissing }: { rows: ScannerRow[]; showMissing: boolean }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Titolo</th>
            <th>Settore</th>
            <th className={styles.num}>Prezzo</th>
            <th className={styles.num}>RS</th>
            <th>VCP</th>
            <th className={styles.num}>Pivot</th>
            <th>Dal pivot</th>
            {showMissing && <th>Manca</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <Link href={`/stock/${r.symbol}`} className={styles.link}>
                  <strong>{r.symbol}</strong> <span className={styles.name}>{r.name}</span>
                </Link>
              </td>
              <td>{r.sector ?? dash}</td>
              <td className={styles.num}>{num(r.price, 2)}</td>
              <td className={styles.num}>{r.rs === null ? dash : Math.round(r.rs)}</td>
              <td>{r.vcpStatus ? VCP_STATUS_LABEL[r.vcpStatus] : dash}</td>
              <td className={styles.num}>{r.pivot === null ? dash : r.pivot.toFixed(2)}</td>
              <td>{distance(r.pivotDistancePct)}</td>
              {showMissing && <td>{r.missing ?? dash}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const byRs = (a: ScannerRow, b: ScannerRow) => (b.rs ?? -1) - (a.rs ?? -1)

export function ScannerTable({ rows }: { rows: ScannerRow[] }) {
  const [onlyVcp, setOnlyVcp] = useState(false)
  const visible = rows.filter((r) => !onlyVcp || r.vcpStatus === 'forming' || r.vcpStatus === 'breakout')
  const full = visible.filter((r) => r.passedCount >= 8).sort(byRs)
  const near = visible.filter((r) => r.passedCount === 7).sort(byRs)

  return (
    <>
      <label className={styles.filter}>
        <input type="checkbox" checked={onlyVcp} onChange={(e) => setOnlyVcp(e.target.checked)} /> Solo VCP in formazione o in rottura
      </label>
      <section aria-label="8 criteri su 8" className={styles.block}>
        <h2 className={styles.heading}>8 criteri su 8 ({full.length})</h2>
        {full.length === 0 ? <p className={styles.empty}>Nessun titolo supera tutti i criteri.</p> : <Rows rows={full} showMissing={false} />}
      </section>
      <section aria-label="Quasi: 7 criteri su 8" className={styles.block}>
        <h2 className={styles.heading}>Quasi: 7 su 8 ({near.length})</h2>
        {near.length === 0 ? <p className={styles.empty}>Nessun titolo a un criterio dal template.</p> : <Rows rows={near} showMissing />}
      </section>
    </>
  )
}
```

`components/ScannerTable.module.css`:

```css
.filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--muted);
}

.block {
  margin-bottom: 40px;
}

.heading {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
}

.scroll {
  overflow-x: auto;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  box-shadow: var(--card-shadow);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th,
.table td {
  padding: 10px 14px;
  text-align: left;
  white-space: nowrap;
  border-top: 1px solid var(--rule);
}

.table thead th {
  border-top: 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}

.num {
  text-align: right !important;
  font-family: var(--font-num);
}

.link {
  color: inherit;
  text-decoration: none;
}

.link:hover {
  color: var(--brass);
}

.name {
  margin-left: 6px;
  color: var(--muted);
}

.empty {
  color: var(--muted);
  font-size: 15px;
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run tests/components/ScannerButton.test.tsx tests/components/ScannerInfo.test.tsx tests/components/ScannerTable.test.tsx`
Expected: PASS. Se il test sul filtro `getByText('105.00')` trova più elementi, restringere il test alla riga, non cambiare il formato.

- [ ] **Step 5: Page, nav, verifica finale e commit**

`app/scanner/page.tsx`:

```tsx
import { Suspense } from 'react'
import { connection } from 'next/server'
import { prisma } from '@/lib/db'
import { ScannerButton } from '@/components/ScannerButton'
import { ScannerInfo } from '@/components/ScannerInfo'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import type { Criterion, VcpStatus } from '@/lib/minervini'
import { missingCriterion } from '@/lib/scanner'
import { PARTIAL_UNREAD_SHARE, latestCompleteRun, runningRun } from '@/lib/scanner-run'
import styles from '../section.module.css'
import local from './page.module.css'

async function Results() {
  await connection()
  const run = await latestCompleteRun()
  if (!run) return <p className={styles.empty}>Nessuna scansione ancora eseguita. Premi “Avvia scansione” per iniziare.</p>

  const found = await prisma.scanResult.findMany({ where: { runId: run.id, status: 'ok', passedCount: { gte: 7 } } })
  const rows: ScannerRow[] = found.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    price: r.price!,
    rs: r.rs,
    passedCount: r.passedCount!,
    vcpStatus: r.vcpStatus as VcpStatus | null,
    pivot: r.pivot,
    pivotDistancePct: r.pivotDistancePct,
    missing: r.passedCount === 7 ? missingCriterion((r.criteria ?? []) as unknown as Criterion[], r.rs) : null,
  }))
  const readable = run.total - run.unreadCount
  const partial = run.unreadCount > run.total * PARTIAL_UNREAD_SHARE

  return (
    <>
      <p className={local.scannedAt}>
        Ultima scansione: {run.finishedAt?.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle{' '}
        {run.finishedAt?.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {readable} titoli letti, {run.unreadCount} non letti
      </p>
      {partial && (
        <p role="note" className={local.partial}>
          Dati parziali: troppi titoli non sono stati letti, quindi la forza relativa è meno affidabile.
        </p>
      )}
      <ScannerTable rows={rows} />
    </>
  )
}

async function Controls() {
  await connection()
  return <ScannerButton resumable={(await runningRun()) !== null} />
}

export default function ScannerPage() {
  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>Scanner Minervini</h1>
      <section className={styles.section}>
        <p className={styles.lead}>Cerca tra i titoli dell’S&amp;P 500 quelli che soddisfano il Trend Template di Minervini e mostra stato VCP e distanza dal pivot.</p>
        <Suspense fallback={null}>
          <Controls />
        </Suspense>
        <ScannerInfo />
        <Suspense fallback={<p className={styles.empty}>Carico i risultati…</p>}>
          <Results />
        </Suspense>
      </section>
    </main>
  )
}
```

`app/scanner/page.module.css`:

```css
.scannedAt {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 14px;
}

.partial {
  margin: 0 0 16px;
  padding: 10px 14px;
  border: 1px solid var(--amber-bright);
  border-radius: var(--radius-inner);
  color: var(--amber-bright);
  font-size: 14px;
}
```

In `components/SiteNav.tsx`, nell'array `ITEMS` aggiungere prima della voce `Scopri`:

```ts
  { href: '/scanner', label: 'Scanner', short: 'Scanner' },
```

Verifica finale:

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tutto verde. Poi controllo a mano: `npm run dev`, aprire `/scanner`, premere "Avvia scansione", verificare barra di avanzamento, tabella a fine giro, voce "Scanner" nel menu (anche in vista stretta) e che un secondo click entro un'ora mostri il messaggio "troppo recente".

```bash
git add components/ScannerButton.tsx components/ScannerButton.module.css components/ScannerInfo.tsx components/ScannerInfo.module.css components/ScannerTable.tsx components/ScannerTable.module.css components/SiteNav.tsx app/scanner tests/components/ScannerButton.test.tsx tests/components/ScannerInfo.test.tsx tests/components/ScannerTable.test.tsx
git commit -m "feat: add Minervini scanner page"
```

---

## Self-Review

**Copertura della spec**
- Universo S&P 500 in file + conversione simboli → Task 2. ✔
- Schema `ScanRun`/`ScanResult`, ultime 2 scansioni → Task 4 e 5 (`KEEP_RUNS`). ✔
- `scanSymbol`, `finalize`, `RS_MIN` condiviso → Task 1 e 3. ✔
- Route `POST /api/scanner` (ripresa, attesa di 1 ora → 429) e `step` (blocchi da 25, 5 in parallelo, un secondo tentativo, cursore con controllo, chiusura, `maxDuration = 60`) → Task 5 e 6. ✔
- Pagina: testata con pulsante e avanzamento, riquadro "Cosa comprende lo scanner", tabella 8/8 per RS, sezione 7/8 con criterio mancante, filtro VCP, stato vuoto, avviso dati parziali, nav → Task 7. ✔
- Gestione errori (non letti, oltre il 10%, scheda chiusa, errore di `step`) → Task 5 e 7. ✔
- Test elencati in spec → Task 2, 3, 5, 6, 7. ✔

**Scansione e tipi**
`scanSymbol` → `ScanSymbolResult`; `toRow` (Task 5) usa gli stessi campi; `finalize` riceve `FinalizeInput { symbol, weightedReturn, criteria }`; `missingCriterion(criteria, rs)` è chiamata in pagina con gli stessi tipi. `StepResult.kind` (`advanced | stale | done | not-found`) è gestito dalla route (`not-found` → 404, `done` → 409, altri → 200 con `advanced`). `ScannerRow` coincide con i campi costruiti in `app/scanner/page.tsx`.

**Punti da sapere**
- Due `POST /api/scanner` simultanei, a database vuoto, possono creare due scansioni `running`; la pagina e la ripresa usano la più recente. Succede solo con due click nello stesso istante e non corrompe i dati; un indice parziale unico sarebbe una correzione di schema fuori scope.
- Il percentile usa "tutti gli altri titoli letti", come la scheda titolo; la scheda continua a usare watchlist e candidati come pari (task 16 di `auditcalc.md`).
- Titoli con più classi di azioni (es. `GOOG` e `GOOGL`) compaiono entrambi.
