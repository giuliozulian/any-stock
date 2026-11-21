# Scanner: fondamentali, AVWAP e volume 1,5× nel verdetto, piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development) per eseguire questo piano task per task. I passi usano checkbox (`- [ ]`).

**Goal:** Il verdetto di scanner, email e tab Minervini concorda con il notebook "Momentum breakout engine": niente "Si può comprare" senza fondamentali, con prezzo sotto l'AVWAP o con volume sotto 1,5×.

**Architecture:** Logica pura nel verdetto (`lib/scanner.ts`, `lib/fundamentals-gate.ts`). I fondamentali (Finnhub) si scaricano solo per i candidati e si salvano su `ScanResult`. L'AVWAP si calcola dalle barre già lette e viaggia in `Vcp`. Tab e scanner passano dallo stesso `planFor`.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7 + Postgres, Vitest, Finnhub.

**Spec:** `docs/superpowers/specs/2026-11-21-scanner-fundamentals-gate-design.md`

## Global Constraints

- Soglie: EPS q/q > 25%, ricavi q/q > 25%, ROE > 15% (percentuali, come le restituisce Finnhub: `epsGrowthQuarterlyYoy`, `revenueGrowthQuarterlyYoy`, `roeTTM`). Fallisce chi è `<=` soglia.
- `BREAKOUT_VOLUME = 1.5`. Zona d'acquisto 5% e stop 8% restano.
- Dato mancante (`null`) non pesa contro il titolo.
- Testi in italiano. Commit senza menzione di Claude/AI e senza trailer.
- `lib/scanner.ts` e `lib/fundamentals-gate.ts` restano puri (importati da componenti client): niente Prisma, niente rete.

## Review Focus

- Tutte e tre le misure `null` o Finnhub in errore: il verdetto resta `buy`, non blocca (test in Task 2 e 5).
- Una sola misura sotto soglia con le altre `null`: `fail` (Task 2).
- Soglia esatta (25,0): fallisce, come "oltre 25" di Finviz (Task 2).
- Prezzo uguale all'AVWAP: non è "sotto", resta `buy` (Task 5).
- `weak-fundamentals` non genera email d'allerta (Task 5, `planFor`).
- Tab senza `symbol` o senza fondamentali non si rompe (Task 8).
- Il budget di tempo scaduto lascia i dati `null` senza far fallire la chiusura della scansione (Task 6).

## Scostamenti dalla spec (decisi leggendo il codice)

1. I fondamentali si scaricano dentro `closeRun`, con budget di tempo, prima di `notifyScanAlerts`, non in un passo separato: un passo separato obbligherebbe a cambiare il protocollo di polling di `/api/scanner/step` e le email partirebbero prima dei dati. Se il budget scade, i dati restano `null`.
2. `action()` in `MinerviniPanel` resta per il caso "meno di 8 controlli" (descrive la base, non un acquisto). Il verdetto con 8/8 passa da `planForAnalysis`/`sentence`.
3. `sentence()` non aggiunge "fondamentali non disponibili"; lo mostra la nuova scheda "Utili e ricavi" nella tab.

---

### Task 1: campi Finnhub

**Files:** Modify `lib/finnhub.ts`, `tests/lib/finnhub.test.ts`

- [ ] Test: `getMetrics` legge `epsGrowthQuarterlyYoy` e `revenueGrowthQuarterlyYoy` (mock `{ metric: { epsGrowthQuarterlyYoy: 0.18, revenueGrowthQuarterlyYoy: -13.85 } }`); aggiornare il test `toEqual` dei null con i due campi.
- [ ] `FinnhubMetrics` += `epsGrowthQuarterlyYoy?: number | null`, `revenueGrowthQuarterlyYoy?: number | null`; `getMetrics` li legge da `data.metric` con `?? null`.
- [ ] `npx vitest run tests/lib/finnhub.test.ts`; commit `feat: read quarterly growth from Finnhub metrics`.

### Task 2: gate dei fondamentali (puro)

**Files:** Create `lib/fundamentals-gate.ts`, `tests/lib/fundamentals-gate.test.ts`

**Produces:** `Fundamentals`, `EPS_GROWTH_MIN`, `SALES_GROWTH_MIN`, `ROE_MIN`, `fundamentalsState(f): 'pass'|'fail'|'unknown'`, `fundamentalsMisses(f): string[]`.

