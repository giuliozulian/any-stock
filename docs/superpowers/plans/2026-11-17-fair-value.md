# Valore equo e Lynch (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la media dei quattro modelli di valore equo con un intervallo (minimo, massimo, mediana) e un giudizio di affidabilità, usare un solo Lynch, ricavare il free cash flow da Finnhub (`prezzo ÷ pfcfShareTTM`) e far votare il verdetto sulla posizione del prezzo rispetto all'intervallo.

**Architecture:** `lib/fair-value.ts` si divide in tre funzioni pure: `fairValueModels` (idoneità e valore di ogni modello, con il motivo dell'esclusione), `summarizeModels` (intervallo, mediana, affidabilità, posizione) e `fairValue` che le compone. `evaluateStock` riceve il risultato già calcolato e sostituisce `targetPrice` con `fairValue`; la pagina e il confronto costruiscono l'input con un solo `buildFairValueInput`. `FairValueCard` mostra intervallo, scala e dettaglio dei modelli esclusi.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma (nessuna modifica allo schema), vitest + Testing Library, CSS modules.

**Spec:** `docs/superpowers/specs/2026-11-17-fair-value-design.md`. Deviazioni intenzionali:
1. Le tre funzioni (`fairValueModels`, `summarizeModels`, `fairValue`) sono esportate separatamente, così gli scenari di affidabilità e posizione si provano con valori sintetici esatti, senza inseguire input reali.
2. `EvaluateInput.fairValue` è **obbligatorio** (`FairValueResult | null`), per evitare che un chiamante dimentichi di passarlo e il voto sparisca in silenzio.
3. `overallTone` di `components/EvaluationPanel.tsx` viene esportata, per provarla direttamente.
4. Il Task 2 adatta `FairValueCard` al minimo indispensabile perché il progetto continui a compilare; la scheda vera si scrive nel Task 4.

## Global Constraints

- Testi UI in italiano. Messaggi di commit in inglese, stile convenzionale (`feat:`, `refactor:`), **senza trailer `Co-Authored-By` e senza menzionare Claude o AI** (regola utente in `~/.claude/CLAUDE.md`).
- **Commit:** l'utente ha scritto "commit fatto io". Prima del Task 1 l'esecutore chiede se può committare; senza risposta salta ogni passo "Commit", elenca nel ledger i file modificati per task e non esegue `git add`/`git commit`.
- AGENTS.md: questo Next.js ha differenze rispetto al noto; nessun cambio di route o di convenzioni in questo piano.
- Lavorare su un branch, mai su `main` (al momento del piano: `feat/app-login`; creare `feat/fair-value` se il repo è su `main`).
- Test in `tests/lib` e `tests/components`; alias `@/` = radice. Comando: `npx vitest run <file>`. Il DB di test è già attivo (`any-stock-postgres-test-1`); nessuna migrazione in questo piano.
- Formato dei numeri nella scheda: `toFixed(2)` con il punto, come il resto di `FairValueCard`.
- Costanti in `lib/valuation-config.ts` (valori esatti dalla spec): `AAA_YIELD = 4.5`, `DISCOUNT_RATE = 0.09`, `TERMINAL_GROWTH = 0.025`, `GRAHAM_GROWTH_MAX = 15`, `DCF_GROWTH_MAX = 12`, `LYNCH_PE_MIN = 5`, `LYNCH_PE_MAX = 25`, `MIN_BOOK_TO_PRICE = 0.10`, `RELIABLE_MAX_SPREAD = 2`, `VALUATION_TUNED_ON = '2026-11-17'`.
- Soglia di affidabilità inclusiva: spread esattamente 2 è affidabile.
- Mai `NaN` o valori non finiti in pagina: un modello con valore non finito o non positivo è escluso.
- Una crescita mancante non diventa 0 e non esiste più il pavimento del 3%.
- Fuori scope: formule per settore, Altman, Piotroski, soglia debito/capitale (C2); consenso analisti e notizie (C3); bilanci IFRS (C4); nuovi modelli.

## Review Focus

1. Input non finiti (`NaN`, `Infinity`) per utile, crescita, patrimonio o `priceToFcf` → il modello è escluso e il risultato non contiene mai `NaN` (Task 2).
2. Spread esattamente 2 → affidabile; 2,01 → non affidabile (Task 2).
3. `priceToFcf` assente, zero o negativo → solo il flusso di cassa è escluso, gli altri modelli restano (Task 2).
4. Valore equo non calcolabile (`null`) → il verdetto non cambia e la nota lo dice (Task 3).
5. Le note LLM già salvate si rigenerano: cambiano `PROMPT_VERSION` e il testo che entra nell'hash (Task 3).

---

### Task 1: Configurazione dei parametri e `priceToFcf` da Finnhub

**Files:**
- Create: `lib/valuation-config.ts`
- Modify: `lib/finnhub.ts`
- Test: `tests/lib/valuation-config.test.ts` (nuovo), `tests/lib/finnhub.test.ts`

**Interfaces:**
- Produces:
  - le costanti di `lib/valuation-config.ts` elencate in Global Constraints.
  - `FinnhubMetrics.priceToFcf?: number | null` e `getMetrics()` che lo valorizza da `pfcfShareTTM` (`null` se manca).

- [ ] **Step 1: Write the failing tests**

`tests/lib/valuation-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  AAA_YIELD,
  DCF_GROWTH_MAX,
  DISCOUNT_RATE,
  GRAHAM_GROWTH_MAX,
  LYNCH_PE_MAX,
  LYNCH_PE_MIN,
  MIN_BOOK_TO_PRICE,
  RELIABLE_MAX_SPREAD,
  TERMINAL_GROWTH,
  VALUATION_TUNED_ON,
} from '@/lib/valuation-config'

describe('valuation config', () => {
  it('holds the parameters the fair value models are tuned on', () => {
    expect(AAA_YIELD).toBe(4.5)
    expect(DISCOUNT_RATE).toBe(0.09)
    expect(TERMINAL_GROWTH).toBe(0.025)
    expect(GRAHAM_GROWTH_MAX).toBe(15)
    expect(DCF_GROWTH_MAX).toBe(12)
    expect(LYNCH_PE_MIN).toBe(5)
    expect(LYNCH_PE_MAX).toBe(25)
    expect(MIN_BOOK_TO_PRICE).toBe(0.1)
    expect(RELIABLE_MAX_SPREAD).toBe(2)
  })

  it('says when it was last tuned, as an ISO date', () => {
    expect(VALUATION_TUNED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('keeps the discount rate above the terminal growth, or the cash flow model would blow up', () => {
    expect(DISCOUNT_RATE).toBeGreaterThan(TERMINAL_GROWTH)
  })
})
```

In `tests/lib/finnhub.test.ts` aggiungere `priceToFcf: null,` dopo `cashFlowPerShare: null,` nell'oggetto atteso del test "getMetrics ... empty" (riga con `bookValuePerShare: null, cashFlowPerShare: null,`), e in fondo al `describe` dei test di `getMetrics` aggiungere:

```ts
  it('getMetrics reads the price to free cash flow ratio from pfcfShareTTM', async () => {
    mockFetchOnce({ metric: { pfcfShareTTM: 38.0533 } })
    expect((await getMetrics('AAPL')).priceToFcf).toBeCloseTo(38.0533, 4)
  })

  it('getMetrics leaves priceToFcf null when Finnhub does not send it', async () => {
    mockFetchOnce({ metric: { epsTTM: 5 } })
    expect((await getMetrics('AAPL')).priceToFcf).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/valuation-config.test.ts tests/lib/finnhub.test.ts`
Expected: FAIL (modulo `@/lib/valuation-config` mancante; `priceToFcf` non presente).

- [ ] **Step 3: Write minimal implementation**

`lib/valuation-config.ts`:

```ts
// Parameters of the fair value models. They are judgement calls, not facts: review them from time to time and move the date below.
export const VALUATION_TUNED_ON = '2026-11-17'

// Yield of AAA corporate bonds, in %: the "4,4 ÷ AAA" term of Graham's growth formula.
export const AAA_YIELD = 4.5

// Discounted cash flow.
export const DISCOUNT_RATE = 0.09
export const TERMINAL_GROWTH = 0.025
export const DCF_GROWTH_MAX = 12

// Graham with growth and Lynch.
export const GRAHAM_GROWTH_MAX = 15
export const LYNCH_PE_MIN = 5
export const LYNCH_PE_MAX = 25

// Graham number: book value per share must be at least this share of the price, or the company has too few assets for the method.
export const MIN_BOOK_TO_PRICE = 0.1

// The estimate is reliable when the highest model is at most this many times the lowest.
export const RELIABLE_MAX_SPREAD = 2
```

In `lib/finnhub.ts`: nell'interfaccia `FinnhubMetrics` aggiungere dopo `cashFlowPerShare?: number | null` la riga `priceToFcf?: number | null`, e in `getMetrics` dopo la riga `cashFlowPerShare: data.metric.cashFlowPerShareTTM ?? null,` aggiungere `priceToFcf: data.metric.pfcfShareTTM ?? null,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/valuation-config.test.ts tests/lib/finnhub.test.ts && npx tsc --noEmit`
Expected: PASS, nessun errore di tipi.

- [ ] **Step 5: Commit**

```bash
git add lib/valuation-config.ts lib/finnhub.ts tests/lib/valuation-config.test.ts tests/lib/finnhub.test.ts
git commit -m "feat: add valuation parameters and the price to free cash flow metric"
```

---

### Task 2: Riscrittura di `lib/fair-value.ts` e adattamento dei consumatori

**Files:**
- Modify: `lib/fair-value.ts` (riscrittura completa)
- Modify: `lib/compare.ts`, `app/stock/[symbol]/page.tsx`, `components/FairValueCard.tsx` (solo adattamenti minimi per compilare)
- Test: `tests/lib/fair-value.test.ts` (riscritto), `tests/lib/compare.test.ts` (se cita `cashFlowPerShare`)

**Interfaces:**
- Consumes (Task 1): costanti di `@/lib/valuation-config`.
- Produces (da `lib/fair-value.ts`):
  - `interface FairValueInput { price: number; epsTTM: number | null; bookValuePerShare: number | null; epsGrowth5Y: number | null; dividendYield: number | null; priceToFcf: number | null }`
  - `type FairValueKey = 'graham-number' | 'graham-growth' | 'lynch' | 'cash-flow'`
  - `interface FairValueModel { key: FairValueKey; label: string; value: number }`
  - `interface ExcludedModel { key: FairValueKey; label: string; reason: string }`
  - `type FairValuePosition = 'below' | 'inside' | 'above' | 'unclear'`
  - `interface FairValueSummary { low: number; high: number; median: number; spread: number; reliable: boolean; position: FairValuePosition; premiumPct: number | null }`
  - `interface FairValueResult extends FairValueSummary { models: FairValueModel[]; excluded: ExcludedModel[] }`
  - `lynchValue(eps: number, growthPct: number, dividendYieldPct: number): number`
  - `buildFairValueInput(price: number, metrics: { epsTTM: number | null; bookValuePerShare?: number | null; epsGrowth5Y: number | null; dividendYield: number | null; priceToFcf?: number | null }): FairValueInput`
  - `fairValueModels(input: FairValueInput): { models: FairValueModel[]; excluded: ExcludedModel[] }`
  - `summarizeModels(models: FairValueModel[], price: number): FairValueSummary | null`
  - `fairValue(input: FairValueInput): FairValueResult | null`

- [ ] **Step 1: Write the failing test** — sostituire l'intero `tests/lib/fair-value.test.ts` con:

```ts
import { describe, expect, it } from 'vitest'
import { buildFairValueInput, fairValue, fairValueModels, lynchValue, summarizeModels, type FairValueInput, type FairValueModel } from '@/lib/fair-value'

// Free cash flow per share of 6 on a price of 100: priceToFcf = 100 / 6.
const base: FairValueInput = { price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 }

// Four models that agree within a 2x spread. Models: Graham number 106.07, Graham growth 188.22, Lynch 125, cash flow 145.50.
const agreeing = (price: number): FairValueInput => ({ price, epsTTM: 5, bookValuePerShare: 100, epsGrowth5Y: 25, dividendYield: 0, priceToFcf: price / 4.5 })

const m = (key: FairValueModel['key'], value: number): FairValueModel => ({ key, label: key, value })
const keys = (r: { models: FairValueModel[] }) => r.models.map((x) => x.key)
const valueOf = (r: { models: FairValueModel[] }, key: FairValueModel['key']) => r.models.find((x) => x.key === key)?.value
const reasonOf = (r: { excluded: Array<{ key: string; reason: string }> }, key: string) => r.excluded.find((x) => x.key === key)?.reason

describe('lynchValue', () => {
  it('multiplies earnings by a fair P/E equal to growth plus dividend yield', () => {
    expect(lynchValue(5, 10, 1)).toBeCloseTo(55, 6)
  })

  it('floors the fair P/E at 5 and caps it at 25', () => {
    expect(lynchValue(5, 3, 0)).toBeCloseTo(25, 6)
    expect(lynchValue(5, 40, 0)).toBeCloseTo(125, 6)
  })
})

describe('buildFairValueInput', () => {
  it('maps the Finnhub metrics, turning absent optional fields into null', () => {
    expect(buildFairValueInput(100, { epsTTM: 5, epsGrowth5Y: 10, dividendYield: 1 })).toEqual({
      price: 100, epsTTM: 5, bookValuePerShare: null, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: null,
    })
    expect(buildFairValueInput(100, { epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 20 })).toMatchObject({
      bookValuePerShare: 40, priceToFcf: 20,
    })
  })
})

describe('fairValueModels', () => {
  it('computes the four models on complete data', () => {
    const r = fairValueModels(base)
    expect(keys(r)).toEqual(['graham-number', 'graham-growth', 'lynch', 'cash-flow'])
    expect(valueOf(r, 'graham-number')).toBeCloseTo(Math.sqrt(22.5 * 5 * 40), 5) // 67.082
    expect(valueOf(r, 'graham-growth')).toBeCloseTo(139.3333, 3) // 5 * (8.5 + 20) * 4.4 / 4.5
    expect(valueOf(r, 'lynch')).toBeCloseTo(55, 5)
    expect(valueOf(r, 'cash-flow')).toBeCloseTo(166.7754, 3)
    expect(r.excluded).toEqual([])
  })

  it('takes the free cash flow per share as price divided by price-to-FCF', () => {
    const r = fairValueModels({ ...base, priceToFcf: 20 }) // 100 / 20 = 5, not 6
    expect(valueOf(r, 'cash-flow')).toBeCloseTo(138.9795, 3)
  })

  describe('Graham number', () => {
    it('is left out when book value per share is under 10% of the price, with the reason', () => {
      const r = fairValueModels({ ...base, bookValuePerShare: 9 })
      expect(keys(r)).not.toContain('graham-number')
      expect(reasonOf(r, 'graham-number')).toMatch(/pochi attivi/)
    })

    it('is kept at exactly 10% of the price', () => {
      expect(keys(fairValueModels({ ...base, bookValuePerShare: 10 }))).toContain('graham-number')
    })

    it.each([
      ['earnings missing', { epsTTM: null }],
      ['earnings negative', { epsTTM: -1 }],
      ['book value missing', { bookValuePerShare: null }],
      ['book value negative', { bookValuePerShare: -5 }],
    ])('is left out when %s, with the reason', (_name, override) => {
      const r = fairValueModels({ ...base, ...override })
      expect(keys(r)).not.toContain('graham-number')
      expect(reasonOf(r, 'graham-number')).toMatch(/Mancano utile o patrimonio/)
    })
  })

  describe('earnings and growth', () => {
    it('leaves out both earnings models, but not the cash flow, when earnings are negative', () => {
      const r = fairValueModels({ ...base, epsTTM: -1 })
      expect(keys(r)).toEqual(['cash-flow'])
      expect(reasonOf(r, 'graham-growth')).toMatch(/Utile per azione negativo/)
      expect(reasonOf(r, 'lynch')).toMatch(/Utile per azione negativo/)
    })

    it('leaves out every growth-based model when growth is unknown, instead of assuming 0', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: null })
      expect(keys(r)).toEqual(['graham-number'])
      expect(reasonOf(r, 'graham-growth')).toMatch(/Crescita degli utili non disponibile/)
      expect(reasonOf(r, 'lynch')).toMatch(/Crescita degli utili non disponibile/)
      expect(reasonOf(r, 'cash-flow')).toMatch(/Crescita degli utili non disponibile/)
    })

    it('treats negative growth as zero for Graham and the cash flow, and leaves Lynch out', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: -8 })
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(5 * 8.5 * 4.4 / 4.5, 4) // 41.556: no growth at all
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(78.4725, 3) // 6 per share, flat
      expect(keys(r)).not.toContain('lynch')
      expect(reasonOf(r, 'lynch')).toMatch(/non disponibile o non positiva/)
    })

    it('also leaves Lynch out when growth is exactly zero', () => {
      expect(keys(fairValueModels({ ...base, epsGrowth5Y: 0 }))).not.toContain('lynch')
    })

    it('caps growth at 15% for Graham, 12% for the cash flow and a P/E of 25 for Lynch', () => {
      const r = fairValueModels({ ...base, epsGrowth5Y: 40, dividendYield: 0 })
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(188.2222, 3) // growth 15
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(194.0055, 3) // growth 12
      expect(valueOf(r, 'lynch')).toBeCloseTo(125, 5) // P/E 25
    })
  })

  describe('cash flow', () => {
    it.each([null, 0, -4])('is left out, and only it, when price-to-FCF is %s', (ratio) => {
      const r = fairValueModels({ ...base, priceToFcf: ratio })
      expect(keys(r)).toEqual(['graham-number', 'graham-growth', 'lynch'])
      expect(reasonOf(r, 'cash-flow')).toMatch(/Flusso di cassa libero/)
    })

    it('is left out when the price is not positive', () => {
      expect(keys(fairValueModels({ ...base, price: 0 }))).not.toContain('cash-flow')
    })
  })

  describe('values that are not finite numbers', () => {
    it('treats NaN and Infinity as missing data and never produces NaN', () => {
      const r = fairValueModels({ ...base, epsTTM: Number.NaN, epsGrowth5Y: Number.POSITIVE_INFINITY, bookValuePerShare: Number.NaN, priceToFcf: Number.NaN })
      expect(r.models).toEqual([])
      expect(r.excluded).toHaveLength(4)
    })

    it('never lets a model with a non-finite or non-positive value through', () => {
      const r = fairValueModels({ ...base, epsTTM: Number.MAX_VALUE, bookValuePerShare: Number.MAX_VALUE })
      expect(r.models.every((x) => Number.isFinite(x.value) && x.value > 0)).toBe(true)
    })
  })
})

describe('summarizeModels', () => {
  const models = [m('graham-number', 100), m('lynch', 150), m('cash-flow', 200)]

  it('gives the range, the median and the spread', () => {
    const s = summarizeModels(models, 120)!
    expect(s.low).toBe(100)
    expect(s.high).toBe(200)
    expect(s.median).toBe(150)
    expect(s.spread).toBe(2)
  })

  it('takes the mean of the two middle values as median when the count is even', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 120), m('graham-number', 140), m('graham-growth', 160)], 100)!.median).toBe(130)
  })

  it('does not depend on the order of the models', () => {
    expect(summarizeModels([...models].reverse(), 120)).toEqual(summarizeModels(models, 120))
  })

  it('is reliable up to a spread of exactly 2 and not beyond', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 200)], 150)!.reliable).toBe(true)
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 201)], 150)!.reliable).toBe(false)
  })

  it('places the price below, inside and above the range, inclusive of both ends', () => {
    expect(summarizeModels(models, 90)!.position).toBe('below')
    expect(summarizeModels(models, 100)!.position).toBe('inside')
    expect(summarizeModels(models, 150)!.position).toBe('inside')
    expect(summarizeModels(models, 200)!.position).toBe('inside')
    expect(summarizeModels(models, 210)!.position).toBe('above')
  })

  it('measures the premium against the median only when the estimate is reliable', () => {
    expect(summarizeModels(models, 120)!.premiumPct).toBeCloseTo(-20, 6) // (120 - 150) / 150
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 400)], 120)!.premiumPct).toBeNull()
  })

  it('says "unclear" instead of a position when the models disagree', () => {
    expect(summarizeModels([m('lynch', 100), m('cash-flow', 400)], 50)!.position).toBe('unclear')
  })

  it('needs at least two models and a positive price', () => {
    expect(summarizeModels([m('lynch', 100)], 100)).toBeNull()
    expect(summarizeModels([], 100)).toBeNull()
    expect(summarizeModels(models, 0)).toBeNull()
    expect(summarizeModels(models, -5)).toBeNull()
  })
})

describe('fairValue', () => {
  it('combines models, exclusions and the summary', () => {
    const r = fairValue(base)!
    expect(keys(r)).toHaveLength(4)
    expect(r.low).toBeCloseTo(55, 5)
    expect(r.high).toBeCloseTo(166.7754, 3)
    expect(r.median).toBeCloseTo(103.2077, 3) // (67.082 + 139.333) / 2
    expect(r.reliable).toBe(false) // 166.78 / 55 = 3.03
    expect(r.position).toBe('unclear')
  })

  it('gives a reliable range and a position when the models agree', () => {
    const inside = fairValue(agreeing(150))!
    expect(inside.low).toBeCloseTo(106.066, 2)
    expect(inside.high).toBeCloseTo(188.2222, 3)
    expect(inside.median).toBeCloseTo(135.252, 2)
    expect(inside.reliable).toBe(true)
    expect(inside.position).toBe('inside')
    expect(inside.premiumPct).toBeCloseTo(((150 - 135.252) / 135.252) * 100, 3)
    expect(fairValue(agreeing(90))!.position).toBe('below')
    expect(fairValue(agreeing(250))!.position).toBe('above')
  })

  it('returns null with fewer than two models', () => {
    expect(fairValue({ price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: 10, dividendYield: null, priceToFcf: 20 })).toBeNull()
    expect(fairValue({ price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: null, dividendYield: null, priceToFcf: null })).toBeNull()
  })

  it('returns null for a price that is not positive', () => {
    expect(fairValue({ ...base, price: 0 })).toBeNull()
  })

  describe('with the real Finnhub data of 17 November 2026 (prices rounded)', () => {
    it('AAPL: Graham number is left out and the remaining models disagree', () => {
      const r = fairValue({ price: 350, epsTTM: 8.9745, bookValuePerShare: 7.7134, epsGrowth5Y: 9.85, dividendYield: 0.3036, priceToFcf: 38.0533 })!
      expect(keys(r)).toEqual(['graham-growth', 'lynch', 'cash-flow'])
      expect(reasonOf(r, 'graham-number')).toMatch(/pochi attivi/)
      expect(valueOf(r, 'graham-growth')).toBeCloseTo(247.46, 1)
      expect(valueOf(r, 'lynch')).toBeCloseTo(91.12, 1)
      expect(valueOf(r, 'cash-flow')).toBeCloseTo(252.77, 1)
      expect(r.reliable).toBe(false)
      expect(r.position).toBe('unclear')
    })

    it('MCD: Graham number is left out and the models still disagree (spread 2.14)', () => {
      const r = fairValue({ price: 270, epsTTM: 12.6401, bookValuePerShare: 7.8164, epsGrowth5Y: 13.64, dividendYield: 2.722, priceToFcf: 24.7329 })!
      expect(keys(r)).toEqual(['graham-growth', 'lynch', 'cash-flow'])
      expect(r.low).toBeCloseTo(206.82, 1)
      expect(r.high).toBeCloseTo(442.21, 1)
      expect(r.reliable).toBe(false)
    })

    it('JPM: all four models apply and they are far apart', () => {
      const r = fairValue({ price: 300, epsTTM: 24.373, bookValuePerShare: 134.4218, epsGrowth5Y: 16.8, dividendYield: 1.8986, priceToFcf: 6.0133 })!
      expect(keys(r)).toHaveLength(4)
      expect(r.low).toBeCloseTo(271.51, 1)
      expect(r.high).toBeCloseTo(1613.14, 0)
      expect(r.reliable).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/fair-value.test.ts`
Expected: FAIL (funzioni e tipi nuovi non esistono).

- [ ] **Step 3: Write the implementation** — sostituire l'intero `lib/fair-value.ts` con:

```ts
import {
  AAA_YIELD,
  DCF_GROWTH_MAX,
  DISCOUNT_RATE,
  GRAHAM_GROWTH_MAX,
  LYNCH_PE_MAX,
  LYNCH_PE_MIN,
  MIN_BOOK_TO_PRICE,
  RELIABLE_MAX_SPREAD,
  TERMINAL_GROWTH,
} from '@/lib/valuation-config'

export interface FairValueInput {
  price: number
  epsTTM: number | null
  bookValuePerShare: number | null
  epsGrowth5Y: number | null
  dividendYield: number | null
  priceToFcf: number | null
}

export type FairValueKey = 'graham-number' | 'graham-growth' | 'lynch' | 'cash-flow'

export interface FairValueModel {
  key: FairValueKey
  label: string
  value: number
}

export interface ExcludedModel {
  key: FairValueKey
  label: string
  reason: string
}

export type FairValuePosition = 'below' | 'inside' | 'above' | 'unclear'

export interface FairValueSummary {
  low: number
  high: number
  median: number
  spread: number
  reliable: boolean
  position: FairValuePosition
  premiumPct: number | null
}

export interface FairValueResult extends FairValueSummary {
  models: FairValueModel[]
  excluded: ExcludedModel[]
}

const LABELS: Record<FairValueKey, string> = {
  'graham-number': 'Numero di Graham',
  'graham-growth': 'Graham con crescita',
  lynch: 'Peter Lynch',
  'cash-flow': 'Flussi di cassa scontati',
}

const NO_EPS = 'Utile per azione negativo o assente.'
const NO_GROWTH = 'Crescita degli utili non disponibile.'
const INVALID = 'Il calcolo non ha dato un valore valido.'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

// P/E equal to growth plus dividend yield (both in %), kept between sensible bounds. The only Lynch formula of the app.
export function lynchValue(eps: number, growthPct: number, dividendYieldPct: number): number {
  return eps * clamp(growthPct + dividendYieldPct, LYNCH_PE_MIN, LYNCH_PE_MAX)
}

// Ten years of free cash flow per share growing at `growthPct`, plus a terminal value, all discounted.
function cashFlowValue(fcfPerShare: number, growthPct: number): number {
  const g = clamp(growthPct, 0, DCF_GROWTH_MAX) / 100
  let value = 0
  let cf = fcfPerShare
  for (let year = 1; year <= 10; year++) {
    cf *= 1 + g
    value += cf / (1 + DISCOUNT_RATE) ** year
  }
  const terminal = (cf * (1 + TERMINAL_GROWTH)) / (DISCOUNT_RATE - TERMINAL_GROWTH)
  return value + terminal / (1 + DISCOUNT_RATE) ** 10
}

export function buildFairValueInput(
  price: number,
  metrics: { epsTTM: number | null; bookValuePerShare?: number | null; epsGrowth5Y: number | null; dividendYield: number | null; priceToFcf?: number | null },
): FairValueInput {
  return {
    price,
    epsTTM: metrics.epsTTM,
    bookValuePerShare: metrics.bookValuePerShare ?? null,
    epsGrowth5Y: metrics.epsGrowth5Y,
    dividendYield: metrics.dividendYield,
    priceToFcf: metrics.priceToFcf ?? null,
  }
}

// Every model is applied only when its data make sense; a model left out says why.
export function fairValueModels(input: FairValueInput): { models: FairValueModel[]; excluded: ExcludedModel[] } {
  const { price, bookValuePerShare, epsGrowth5Y, dividendYield, priceToFcf } = input
  const eps = isNum(input.epsTTM) && input.epsTTM > 0 ? input.epsTTM : null
  const growth = isNum(epsGrowth5Y) ? epsGrowth5Y : null
  const dividend = isNum(dividendYield) ? dividendYield : 0
  const fcf = isNum(priceToFcf) && priceToFcf > 0 && isNum(price) && price > 0 ? price / priceToFcf : null

  const models: FairValueModel[] = []
  const excluded: ExcludedModel[] = []
  const exclude = (key: FairValueKey, reason: string) => excluded.push({ key, label: LABELS[key], reason })
  const accept = (key: FairValueKey, value: number) => {
    if (Number.isFinite(value) && value > 0) models.push({ key, label: LABELS[key], value })
    else exclude(key, INVALID)
  }

  if (eps === null || !isNum(bookValuePerShare) || bookValuePerShare <= 0) {
    exclude('graham-number', 'Mancano utile o patrimonio per azione positivi.')
  } else if (bookValuePerShare < MIN_BOOK_TO_PRICE * price) {
    exclude('graham-number', 'Patrimonio per azione troppo piccolo rispetto al prezzo: il metodo non vale per aziende con pochi attivi.')
  } else {
    accept('graham-number', Math.sqrt(22.5 * eps * bookValuePerShare))
  }

  if (eps === null) exclude('graham-growth', NO_EPS)
  else if (growth === null) exclude('graham-growth', NO_GROWTH)
  else accept('graham-growth', (eps * (8.5 + 2 * clamp(growth, 0, GRAHAM_GROWTH_MAX)) * 4.4) / AAA_YIELD)

  if (eps === null) exclude('lynch', NO_EPS)
  else if (growth === null || growth <= 0) exclude('lynch', 'Crescita degli utili non disponibile o non positiva.')
  else accept('lynch', lynchValue(eps, growth, dividend))

  if (fcf === null) exclude('cash-flow', 'Flusso di cassa libero non disponibile o negativo.')
  else if (growth === null) exclude('cash-flow', NO_GROWTH)
  else accept('cash-flow', cashFlowValue(fcf, growth))

  return { models, excluded }
}

// Range, median and a verdict on whether the models agree. Needs at least two models.
export function summarizeModels(models: FairValueModel[], price: number): FairValueSummary | null {
  if (models.length < 2 || !(price > 0)) return null
  const values = models.map((model) => model.value).sort((a, b) => a - b)
  const low = values[0]
  const high = values[values.length - 1]
  const middle = values.length >> 1
  const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  const spread = high / low
  const reliable = spread <= RELIABLE_MAX_SPREAD
  const position: FairValuePosition = !reliable ? 'unclear' : price < low ? 'below' : price > high ? 'above' : 'inside'
  return { low, high, median, spread, reliable, position, premiumPct: reliable ? ((price - median) / median) * 100 : null }
}

export function fairValue(input: FairValueInput): FairValueResult | null {
  const { models, excluded } = fairValueModels(input)
  const summary = summarizeModels(models, input.price)
  return summary ? { ...summary, models, excluded } : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/fair-value.test.ts`
Expected: PASS. Se un valore di riferimento (AAPL, MCD, JPM) non torna di pochi centesimi, ricalcolare con la formula del test prima di modificare i valori attesi.

- [ ] **Step 5: Adapt the consumers so the project compiles** — applicare con Python:

```python
import re

# 1) lib/compare.ts: the input is built in one place now
p = 'lib/compare.ts'
s = open(p).read()
start = s.index("  const fairValueInput =\n    latest && metrics\n")
end = s.index("      : null\n", start) + len("      : null\n")
s = s[:start] + "  const fairValueInput = latest && metrics ? buildFairValueInput(latest.price, metrics) : null\n" + s[end:]
old = """  fairValueInput: {
    price: number
    epsTTM: number | null
    bookValuePerShare: number | null
    cashFlowPerShare: number | null
    epsGrowth5Y: number | null
    dividendYield: number | null
  } | null
"""
assert old in s
s = s.replace(old, "  fairValueInput: FairValueInput | null\n", 1)
s = s.replace("import { getMetrics } from './finnhub'\n", "import { getMetrics } from './finnhub'\nimport { buildFairValueInput, type FairValueInput } from './fair-value'\n", 1)
open(p, 'w').write(s)

# 2) stock page: two inline inputs become buildFairValueInput(...)
p = 'app/stock/[symbol]/page.tsx'
s = open(p).read()
pattern = re.compile(r"input=\{\{ price(: latest\.price)?, epsTTM: metrics\.epsTTM, [^\n]*?dividendYield: metrics\.dividendYield \}\}")
s, n = pattern.subn(lambda m: "input={buildFairValueInput(%s, metrics)}" % ("latest.price" if m.group(1) else "price"), s)
assert n == 2, n
s = s.replace("import { FairValueCard } from '@/components/FairValueCard'\n", "import { FairValueCard } from '@/components/FairValueCard'\nimport { buildFairValueInput } from '@/lib/fair-value'\n", 1)
open(p, 'w').write(s)

# 3) FairValueCard: the minimum needed to compile until Task 4 rewrites it
p = 'components/FairValueCard.tsx'
s = open(p).read()
assert "result.average" in s
s = s.replace("result.average.toFixed(2)", "result.median.toFixed(2)")
old = "const tone: Tone | null = result ? (Math.abs(result.premiumPct) < 5 ? 'flat' : result.premiumPct >= 0 ? 'loss' : 'gain') : null"
assert old in s
s = s.replace(old, "const tone: Tone | null = result ? (result.premiumPct === null || Math.abs(result.premiumPct) < 5 ? 'flat' : result.premiumPct >= 0 ? 'loss' : 'gain') : null", 1)
s = s.replace("Math.abs(result.premiumPct).toFixed(2)", "Math.abs(result.premiumPct ?? 0).toFixed(2)").replace("result.premiumPct >= 0 ? 'sopra' : 'sotto'", "(result.premiumPct ?? 0) >= 0 ? 'sopra' : 'sotto'")
open(p, 'w').write(s)
```

Poi cercare altri riferimenti a `cashFlowPerShare` nei test di confronto e adattarli:

Run: `grep -rn "cashFlowPerShare" tests app components lib | grep -v "lib/finnhub.ts"`
Expected: nessun riferimento a `fairValueInput.cashFlowPerShare`; se `tests/lib/compare.test.ts` ne cita uno, sostituirlo con `priceToFcf` o toglierlo.

- [ ] **Step 6: Verify the whole project still compiles and passes**

Run: `npx tsc --noEmit && npx vitest run tests/lib/fair-value.test.ts tests/lib/compare.test.ts tests/lib/finnhub.test.ts`
Expected: PASS. Se `tsc` segnala `result.average` o `premiumPct` in `FairValueCard`, completare l'adattamento minimo del Step 5 (la scheda definitiva arriva nel Task 4).

- [ ] **Step 7: Commit**

```bash
git add lib/fair-value.ts lib/compare.ts "app/stock/[symbol]/page.tsx" components/FairValueCard.tsx tests/lib/fair-value.test.ts tests/lib/compare.test.ts
git commit -m "feat: compute fair value as a range with a reliability check"
```

---

### Task 3: Il verdetto vota sulla posizione nell'intervallo

**Files:**
- Modify: `lib/evaluate.ts`, `components/EvaluationPanel.tsx`, `lib/verdict-note.ts`, `lib/compare.ts`, `app/stock/[symbol]/page.tsx`
- Test: `tests/lib/evaluate.test.ts`, `tests/components/EvaluationPanel.test.tsx`, `tests/lib/verdict-note.test.ts`, `tests/lib/compare.test.ts`

**Interfaces:**
- Consumes (Task 2): `FairValueResult`, `FairValuePosition`, `fairValue`, `buildFairValueInput` da `@/lib/fair-value`.
- Produces:
  - `Evaluation.fairValue: { position: FairValuePosition | null; reliable: boolean; low: number | null; high: number | null; median: number | null; note: string }` al posto di `Evaluation.targetPrice`.
  - `EvaluateInput.fairValue: FairValueResult | null` (obbligatorio).
  - `overallTone(tones: Tone[], position: FairValuePosition | null, newsAdjustment?: number): Tone` esportata da `components/EvaluationPanel.tsx`.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/evaluate.test.ts`:
- aggiungere agli import `import { fairValue } from '@/lib/fair-value'`;
- in `baseInput` aggiungere `fairValue: null,` come proprietà di primo livello (accanto a `earliestSnapshot: null,`);
- sostituire l'intero blocco `describe('evaluateStock — targetPrice', ...)` (fino al `describe` successivo o a fine file) con:

```ts
describe('evaluateStock — fairValue', () => {
  const agreeing = (price: number) => fairValue({ price, epsTTM: 5, bookValuePerShare: 100, epsGrowth5Y: 25, dividendYield: 0, priceToFcf: price / 4.5 })

  it('is not available when the fair value could not be computed, and says so', () => {
    const result = evaluateStock(baseInput())
    expect(result.fairValue).toEqual({ position: null, reliable: false, low: null, high: null, median: null, note: expect.stringMatching(/non disponibile/i) })
  })

  it('reports a price inside a reliable range', () => {
    const input = baseInput({ price: 150 })
    input.fairValue = agreeing(150)
    const { fairValue: fv } = evaluateStock(input)
    expect(fv.position).toBe('inside')
    expect(fv.reliable).toBe(true)
    expect(fv.low).toBeCloseTo(106.066, 2)
    expect(fv.high).toBeCloseTo(188.222, 2)
    expect(fv.median).toBeCloseTo(135.252, 2)
    expect(fv.note).toMatch(/dentro l.intervallo/)
    expect(fv.note).toContain('106.07')
    expect(fv.note).toContain('188.22')
  })

  it('reports a price below or above a reliable range', () => {
    const below = baseInput({ price: 90 })
    below.fairValue = agreeing(90)
    expect(evaluateStock(below).fairValue).toMatchObject({ position: 'below', note: expect.stringMatching(/sotto l.intervallo/) })
    const above = baseInput({ price: 250 })
    above.fairValue = agreeing(250)
    expect(evaluateStock(above).fairValue).toMatchObject({ position: 'above', note: expect.stringMatching(/sopra l.intervallo/) })
  })

  it('does not give a position, and says it does not weigh in, when the models disagree', () => {
    const input = baseInput()
    input.fairValue = fairValue({ price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 })
    const { fairValue: fv } = evaluateStock(input)
    expect(fv.position).toBe('unclear')
    expect(fv.reliable).toBe(false)
    expect(fv.note).toMatch(/modelli discordano/)
    expect(fv.note).toContain('55.00')
    expect(fv.note).toMatch(/non pesa nel giudizio/)
  })

  it('no longer produces a Lynch target price', () => {
    expect(evaluateStock(baseInput({ epsTTM: 5, epsGrowth5Y: 12 }))).not.toHaveProperty('targetPrice')
  })
})
```

In `tests/components/EvaluationPanel.test.tsx`:
- sostituire nella `fullEvaluation()` la riga `targetPrice: { value: 60, upsidePct: -40, note: ... },` con:
  `fairValue: { position: 'above', reliable: true, low: 40, high: 50, median: 45, note: "Il prezzo è sopra l'intervallo di valore equo (40.00–50.00)." },`
- sostituire nella `emptyEvaluation()` la riga `targetPrice: { value: null, upsidePct: null, note: ... },` con:
  `fairValue: { position: null, reliable: false, low: null, high: null, median: null, note: 'Valore equo non disponibile: servono almeno due modelli con dati adatti.' },`
- aggiungere all'import `import { EvaluationPanel, overallTone } from '@/components/EvaluationPanel'` e in fondo al file:

```tsx
describe('overallTone', () => {
  const tones = (...t: string[]) => t as Parameters<typeof overallTone>[0]

  it('adds one point when the price is below a reliable fair value range', () => {
    expect(overallTone(tones('neutral', 'unknown', 'neutral'), 'below')).toBe('neutral') // 0 + 1 = 1
    expect(overallTone(tones('positive', 'unknown', 'neutral'), 'below')).toBe('positive') // 1 + 1 = 2
  })

  it('takes one point away when the price is above it', () => {
    expect(overallTone(tones('positive', 'unknown', 'positive'), 'above')).toBe('neutral')
    expect(overallTone(tones('negative', 'negative', 'unknown'), 'above')).toBe('negative')
  })

  it('does not move the verdict inside the range, when it is unclear, or when it is missing', () => {
    for (const position of ['inside', 'unclear', null] as const) {
      expect(overallTone(tones('positive', 'unknown', 'positive'), position)).toBe('positive')
      expect(overallTone(tones('neutral', 'neutral', 'neutral'), position)).toBe('neutral')
    }
  })

  it('still adds the news adjustment', () => {
    expect(overallTone(tones('positive', 'neutral', 'neutral'), 'unclear', 1)).toBe('positive')
  })

  it('is unknown when no signal is known, whatever the fair value says', () => {
    expect(overallTone(tones('unknown', 'unknown', 'unknown'), 'below')).toBe('unknown')
  })
})
```


- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/evaluate.test.ts tests/components/EvaluationPanel.test.tsx tests/lib/verdict-note.test.ts tests/lib/compare.test.ts`
Expected: FAIL (`fairValue` non esiste in `Evaluation`; `overallTone` non esportata).

- [ ] **Step 3: Implement** — applicare con Python:

```python
# lib/evaluate.ts
p = 'lib/evaluate.ts'
s = open(p).read()

s = s.replace("  targetPrice: { value: number | null; upsidePct: number | null; note: string }\n",
"  fairValue: {\n    position: FairValuePosition | null\n    reliable: boolean\n    low: number | null\n    high: number | null\n    median: number | null\n    note: string\n  }\n", 1)
s = "import type { FairValuePosition, FairValueResult } from '@/lib/fair-value'\n\n" + s

old = "  earliestSnapshot: { price: number; timestamp: Date } | null\n  recentRecommendations: Array<{"
assert old in s
s = s.replace(old, "  earliestSnapshot: { price: number; timestamp: Date } | null\n  // Computed by the caller, so the page and the verdict show the same fair value.\n  fairValue: FairValueResult | null\n  recentRecommendations: Array<{", 1)

start = s.index("function evaluateTargetPrice(")
end = s.index("// Contano solo notizie recenti", start)
new_fn = '''const money = (v: number) => v.toFixed(2)

function evaluateFairValue(input: EvaluateInput): Evaluation['fairValue'] {
  const fv = input.fairValue
  if (!fv) {
    return { position: null, reliable: false, low: null, high: null, median: null, note: 'Valore equo non disponibile: servono almeno due modelli con dati adatti.' }
  }
  const range = `${money(fv.low)}–${money(fv.high)}`
  const note = !fv.reliable
    ? `I modelli discordano (da ${money(fv.low)} a ${money(fv.high)}): stima poco affidabile, non pesa nel giudizio.`
    : fv.position === 'below'
      ? `Il prezzo è sotto l'intervallo di valore equo (${range}).`
      : fv.position === 'above'
        ? `Il prezzo è sopra l'intervallo di valore equo (${range}).`
        : `Il prezzo è dentro l'intervallo di valore equo (${range}).`
  return { position: fv.position, reliable: fv.reliable, low: fv.low, high: fv.high, median: fv.median, note }
}