```ts
export interface Fundamentals { epsGrowthQoq: number | null; salesGrowthQoq: number | null; roe: number | null }
export const EPS_GROWTH_MIN = 25
export const SALES_GROWTH_MIN = 25
export const ROE_MIN = 15
export type FundamentalsState = 'pass' | 'fail' | 'unknown'

const CHECKS = [
  { key: 'epsGrowthQoq', min: EPS_GROWTH_MIN, label: 'utili per azione' },
  { key: 'salesGrowthQoq', min: SALES_GROWTH_MIN, label: 'ricavi' },
  { key: 'roe', min: ROE_MIN, label: 'ROE' },
] as const

const pct = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(Math.round(v))}%`

export function fundamentalsMisses(f: Fundamentals | null | undefined): string[] {
  if (!f) return []
  return CHECKS.flatMap((c) => (f[c.key] !== null && f[c.key]! <= c.min ? [`${c.label} ${pct(f[c.key]!)} (ne servono oltre ${c.min}%)`] : []))
}

export function fundamentalsState(f: Fundamentals | null | undefined): FundamentalsState {
  if (!f || CHECKS.every((c) => f[c.key] === null)) return 'unknown'
  return fundamentalsMisses(f).length > 0 ? 'fail' : 'pass'
}
```

- [ ] Test: tutti sopra soglia = pass; EG (0,18 / −13,85 / 12,51) = fail con 3 misses; 25,0 esatto = fail; una misura sotto e due `null` = fail; tutte `null` / `null` / `undefined` = unknown; due sopra e una `null` = pass.
- [ ] Commit `feat: add the fundamentals gate`.

### Task 3: AVWAP

**Files:** Modify `lib/minervini.ts`, `lib/scanner.ts` (`ScanSymbolResult`, `scanSymbol`), `tests/lib/minervini.test.ts`, `tests/lib/scanner.test.ts`, `tests/components/MinerviniPanel.test.tsx` (fixture `Vcp`)

```ts
// Volume-weighted average price from an anchor bar to the last bar, on the typical price (high + low + close) / 3.
export function anchoredVwap(bars: Bar[], fromIndex: number): number | null {
  let pv = 0
  let v = 0
  for (let i = Math.max(0, fromIndex); i < bars.length; i++) {
    const b = bars[i]
    pv += ((b.high + b.low + b.close) / 3) * b.volume
    v += b.volume
  }
  return v > 0 ? pv / v : null
}
```

- `Vcp` += `avwap: number | null`; `none` ha `avwap: null`.
- In `detectVcp`, dopo `base`: ancora = indice del `low` più basso tra `highs[start].index` e `last`; `avwap = anchoredVwap(recent, anchor)`; incluso nel return.
- `ScanSymbolResult` += `avwap: number | null`; `scanSymbol` lo copia da `vcp.avwap`.
- [ ] Test `anchoredVwap`: barre con high=low=close 10/20/30 e volumi 1/1/2 da indice 1 = 26,667; volume zero = null; `fromIndex` negativo = da 0. Test `detectVcp`: la fixture che dà `breakout` ha `avwap` numerico finito, quella senza base ha `null`. Test `scanSymbol` copia `avwap`.
- [ ] Commit `feat: compute the anchored VWAP from the base low`.

### Task 4: volume 1,5×

**Files:** Modify `lib/minervini.ts` (`BREAKOUT_VOLUME`, commento di `Vcp.volumeRatio`), `docs/minervini-rulebook.md` (E2 e copertura), test che assumono 1,4.

- [ ] `BREAKOUT_VOLUME = 1.5` con commento: "soglia del notebook (report ChatGPT); Minervini non dà un numero".
- [ ] `grep -rn "1\.4\|1,4" lib components tests` e aggiornare i valori limite dei test (volume 1,4 che prima passava ora è `confirm`).
- [ ] Commit `feat: require 1.5x volume for a breakout`.

### Task 5: verdetto

**Files:** Modify `lib/scanner.ts`, `lib/scan-verdict.ts`, `tests/lib/scanner.test.ts`, `tests/lib/scan-verdict.test.ts`

**Produces:** `Verdict` += `'weak-fundamentals'`; `PlanInput` += `fundamentals?`, `avwap?`; `TradePlan` += `reason: 'below-avwap' | null`; `PlanNote` += `'below-avwap'`; `ScanRow` += `fundamentals?`, `avwap?`; `ResultLike` += `epsGrowthQoq?`, `salesGrowthQoq?`, `roe?`, `avwap?`.

Regola in `tradePlan` (`verdict` diventa `let`):
```ts
let reason: TradePlan['reason'] = null
if (verdict === 'buy') {
  if (fundamentalsState(r.fundamentals) === 'fail') verdict = 'weak-fundamentals'
  else if (r.avwap != null && r.price < r.avwap) { verdict = 'confirm'; reason = 'below-avwap' }
}
```
`NO_PRICES` += `reason: null`. `withContext`: prima riga `if (plan.reason === 'below-avwap') return { plan, note: 'below-avwap' }`; `hasPrices` include `weak-fundamentals`.

`VERDICT`: `'weak-fundamentals': { label: 'Tecnico ok, fondamentali deboli', tone: 'warn', rank: 1 }`, gli altri scalano di uno (noisy 2 … broken 8).

`sentence`: nota `below-avwap` e caso `weak-fundamentals` ("... ma i fondamentali non reggono: ${misses}. Il metodo vuole utili e ricavi in forte crescita: meglio non comprare.").

`toScanRow`: `fundamentals` costruito se almeno una delle tre misure non è `null`/`undefined`; `avwap: r.avwap ?? null`.

- [ ] Test: EG (breakout, volume 1,8, fondamentali −13,85/0,18/12,51) = `weak-fundamentals` con prezzi di `buy`; fondamentali tutti `null` = `buy`; prezzo = AVWAP = `buy`; prezzo < AVWAP = `confirm` + nota `below-avwap`; `watch`/`late` non cambiano; `planFor(...).plan.verdict !== 'buy'` per EG; ranks unici (9).
- [ ] Commit `feat: gate the buy verdict on fundamentals and the anchored VWAP`.

### Task 6: dati dello scanner

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261121100000_add_scan_fundamentals/migration.sql`, `lib/scan-fundamentals.ts`, `tests/lib/scan-fundamentals.test.ts`; Modify `lib/scanner-run.ts`, `lib/finviz-screen.ts`, `tests/lib/scanner-run.test.ts`

- Schema: `ScanResult` += `epsGrowthQoq Float?`, `salesGrowthQoq Float?`, `roe Float?`, `avwap Float?`. Migrazione:
```sql
-- AlterTable
ALTER TABLE "ScanResult" ADD COLUMN "epsGrowthQoq" DOUBLE PRECISION,
ADD COLUMN "salesGrowthQoq" DOUBLE PRECISION,
ADD COLUMN "roe" DOUBLE PRECISION,
ADD COLUMN "avwap" DOUBLE PRECISION;
```
- Poi `npx prisma generate` e applicare la migrazione al DB di test (README: `DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2- | tr -d '"') npx prisma migrate deploy`).
- `toRow`: `avwap: r.avwap`. `finviz-screen.ts`: passare `avwap: scan.avwap` a `toScanRow`.
- `lib/scan-fundamentals.ts`: `fetchFundamentals(symbols, budgetMs, deps?: { fetchMetrics?: typeof getMetrics; now?: () => number })` → `Map<string, Fundamentals>`; concorrenza 5, massimo 40 simboli, salta i simboli quando il budget è scaduto, errore su un simbolo = assente dalla mappa.
- `fillFundamentals(runId, budgetMs, fetchMetrics?)` in `lib/scanner-run.ts`: legge i risultati `ok` con `passedCount >= 8` e `vcpStatus` `forming`/`breakout`, scarica, scrive con un solo `UPDATE ... FROM (VALUES ...)` (stesso schema di `closeRun`). Errori inghiottiti con `console.error`.
- `closeRun(runId, budgetMs)` chiama `fillFundamentals` dopo l'UPDATE di rs/passedCount e prima di chiudere il run/`notifyScanAlerts`. `stepRun` passa `budgetMs = clamp(50_000 - (now() - startedAt), 0, 15_000)`; `StepDeps` += `fetchMetrics?`.
- [ ] Test `fetchFundamentals` (mappatura, errore per simbolo, budget scaduto, tetto 40). Test `fillFundamentals` con righe create via Prisma e `fetchMetrics` finto; i test che chiudono un run passano `fetchMetrics` che lancia, per non toccare la rete.
- [ ] Commit `feat: store fundamentals and the anchored VWAP on scan results`.