'''
s = s[:start] + new_fn + s[end:]
assert "    targetPrice: evaluateTargetPrice(input),\n" in s
s = s.replace("    targetPrice: evaluateTargetPrice(input),\n", "    fairValue: evaluateFairValue(input),\n", 1)
open(p, 'w').write(s)

# components/EvaluationPanel.tsx
p = 'components/EvaluationPanel.tsx'
s = open(p).read()
s = s.replace("import type { Evaluation } from '@/lib/evaluate'\n", "import type { Evaluation } from '@/lib/evaluate'\nimport type { FairValuePosition } from '@/lib/fair-value'\n", 1)
old = "function overallTone(tones: Tone[], upsidePct: number | null, newsAdjustment = 0): Tone {"
assert old in s
s = s.replace(old, "export function overallTone(tones: Tone[], position: FairValuePosition | null, newsAdjustment = 0): Tone {", 1)
old = "  if (upsidePct !== null) score += upsidePct >= 15 ? 1 : upsidePct <= -15 ? -1 : 0\n"
assert old in s
s = s.replace(old, "  // Only a reliable range moves the verdict: \"unclear\" and a missing fair value count for nothing.\n  if (position === 'below') score += 1\n  else if (position === 'above') score -= 1\n", 1)
s = s.replace("const { shortTerm, mediumTerm, longTerm, targetPrice } = evaluation", "const { shortTerm, mediumTerm, longTerm, fairValue } = evaluation", 1)
s = s.replace("overallTone(tones, targetPrice.upsidePct, evaluation.newsImpact.adjustment)", "overallTone(tones, fairValue.position, evaluation.newsImpact.adjustment)", 1)
open(p, 'w').write(s)

# lib/verdict-note.ts
p = 'lib/verdict-note.ts'
s = open(p).read()
assert "const PROMPT_VERSION = 1" in s
s = s.replace("const PROMPT_VERSION = 1", "const PROMPT_VERSION = 2", 1)
s = s.replace("prezzo obiettivo, impatto delle notizie", "valore equo, impatto delle notizie", 1)
s = s.replace("`Prezzo obiettivo: ${e.targetPrice.note}`", "`Valore equo: ${e.fairValue.note}`", 1)
s = s.replace("e.targetPrice.note, e.newsImpact.note", "e.fairValue.note, e.newsImpact.note", 1)
open(p, 'w').write(s)

# lib/compare.ts: build the fair value before the evaluation and pass it in
p = 'lib/compare.ts'
s = open(p).read()
line = "  const fairValueInput = latest && metrics ? buildFairValueInput(latest.price, metrics) : null\n"
assert line in s
s = s.replace(line, "", 1)
s = s.replace("  const evaluation = latest\n    ? evaluateStock({\n", line + "\n  const evaluation = latest\n    ? evaluateStock({\n        fairValue: fairValueInput ? fairValue(fairValueInput) : null,\n", 1)
s = s.replace("import { buildFairValueInput, type FairValueInput } from './fair-value'", "import { buildFairValueInput, fairValue, type FairValueInput } from './fair-value'", 1)
open(p, 'w').write(s)

# app/stock/[symbol]/page.tsx
p = 'app/stock/[symbol]/page.tsx'
s = open(p).read()
old = "  const evaluation = latest\n    ? evaluateStock({\n"
assert old in s
s = s.replace(old, old + "        fairValue: metrics ? fairValue(buildFairValueInput(latest.price, metrics)) : null,\n", 1)
s = s.replace("import { buildFairValueInput } from '@/lib/fair-value'", "import { buildFairValueInput, fairValue } from '@/lib/fair-value'", 1)
open(p, 'w').write(s)
```

Se dopo la sostituzione `clamp` in `lib/evaluate.ts` risulta inutilizzata, rimuovere la funzione (lo segnalano `tsc`/lint).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/evaluate.test.ts tests/components/EvaluationPanel.test.tsx tests/lib/verdict-note.test.ts tests/lib/compare.test.ts && npx tsc --noEmit && npm run lint 2>&1 | grep -E "evaluate|EvaluationPanel|verdict-note|compare|stock/\[symbol\]"`
Expected: PASS, nessun errore di tipi, nessuna riga di lint sui file toccati. Se `tsc` segnala altri punti che usano `targetPrice` o costruiscono un `EvaluateInput` senza `fairValue`, correggerli: l'unico altro chiamante atteso è `tests/lib/evaluate.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/evaluate.ts components/EvaluationPanel.tsx lib/verdict-note.ts lib/compare.ts "app/stock/[symbol]/page.tsx" tests/lib/evaluate.test.ts tests/components/EvaluationPanel.test.tsx tests/lib/verdict-note.test.ts tests/lib/compare.test.ts
git commit -m "feat: let the verdict vote on the fair value range instead of a Lynch target"
```

---

### Task 4: Scheda del valore equo con scala e dettaglio

**Files:**
- Create: `components/FairValueScale.tsx`, `components/FairValueScale.module.css`
- Modify: `components/FairValueCard.tsx` (riscrittura della funzione `FairValueCard`), `components/FairValueCard.module.css`
- Test: `tests/components/FairValueScale.test.tsx`, `tests/components/FairValueCard.test.tsx` (nuovi)
- Modify: `auditcalc.md` (spuntare i task 8 e 9)

**Interfaces:**
- Consumes (Task 2): `fairValue`, `FairValueInput`, `FairValueResult`, `FairValueModel` da `@/lib/fair-value`; costanti `AAA_YIELD`, `DISCOUNT_RATE`, `VALUATION_TUNED_ON` da `@/lib/valuation-config`.
- Produces:
  - `FairValueScale({ models, low, high, price, reliable }: { models: Array<{ key: string; label: string; value: number }>; low: number; high: number; price: number; reliable: boolean })`
  - `FairValueCard({ input, altman?, embedded? })` con la stessa firma di prima.

- [ ] **Step 1: Write the failing tests**

`tests/components/FairValueScale.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FairValueScale } from '@/components/FairValueScale'

const models = [
  { key: 'graham-number', label: 'Numero di Graham', value: 106.07 },
  { key: 'lynch', label: 'Peter Lynch', value: 125 },
  { key: 'graham-growth', label: 'Graham con crescita', value: 188.22 },
]

describe('FairValueScale', () => {
  it('describes every model and the price in words, for screen readers', () => {
    render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    const label = screen.getByRole('img').getAttribute('aria-label')!
    for (const m of models) expect(label).toContain(m.label)
    expect(label).toContain('106.07')
    expect(label).toContain('Prezzo 150.00')
  })

  it('draws one point per model, one price marker and one band', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    expect(container.querySelectorAll('[data-role="model"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-role="price"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-role="band"]')).toHaveLength(1)
  })

  it('marks the band as reliable or not', () => {
    const { container, rerender } = render(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable />)
    expect(container.querySelector('[data-role="band"]')).toHaveAttribute('data-reliable', 'true')
    rerender(<FairValueScale models={models} low={106.07} high={188.22} price={150} reliable={false} />)
    expect(container.querySelector('[data-role="band"]')).toHaveAttribute('data-reliable', 'false')
  })

  it('keeps every point inside the track, even for a price far from the models', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={900} reliable={false} />)
    const lefts = [...container.querySelectorAll<HTMLElement>('[data-role="model"], [data-role="price"]')].map((el) => parseFloat(el.style.left))
    expect(lefts.every((l) => l >= 0 && l <= 100)).toBe(true)
  })

  it('puts the price marker to the left of the models when the price is lower', () => {
    const { container } = render(<FairValueScale models={models} low={106.07} high={188.22} price={60} reliable />)
    const price = parseFloat(container.querySelector<HTMLElement>('[data-role="price"]')!.style.left)
    const first = Math.min(...[...container.querySelectorAll<HTMLElement>('[data-role="model"]')].map((el) => parseFloat(el.style.left)))
    expect(price).toBeLessThan(first)
  })
})
```

`tests/components/FairValueCard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FairValueCard } from '@/components/FairValueCard'
import type { FairValueInput } from '@/lib/fair-value'
import type { AltmanResult } from '@/lib/solidity'

// Models agree: Graham number 106.07, Lynch 125, cash flow 145.50, Graham with growth 188.22.
const agreeing = (price: number): FairValueInput => ({ price, epsTTM: 5, bookValuePerShare: 100, epsGrowth5Y: 25, dividendYield: 0, priceToFcf: price / 4.5 })
// Models disagree: 55.00 to 166.78.
const disagreeing: FairValueInput = { price: 100, epsTTM: 5, bookValuePerShare: 40, epsGrowth5Y: 10, dividendYield: 1, priceToFcf: 100 / 6 }
// Real AAPL data: Graham number is left out.
const aapl: FairValueInput = { price: 350, epsTTM: 8.9745, bookValuePerShare: 7.7134, epsGrowth5Y: 9.85, dividendYield: 0.3036, priceToFcf: 38.0533 }
const tooLittle: FairValueInput = { price: 100, epsTTM: null, bookValuePerShare: null, epsGrowth5Y: null, dividendYield: null, priceToFcf: null }
const altman = { score: 3.2, zone: 'safe' } as AltmanResult

describe('FairValueCard', () => {
  it('shows the range and its centre', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByText('106.07–188.22')).toBeInTheDocument()
    expect(screen.getByText(/centro 135\.25/i)).toBeInTheDocument()
  })

  it('says how far the price is from the centre when the estimate is reliable', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByText(/10\.9\d% sopra/)).toBeInTheDocument()
    expect(screen.queryByText(/stima poco affidabile/i)).not.toBeInTheDocument()
  })

  it('says the price is close to the centre when it is within 5%', () => {
    render(<FairValueCard input={agreeing(137)} />)
    expect(screen.getByText(/vicino al centro/i)).toBeInTheDocument()
  })

  it('says the estimate is unreliable, and gives no above or below judgement, when the models disagree', () => {
    render(<FairValueCard input={disagreeing} />)
    expect(screen.getByText(/stima poco affidabile/i)).toBeInTheDocument()
    expect(screen.getByText('55.00–166.78')).toBeInTheDocument()
    expect(screen.queryByText(/% sopra/)).not.toBeInTheDocument()
    expect(screen.queryByText(/% sotto/)).not.toBeInTheDocument()
  })

  it('draws the scale', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByRole('img', { name: /Prezzo 150\.00/ })).toBeInTheDocument()
  })

  it('lists the models in the details, and the ones left out with the reason', () => {
    render(<FairValueCard input={aapl} />)
    const details = screen.getByText(/come si arriva a questa stima/i).closest('details')!
    expect(within(details).getByText('Peter Lynch')).toBeInTheDocument()
    expect(within(details).getByText('Numero di Graham')).toBeInTheDocument()
    expect(within(details).getByText(/pochi attivi/)).toBeInTheDocument()
  })

  it('states the date the parameters were tuned and the main ones', () => {
    render(<FairValueCard input={agreeing(150)} />)
    expect(screen.getByText(/parametri tarati il \d{4}-\d{2}-\d{2}/i)).toBeInTheDocument()
    expect(screen.getByText(/sconto 9%/)).toBeInTheDocument()
  })

  it('renders nothing when there are fewer than two models and no Altman score', () => {
    const { container } = render(<FairValueCard input={tooLittle} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still renders the Altman block, without the fair value tile, when only that is available', () => {
    render(<FairValueCard input={tooLittle} altman={altman} />)
    expect(screen.getByText('Altman Z-Score')).toBeInTheDocument()
    expect(screen.queryByText(/centro/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/FairValueScale.test.tsx tests/components/FairValueCard.test.tsx`
Expected: FAIL (`FairValueScale` non esiste; la scheda attuale non mostra l'intervallo).

- [ ] **Step 3: Write the scale component**

`components/FairValueScale.tsx`:

```tsx
import styles from './FairValueScale.module.css'

interface ScaleModel {
  key: string
  label: string
  value: number
}

const money = (v: number) => v.toFixed(2)

// A horizontal axis with one point per model, a band for the range and a marker for the price.
export function FairValueScale({ models, low, high, price, reliable }: { models: ScaleModel[]; low: number; high: number; price: number; reliable: boolean }) {
  const values = [...models.map((m) => m.value), price]
  const min = Math.min(...values) * 0.9
  const max = Math.max(...values) * 1.1
  const place = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
  const label = `Modelli: ${models.map((m) => `${m.label} ${money(m.value)}`).join(', ')}. Prezzo ${money(price)}.`

  return (
    <div className={styles.scale} role="img" aria-label={label}>
      <span className={styles.track} />
      <span data-role="band" data-reliable={reliable ? 'true' : 'false'} className={styles.band} style={{ left: `${place(low)}%`, width: `${place(high) - place(low)}%` }} />
      {models.map((m) => (
        <span key={m.key} data-role="model" className={styles.model} style={{ left: `${place(m.value)}%` }} title={`${m.label}: ${money(m.value)}`} />
      ))}
      <span data-role="price" className={styles.price} style={{ left: `${place(price)}%` }} />
    </div>
  )
}
```

`components/FairValueScale.module.css`:

```css
.scale {
  position: relative;
  height: 28px;
  margin: 14px 0 6px;
}

.track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  border-radius: 1px;
  background: var(--rule);
}

.band {
  position: absolute;
  top: 50%;
  height: 12px;
  margin-top: -6px;
  border-radius: 3px;
  background: var(--rule);
}

.band[data-reliable='true'] {
  background: color-mix(in srgb, var(--gain-bright) 24%, transparent);
}

.model {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: var(--muted);
}

.price {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--bone);
}
```

- [ ] **Step 4: Rewrite the card** — in `components/FairValueCard.tsx` sostituire tutto da `export function FairValueCard(` fino a fine file e aggiornare gli import, con Python:

```python
p = 'components/FairValueCard.tsx'
s = open(p).read()

s = s.replace("import { fairValue, type FairValueInput } from '@/lib/fair-value'\n",
"import { fairValue, type FairValueInput } from '@/lib/fair-value'\nimport { AAA_YIELD, DISCOUNT_RATE, VALUATION_TUNED_ON } from '@/lib/valuation-config'\nimport { FairValueScale } from './FairValueScale'\n", 1)

start = s.index("export function FairValueCard(")
new_card = '''const money = (v: number) => v.toFixed(2)