### Task 7: dati della tab

**Files:** Modify `lib/minervini-data.ts`, `lib/scan-verdict.ts`, `tests/lib/minervini-data.test.ts`, `tests/lib/scan-verdict.test.ts`

- `MinerviniAnalysis` += `fundamentals?: Fundamentals | null`, `avwap?: number | null`. `buildAnalysis(bars, peerReturns, fundamentals = null)` imposta `avwap: vcp.avwap`. `getMinerviniAnalysis` scarica `getMetrics(symbol).catch(() => null)` in parallelo e lo converte (`epsGrowthQuarterlyYoy`, `revenueGrowthQuarterlyYoy`, `roe`).
- In `scan-verdict.ts`: `rowFromAnalysis(symbol, analysis): ScanRow` e `planForAnalysis(symbol, analysis, ctx = { caution: null, market: null })` → `{ row, plan, note }`.
- [ ] Test: stessa analisi dà in tab lo stesso verdetto di `planFor(toScanRow(...))`; EG = `weak-fundamentals`.
- [ ] Commit `feat: build the stock page verdict from the same plan as the scanner`.

### Task 8: UI della tab

**Files:** Modify `components/MinerviniPanel.tsx`, `tests/components/MinerviniPanel.test.tsx`

- Il componente principale calcola una volta `const { row, plan, note } = planForAnalysis(symbol ?? '', analysis)`; `Decision` riceve `row`, `plan`, `note` e non ricostruisce nulla; `buyNow = plan.verdict === 'buy'` sostituisce la seconda chiamata a `tradePlan`.
- `entryState(template, vcp, plan?)`: con 8/8 e `weak-fundamentals` chip "Fondamentali deboli" tono `warn`; con `reason === 'below-avwap'` chip "Sotto il VWAP" tono `warn`.
- Nuova `FundamentalsCard` (sezione "Utili e ricavi" dopo `EntryStep`): tre righe con `styles.row`/`MARK`/`STATUS` (ok/ko/na) e il valore; senza dati un paragrafo "Utili e ricavi non disponibili". Testo di `styles.scope` aggiornato (non dice più "guarda solo il prezzo").
- [ ] Test: EG con 8/8 mostra "Fondamentali deboli" e la frase di `weak-fundamentals`; senza `symbol` e senza fondamentali non si rompe; con fondamentali sopra soglia resta "Si può comprare".
- [ ] Commit `feat: show fundamentals and the aligned verdict in the Minervini tab`.

### Task 9: analisi AI e rulebook

**Files:** Modify `lib/minervini-ai.ts`, `lib/minervini-rulebook.ts`, `docs/minervini-rulebook.md`, `tests/lib/minervini-ai.test.ts`, `tests/lib/minervini-rulebook.test.ts`

- `AiInput` += `fundamentals?: Fundamentals | null`, `avwap?: number | null`; `buildInput` li valorizza (AVWAP arrotondato).
- Prompt: la riga `verdict:` aggiunge "gli utili e i ricavi dell'ultimo trimestre superano le soglie (EPS e ricavi oltre 25%, ROE oltre 15%) e il prezzo sta sopra l'avwap; se fundamentals è null non sono valutabili e non bloccano". `PROMPT_VERSION = 3`, `RULEBOOK_VERSION = 3`.
- `parseAiResult`: `lowered` anche con `fundamentalsState(input.fundamentals) === 'fail'` o `input.avwap != null && input.price < input.avwap`.
- Rulebook: regola F2 nel modulo (kind `calcolo`, `verified: false`, fonte "CAN SLIM, report ChatGPT; soglie nostre"), tolta da `LEFT_OUT` nel test; documento: F2 diventa `calcolo` con ROE ≥ 15%, E2 a 1,5×, sezione 7 e "Copertura nel codice" aggiornate.
- [ ] Test: `ready` con fondamentali deboli → `wait` e `adjusted: true`; con prezzo sotto AVWAP → `wait`; con `null` non cambia; l'hash cambia con la versione.
- [ ] Commit `feat: apply fundamentals and the VWAP to the AI analysis`.

### Task 10: verifica finale

- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Tutto verde.
- [ ] Controllo a mano su EG: `/stock/EG` e `/scanner` mostrano "fondamentali deboli".