export function FairValueCard({ input, altman = null, embedded = false }: { input: FairValueInput; altman?: AltmanResult | null; embedded?: boolean }) {
  const result = fairValue(input)
  if (!result && !altman) return null
  const tone: Tone | null = result ? (!result.reliable || result.premiumPct === null || Math.abs(result.premiumPct) < 5 ? 'flat' : result.premiumPct >= 0 ? 'loss' : 'gain') : null

  return (
    <section className={`${styles.card} ${embedded ? styles.embedded : ''}`} aria-label="Valore equo e solidità">
      <div className={styles.grid}>
        {result && tone && (
          <div className={styles.metric}>
            <Tile
              label="Valore equo"
              value={`${money(result.low)}–${money(result.high)}`}
              tone={tone}
              tip={
                <InfoTip
                  label="Come è calcolato il valore equo"
                  source="Finnhub (utile per azione, patrimonio per azione, flusso di cassa libero, crescita degli utili a 5 anni)"
                  formula="Graham: √(22,5 × utile × patrimonio) · utile × (8,5 + 2 × crescita) × 4,4 ÷ rendimento AAA · Lynch: utile × (crescita + dividendo) · flussi di cassa liberi scontati a 10 anni"
                >
                  <strong>Valore equo</strong>
                  <span>È un intervallo: il valore più basso e quello più alto che danno i metodi classici, applicati solo quando i dati sono adatti.</span>
                  <span>Se i metodi danno risultati molto diversi (il più alto è più del doppio del più basso) la stima è poco affidabile e l’app non dice se il prezzo è alto o basso.</span>
                </InfoTip>
              }
            />
            <p className={styles.caption}>
              {result.reliable && result.premiumPct !== null ? (
                tone === 'flat' ? (
                  <>
                    Il prezzo attuale {input.price.toFixed(2)} è <strong>vicino al centro</strong> ({money(result.median)}).
                  </>
                ) : (
                  <>
                    Il prezzo attuale {input.price.toFixed(2)} è <strong>{Math.abs(result.premiumPct).toFixed(2)}% {result.premiumPct >= 0 ? 'sopra' : 'sotto'}</strong> il centro ({money(result.median)}).
                  </>
                )
              ) : (
                <>
                  <strong>Stima poco affidabile:</strong> i modelli discordano. Centro {money(result.median)}, ma nessun giudizio sopra o sotto.
                </>
              )}
            </p>
            <FairValueScale models={result.models} low={result.low} high={result.high} price={input.price} reliable={result.reliable} />
          </div>
        )}
        {altman && <AltmanBlock altman={altman} />}
      </div>
      {result && (
        <details className={styles.details}>
          <summary>Come si arriva a questa stima</summary>
          <ul className={styles.models}>
            {result.models.map((m) => (
              <li key={m.key}>
                <span>{m.label}</span>
                <span>${money(m.value)}</span>
              </li>
            ))}
          </ul>
          {result.excluded.length > 0 && (
            <ul className={styles.excluded}>
              {result.excluded.map((m) => (
                <li key={m.key}>
                  <span>{m.label}</span>
                  <span>{m.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.params}>
            Parametri tarati il {VALUATION_TUNED_ON}: sconto {Math.round(DISCOUNT_RATE * 100)}%, rendimento AAA {AAA_YIELD}%.
          </p>
        </details>
      )}
    </section>
  )
}
'''
s = s[:start] + new_card
open(p, 'w').write(s)

css = open('components/FairValueCard.module.css').read()
css += '''
.excluded {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
  font-size: 13px;
}

.excluded li {
  display: grid;
  gap: 2px;
  padding: 6px 0;
  border-top: 1px solid var(--rule);
}

.params {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 12.5px;
}
'''
open('components/FairValueCard.module.css', 'w').write(css)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/FairValueScale.test.tsx tests/components/FairValueCard.test.tsx && npx tsc --noEmit && npm run lint 2>&1 | grep -E "FairValue"`
Expected: PASS, tipi puliti, nessuna riga di lint sui file toccati. Se un test su `10.9\d% sopra` non trova il testo perché il paragrafo spezza il numero in più nodi, cercare con una funzione di matching sul testo del paragrafo (`screen.getByText((_, el) => el?.tagName === 'P' && /10\.9\d% sopra/.test(el.textContent ?? ''))`) senza cambiare il comportamento.

- [ ] **Step 6: Tick the audit tasks and verify everything**

In `auditcalc.md` spuntare i task 8 e 9:

```python
import re
p = 'auditcalc.md'
s = open(p).read()
for n in (8, 9):
    s, c = re.subn(r"^- \[ \] \*\*%d\. " % n, "- [x] **%d. " % n, s, count=1, flags=re.M)
    assert c == 1, n
open(p, 'w').write(s)
```

Run: `npm test > /tmp/suite.log 2>&1; grep -E "Test Files|Tests |FAIL" /tmp/suite.log | head -4; npx tsc --noEmit; npm run lint 2>&1 | grep -E "^/Volumes|problems"`
Expected: tutti i file di test verdi, `tsc` pulito, lint con i soli errori già presenti in `app/scopri/page.tsx` e `components/CandidateCard.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/FairValueScale.tsx components/FairValueScale.module.css components/FairValueCard.tsx components/FairValueCard.module.css tests/components/FairValueScale.test.tsx tests/components/FairValueCard.test.tsx auditcalc.md
git commit -m "feat: show the fair value as a range with a scale and the reasons for excluded models"
```

---

## Self-Review

**Copertura della spec**
- Intervallo con mediana e affidabilità, `position`, `premiumPct` solo se affidabile → Task 2 (`summarizeModels`) e Task 4 (scheda). ✔
- Quattro modelli con idoneità, motivi di esclusione, crescita mancante non trattata come 0, niente pavimento del 3% → Task 2 (`fairValueModels`). ✔
- Un solo Lynch (`lynchValue`), tolto il "prezzo obiettivo" → Task 2 e Task 3 (`evaluateTargetPrice` rimosso). ✔
- Free cash flow da `prezzo ÷ pfcfShareTTM`, `priceToFcf` in Finnhub → Task 1 e Task 2. ✔
- Parametri in `lib/valuation-config.ts` con data di taratura mostrata → Task 1 e Task 4. ✔
- Verdetto: `below` +1, `above` −1, resto 0; `Evaluation.fairValue`, note nelle tre varianti → Task 3. ✔
- `verdict-note.ts` (riga "Valore equo", `PROMPT_VERSION` +1, hash) → Task 3. ✔
- `buildFairValueInput` usato da `compare.ts` e dalla pagina; `fairValue` passato a `evaluateStock` → Task 2 e Task 3. ✔
- Scheda con intervallo, centro, etichetta "stima poco affidabile", scala accessibile, dettaglio con modelli esclusi, parametri → Task 4. ✔
- Casi di riferimento AAPL, MCD, JPM → Task 2. ✔
- Gestione errori (input non finiti, prezzo non positivo, meno di due modelli, soglia inclusiva) → Task 2. ✔
- Task 8 e 9 di `auditcalc.md` spuntati → Task 4. ✔

**Tipi e nomi**
`FairValueInput`/`FairValueResult`/`FairValuePosition` (Task 2) sono usati da `evaluate.ts` (Task 3) e dalla scheda (Task 4). `EvaluateInput.fairValue` è obbligatorio: i soli chiamanti sono `compare.ts`, la pagina (Task 3) e i test (aggiornati nel Task 3). `overallTone(tones, position, newsAdjustment)` coincide con la chiamata in `buildView`. `FairValueScale` riceve gli stessi `models`, `low`, `high` della `FairValueResult`.

**Punti da sapere**
- I valori di riferimento di AAPL, MCD e JPM usano prezzi arrotondati (350, 270, 300) e le metriche Finnhub del 17 novembre 2026: sono ancoraggi per il comportamento, non quotazioni.
- La nota LLM del verdetto si rigenera da sola al prossimo refresh.
