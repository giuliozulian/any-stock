# Analisi AI del setup Minervini: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare un pulsante "Analisi AI" che applica il rulebook di Minervini ai numeri già calcolati di un titolo e restituisce un giudizio strutturato che cita solo regole esistenti.

**Architecture:** Il codice calcola i numeri (`MinerviniAnalysis`), un modulo li riduce a un JSON piccolo, Gemini (tramite `requestLlmJson` già presente) li interpreta con il rulebook nel prompt di sistema, e un validatore scarta risposte con regole inventate o verdetti incoerenti con i numeri. Il risultato si salva per simbolo e giorno e si espone con una route autenticata e un componente client.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 + Postgres, Vitest, Gemini via endpoint compatibile OpenAI (`lib/llm-news.ts`).

**Spec:** `docs/superpowers/specs/2026-11-18-minervini-ai-analysis-design.md`. Rulebook umano: `docs/minervini-rulebook.md`.

## Global Constraints

- Testi per l'utente e prompt in italiano; identificatori e commenti nel codice in inglese, come nel resto del repo.
- Nessun testo dei libri nel repo né nel prompt. Il prompt contiene solo il rulebook riassunto.
- Mai citare Claude, Anthropic o AI generativa nei messaggi di commit, nei commenti di codice o nelle descrizioni (regola dell'utente). Niente trailer `Co-Authored-By`.
- Commit solo dopo l'ok esplicito dell'utente. `components/ScannerTable.tsx`, `components/ScannerTable.module.css` e `tests/components/ScannerTable.test.tsx` hanno già modifiche non committate dell'utente: non includerle nei propri commit, usare `git add -p` sulle sole righe del proprio lavoro.
- Prima di scrivere codice Next.js leggere la guida pertinente in `node_modules/next/dist/docs/` (regola di `AGENTS.md`: questa versione di Next.js ha cambiamenti rispetto a quella nota).
- Ogni route API esportata chiama `await requireUser(` una volta per handler (lo impone `tests/api/auth-coverage.test.ts`).
- La chiave Gemini resta lato server. Nessuna chiamata LLM dal browser.
- I test della suite normale non chiamano mai Gemini: l'LLM si simula.
- Soglie esistenti da non toccare: zona d'acquisto 5% (`MAX_CHASE`), stop 8% (`STOP_BELOW_PIVOT`), ultima contrazione 7% (`MAX_LAST_CONTRACTION`).

## Review Focus

Casi che lo spec implica ma che i test di ogni task non coprirebbero da soli; ognuno ha un test nel task indicato.

1. Gemini risponde con JSON valido ma con una regola inventata (`"ruleId": "TT9"`): la risposta va scartata, non corretta. Task 3.
2. Gemini dice `ready` con un criterio del Trend Template mancato: il verdetto scende a `wait` e il risultato segnala `adjusted`. Task 3.
3. L'LLM non è configurato (`GEMINI_API_KEY` assente) o lo storico è troppo corto per l'analisi: la route risponde 503 e la UI non si rompe. Task 5 e 6.
4. Due richieste identiche nello stesso giorno: la seconda non chiama l'LLM. Task 5.
5. Simbolo malformato nella route (`../x`, vuoto, minuscole): minuscole normalizzate, il resto rifiutato con 400. Task 5.

---

## Mappa dei file

| File | Responsabilità |
|------|----------------|
| `lib/minervini-rulebook.ts` (nuovo) | Regole con id, testo, tipo, fonte; versione; testo del prompt |
| `lib/minervini-ai.ts` (nuovo) | `buildInput`, `computeHash`, prompt, `parseAiResult`, `generateAiResult` |
| `lib/minervini-ai-note.ts` (nuovo) | Cache per simbolo e giorno e orchestrazione `getAiNote` |
| `app/api/minervini-ai/[symbol]/route.ts` (nuovo) | Route POST autenticata con limite |
| `components/MinerviniAiAnalysis.tsx` + `.module.css` (nuovi) | Pulsante, stati, risultato |
| `prisma/schema.prisma`, `prisma/migrations/20261118100000_minervini_ai_note/` | Tabella `MinerviniAiNote` |
| `components/MinerviniSection.tsx`, `components/ScannerTable.tsx` | Punti d'ingresso nella UI |
| `tests/eval/*`, `vitest.eval.config.ts` | Test di competenza, fuori dalla suite normale |
| `tests/helpers/db.ts` | Pulizia della nuova tabella |

---

### Task 1: Rulebook come costante

**Files:**
- Create: `lib/minervini-rulebook.ts`
- Test: `tests/lib/minervini-rulebook.test.ts`

**Interfaces:**
- Produces:
  - `type RuleKind = 'calcolo' | 'giudizio' | 'esterno'`
  - `interface Rule { id: string; rule: string; kind: RuleKind; source: string; verified: boolean }`
  - `const RULEBOOK_VERSION: number`
  - `const RULES: Rule[]`
  - `const RULE_IDS: Set<string>`
  - `function rulebookPrompt(): string`

- [ ] **Step 1: Scrivere il test che fallisce**

`tests/lib/minervini-rulebook.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RULES, RULE_IDS, RULEBOOK_VERSION, rulebookPrompt } from '@/lib/minervini-rulebook'

// Rules in the document that are deliberately not sent to the model: they come from other authors (O'Neil, CAN SLIM).
const LEFT_OUT = ['B4', 'S3', 'X2', 'X3', 'F2']

function documentIds(): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs', 'minervini-rulebook.md'), 'utf8')
  const rules = doc.slice(0, doc.indexOf('## Copertura nel codice'))
  return [...rules.matchAll(/^\| ([A-Z]{1,2}\d+) \|/gm)].map((m) => m[1])
}

describe('rulebook', () => {
  it('has unique ids', () => {
    expect(RULE_IDS.size).toBe(RULES.length)
  })

  it('matches the ids in docs/minervini-rulebook.md, minus the ones left out on purpose', () => {
    const expected = documentIds().filter((id) => !LEFT_OUT.includes(id)).sort()
    expect(RULES.map((r) => r.id).sort()).toEqual(expected)
  })

  it('never contains a left-out rule', () => {
    for (const id of LEFT_OUT) expect(RULE_IDS.has(id)).toBe(false)
  })

  it('has a version and a prompt line per rule, marking the unverified ones', () => {
    expect(RULEBOOK_VERSION).toBeGreaterThan(0)
    const prompt = rulebookPrompt()
    for (const r of RULES) expect(prompt).toContain(`${r.id} `)
    expect(prompt).toMatch(/V5 \[calcolo, non verificata\]/)
    expect(prompt).toMatch(/TT1 \[calcolo, confermata\]/)
  })
})
```

- [ ] **Step 2: Verificare che fallisce**

Run: `npx vitest run tests/lib/minervini-rulebook.test.ts`
Expected: FAIL, modulo `@/lib/minervini-rulebook` non trovato.

- [ ] **Step 3: Implementare**

`lib/minervini-rulebook.ts`:

```ts
export type RuleKind = 'calcolo' | 'giudizio' | 'esterno'

export interface Rule {
  id: string
  rule: string
  kind: RuleKind
  // Book and page, or "scelta nostra" for a threshold the app chose.
  source: string
  // False when the rule is only in AI summaries or is our own choice; the model must say so when it relies on it.
  verified: boolean
}

// Bump on every change to RULES, so cached analyses made with an older rulebook are not reused.
export const RULEBOOK_VERSION = 1

const W = 'Trade Like a Stock Market Wizard'
const C = 'Think & Trade Like a Champion'

export const RULES: Rule[] = [
  { id: 'TT1', rule: 'Prezzo sopra le medie a 150 e 200 giorni', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT2', rule: 'Media a 150 giorni sopra la media a 200', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT3', rule: 'Media a 200 giorni in salita da almeno 1 mese (meglio 4-5)', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT4', rule: 'Media a 50 giorni sopra le medie a 150 e 200', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT5', rule: 'Prezzo sopra la media a 50 giorni', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT6', rule: 'Prezzo almeno 30% sopra il minimo a 52 settimane', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT7', rule: 'Prezzo entro il 25% dal massimo a 52 settimane', kind: 'calcolo', source: `${W} pp. 79-80`, verified: true },
  { id: 'TT8', rule: 'Forza relativa almeno 70 su 100 (qui un percentile sui titoli confrontati, non il rating IBD)', kind: 'calcolo', source: `${W} pp. 79-80; proxy nostro`, verified: true },
  { id: 'B1', rule: 'Una base nello stage 2 dura da 5 a 26 settimane', kind: 'calcolo', source: `${W} p. 80`, verified: true },
  { id: 'B2', rule: 'Profondità della correzione di norma tra 15% e 40%, fino a 50% in mercati volatili; oltre il 60% è troppo profonda', kind: 'calcolo', source: `${W} p. 245`, verified: true },
  { id: 'B3', rule: 'Una base piatta corregge al massimo il 10-15%', kind: 'calcolo', source: `${W} p. 229`, verified: true },
  { id: 'V1', rule: 'Da 2 a 6 contrazioni, tipicamente 2-4', kind: 'calcolo', source: `${W} pp. 197, 201`, verified: true },
  { id: 'V2', rule: 'Ogni contrazione è circa la metà della precedente', kind: 'calcolo', source: `${W} p. 199`, verified: true },
  { id: 'V3', rule: 'Esempi di sequenze valide: 22/8/2%, 32/14/7/3%', kind: 'giudizio', source: `${W} pp. 227, 233`, verified: true },
  { id: 'V4', rule: 'Nell\'ultima contrazione il volume è sotto la media a 50 giorni, con 1-2 giorni a volume molto basso', kind: 'calcolo', source: `${W} p. 225`, verified: true },
  { id: 'V5', rule: 'L\'ultima contrazione è molto stretta (esempi 2-5%); non c\'è una soglia nei libri', kind: 'calcolo', source: 'esempi nei libri; soglia 7% nostra', verified: false },
  { id: 'V6', rule: 'Il pivot è netto: il punto di minima offerta dopo l\'ultima contrazione', kind: 'calcolo', source: `${W} p. 229`, verified: true },
  { id: 'V7', rule: 'Esistono ingressi alternativi (cup completion cheat, pivot nel manico)', kind: 'giudizio', source: `${W} p. 229`, verified: true },
  { id: 'V8', rule: 'Il prezzo è vicino al pivot, non già in fuga', kind: 'calcolo', source: `${W}`, verified: true },
  { id: 'E1', rule: 'Si compra quando il prezzo rompe il pivot su volume in aumento', kind: 'calcolo', source: `${W} pp. 227-229`, verified: true },
  { id: 'E2', rule: 'Il volume al breakout è più forte del solito; il libro non dà un numero (il 40-50% è di O\'Neil)', kind: 'calcolo', source: `${W} p. 229`, verified: false },
  { id: 'E3', rule: 'Zona d\'acquisto fino al 5% sopra il pivot; ingresso vicino al punto di stop', kind: 'calcolo', source: `${C}; 5% scelta nostra`, verified: false },
  { id: 'E4', rule: 'Un titolo oltre il 10% sopra l\'ultimo consolidamento è esteso: non si compra, si aspetta un pullback o una nuova base', kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'E5', rule: 'Tennis ball: ritorno al livello di rottura e ripartenza decisa', kind: 'giudizio', source: `${W} p. 237`, verified: true },
  { id: 'E6', rule: 'Dopo il breakout: follow-through, più giorni in rialzo che in calo, volume forte nei giorni in rialzo, chiusure vicine al massimo', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'E7', rule: 'Nel 40-50% dei casi il titolo torna al livello di rottura; è normale se recupera in pochi giorni o 1-2 settimane', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'S1', rule: 'Lo stop si decide prima dell\'ingresso e si esegue senza esitare', kind: 'calcolo', source: `${W} p. 295`, verified: true },
  { id: 'S2', rule: 'Perdita massima assoluta 10%, perdita media 6-7% (l\'app usa 8% sotto il prezzo pagato)', kind: 'calcolo', source: `${W} pp. 275, 301; 8% scelta nostra`, verified: true },
  { id: 'S4', rule: 'Rapporto guadagno/perdita almeno 2:1, obiettivo 3:1', kind: 'calcolo', source: `${W} p. 301`, verified: true },
  { id: 'S5', rule: 'Quando il guadagno è 3 volte il rischio, lo stop va almeno a pareggio', kind: 'calcolo', source: `${W} pp. 295, 307`, verified: true },
  { id: 'S6', rule: 'Si costruisce la posizione a scaglioni; non si fa la media al ribasso', kind: 'giudizio', source: `${W} p. 307`, verified: true },
  { id: 'S7', rule: 'In un mercato difficile gli stop si stringono (per esempio da 7-8% a 5-6%)', kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'S8', rule: 'Il rischio si controlla quando si compra, non quando si vende: ingresso il più vicino possibile allo stop', kind: 'giudizio', source: `${C}`, verified: true },
  { id: 'X1', rule: 'Si vende in forza: quando il titolo corre in modo esaurito o ai primi segni di debolezza', kind: 'giudizio', source: `${W} p. 295`, verified: true },
  { id: 'X4', rule: 'Segnali di distribuzione: il calo più forte dall\'inizio dello stage 2, gap di esaurimento', kind: 'giudizio', source: `${W} p. 73`, verified: true },
  { id: 'X5', rule: 'Breakout in difficoltà: basso volume senza follow-through, tre minimi decrescenti su volume in aumento, chiusura sotto la media a 20 giorni su volume alto', kind: 'calcolo', source: `${C}`, verified: true },
  { id: 'RS1', rule: 'La linea RS (titolo/indice) sale e segna nuovi massimi dentro la base', kind: 'esterno', source: 'riassunti AI (IBD)', verified: false },
  { id: 'RS2', rule: 'I titoli forti mantengono la forza relativa mentre il mercato scende', kind: 'giudizio', source: `${W} p. 167`, verified: true },
  { id: 'M1', rule: 'Il mercato generale deve assecondare', kind: 'esterno', source: `${W} p. 165`, verified: true },
  { id: 'M2', rule: 'Tre stati del mercato e conteggio dei distribution day', kind: 'esterno', source: 'riassunti AI (IBD)', verified: false },
  { id: 'F1', rule: 'Utili e ricavi in accelerazione (nessuna soglia minima fissa nei libri)', kind: 'esterno', source: `${W} p. 101`, verified: true },
  { id: 'F3', rule: 'Filtri di liquidità: prezzo almeno 10 $, volume 500k, controvalore 20 M$', kind: 'esterno', source: 'scelta nostra', verified: false },
]

export const RULE_IDS = new Set(RULES.map((r) => r.id))

// One line per rule, for the system prompt: `TT1 [calcolo, confermata] Regola (fonte)`.
export function rulebookPrompt(): string {
  return RULES.map((r) => `${r.id} [${r.kind}, ${r.verified ? 'confermata' : 'non verificata'}] ${r.rule} (${r.source})`).join('\n')
}
```

- [ ] **Step 4: Verificare che passa**

Run: `npx vitest run tests/lib/minervini-rulebook.test.ts`
Expected: PASS (4 test). Se fallisce la corrispondenza con il documento, allineare gli id: la fonte di verità per gli id è `docs/minervini-rulebook.md`.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini-rulebook.ts tests/lib/minervini-rulebook.test.ts docs/minervini-rulebook.md
git commit -m "feat: add the Minervini rulebook as a typed constant"
```

---

### Task 2: Input e hash

**Files:**
- Create: `lib/minervini-ai.ts` (prima parte)
- Test: `tests/lib/minervini-ai.test.ts`

**Interfaces:**
- Consumes: `MinerviniAnalysis` (tipo, da `@/lib/minervini-data`), `BaseMetrics`, `VcpStatus` da `@/lib/minervini`, `RULEBOOK_VERSION` dal Task 1.
- Produces:
  - `const PROMPT_VERSION = 1`
  - `interface AiInput { symbol: string; price: number; peerCount: number; trendTemplate: { passedCount: number; total: number; criteria: { id: string; label: string; ok: boolean; value: string }[] }; vcp: { status: VcpStatus | null; contractions: number[]; pivot: number | null; lastLow: number | null; suggestedStop: number | null; volumeDryUp: boolean; volumeRatio: number | null }; base: BaseMetrics | null }`
  - `function buildInput(symbol: string, analysis: MinerviniAnalysis): AiInput`
  - `function computeHash(input: AiInput): string`

- [ ] **Step 1: Scrivere il test che fallisce**

`tests/lib/minervini-ai.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import { PROMPT_VERSION, buildInput, computeHash } from '@/lib/minervini-ai'

const DAY = 86_400_000
const uptrend: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const close = 100 + i * 0.5
  return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
})

function analysis(): MinerviniAnalysis {
  const template = evaluateTrendTemplate(uptrend, 80)!
  return { template, vcp: detectVcp(uptrend), peerCount: 12 }
}

describe('buildInput', () => {
  it('keeps the essentials and numbers the criteria TT1..TT8', () => {
    const input = buildInput('AAPL', analysis())
    expect(input.symbol).toBe('AAPL')
    expect(input.peerCount).toBe(12)
    expect(input.price).toBeCloseTo(249.5, 1)
    expect(input.trendTemplate.criteria.map((c) => c.id)).toEqual(['TT1', 'TT2', 'TT3', 'TT4', 'TT5', 'TT6', 'TT7', 'TT8'])
    expect(input.trendTemplate.total).toBe(8)
    expect(input.vcp).toHaveProperty('status')
    expect(input).not.toHaveProperty('candles')
  })

  it('rounds numbers so a hash does not move on noise', () => {
    const a = analysis()
    const b = analysis()
    b.template.levels[0] = { ...b.template.levels[0], value: b.template.levels[0].value + 1e-9 }
    expect(computeHash(buildInput('AAPL', a))).toBe(computeHash(buildInput('AAPL', b)))
  })
})

describe('computeHash', () => {
  it('changes with the symbol-independent input', () => {
    const a = buildInput('AAPL', analysis())
    const b = buildInput('AAPL', { ...analysis(), peerCount: 13 })
    expect(computeHash(a)).not.toBe(computeHash(b))
  })

  it('is a sha256 hex string and depends on the prompt version', () => {
    const h = computeHash(buildInput('AAPL', analysis()))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(PROMPT_VERSION).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Verificare che fallisce**

Run: `npx vitest run tests/lib/minervini-ai.test.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: Implementare**

`lib/minervini-ai.ts`:

```ts
import { createHash } from 'node:crypto'
import type { BaseMetrics, VcpStatus } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import { RULEBOOK_VERSION } from '@/lib/minervini-rulebook'

// Bump on every change to the prompt or the output format, so cached analyses are regenerated.
export const PROMPT_VERSION = 1

export interface AiInput {
  symbol: string
  price: number
  peerCount: number
  trendTemplate: {
    passedCount: number
    total: number
    criteria: { id: string; label: string; ok: boolean; value: string }[]
  }
  vcp: {
    status: VcpStatus | null
    contractions: number[]
    pivot: number | null
    lastLow: number | null
    suggestedStop: number | null
    volumeDryUp: boolean
    volumeRatio: number | null
  }
  base: BaseMetrics | null
}

const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 10_000) / 10_000)

function roundBase(base: BaseMetrics | null): BaseMetrics | null {
  if (!base) return null
  return { ...base, depth: round(base.depth) as number, tightness: round(base.tightness), ratios: base.ratios.map((r) => round(r) as number) }
}

export function buildInput(symbol: string, analysis: MinerviniAnalysis): AiInput {
  const { template, vcp } = analysis
  const price = template.levels.find((l) => l.key === 'price')?.value ?? 0
  return {
    symbol,
    price: round(price) as number,
    peerCount: analysis.peerCount,
    trendTemplate: {
      passedCount: template.passedCount,
      total: template.total,
      criteria: template.criteria.map((c) => ({ id: `TT${c.id}`, label: c.label, ok: c.ok, value: c.value })),
    },
    vcp: {
      status: vcp.status,
      contractions: vcp.contractions.map((c) => round(c) as number),
      pivot: round(vcp.pivot),
      lastLow: round(vcp.lastLow),
      suggestedStop: round(vcp.suggestedStop),
      volumeDryUp: vcp.volumeDryUp,
      volumeRatio: round(vcp.volumeRatio),
    },
    base: roundBase(vcp.base),
  }
}

export function computeHash(input: AiInput): string {
  return createHash('sha256').update(`mai${PROMPT_VERSION}:r${RULEBOOK_VERSION}:${JSON.stringify(input)}`).digest('hex')
}
```

- [ ] **Step 4: Verificare che passa**

Run: `npx vitest run tests/lib/minervini-ai.test.ts && npx tsc --noEmit`
Expected: PASS e nessun errore di tipo.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini-ai.ts tests/lib/minervini-ai.test.ts
git commit -m "feat: build the AI input from a Minervini analysis"
```

---

### Task 3: Prompt e validazione dell'output

**Files:**
- Modify: `lib/minervini-ai.ts` (aggiungere in coda)
- Test: `tests/lib/minervini-ai.test.ts` (aggiungere)

**Interfaces:**
- Consumes: `AiInput`, `RULE_IDS`, `rulebookPrompt` dai Task 1-2.
- Produces:
  - `type Verdict = 'ready' | 'wait' | 'no'`
  - `type Outcome = 'met' | 'not_met' | 'not_assessable'`
  - `interface AiResult { verdict: Verdict; summary: string; criteria: { ruleId: string; outcome: Outcome; note: string }[]; missing: string[]; risks: string[]; uncovered: string[]; model: string; adjusted: boolean }`
  - `function buildSystemPrompt(): string`
  - `function buildUserPrompt(input: AiInput): string`
  - `function parseAiResult(raw: unknown, input: AiInput, model: string): AiResult | null`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `tests/lib/minervini-ai.test.ts` (e aggiornare l'import in testa con `buildSystemPrompt, buildUserPrompt, parseAiResult` e `import type { AiInput } from '@/lib/minervini-ai'`):

```ts
const passing = (): AiInput => {
  const input = buildInput('AAPL', analysis())
  return { ...input, trendTemplate: { ...input.trendTemplate, passedCount: input.trendTemplate.total }, vcp: { ...input.vcp, status: 'forming' } }
}

const raw = (over: Record<string, unknown> = {}) => ({
  verdict: 'ready',
  summary: 'Il titolo rispetta il Trend Template e la base è stretta.',
  criteria: [{ ruleId: 'TT1', outcome: 'met', note: 'Prezzo sopra le medie.' }],
  missing: [],
  risks: ['Campione RS piccolo'],
  uncovered: ['Fondamentali'],
  ...over,
})

describe('prompts', () => {
  it('puts every rule and the output rules in the system prompt', () => {
    const p = buildSystemPrompt()
    expect(p).toContain('TT1 [calcolo, confermata]')
    expect(p).toContain('not_assessable')
    expect(p).toMatch(/non dare consigli di acquisto o vendita/i)
  })

  it('sends the input as JSON in the user prompt', () => {
    const input = passing()
    expect(buildUserPrompt(input)).toContain(JSON.stringify(input.vcp.status))
  })
})

describe('parseAiResult', () => {
  it('accepts a valid answer and keeps the model', () => {
    const r = parseAiResult(raw(), passing(), 'gemini-x')
    expect(r).toMatchObject({ verdict: 'ready', model: 'gemini-x', adjusted: false })
    expect(r?.criteria).toHaveLength(1)
  })

  it('rejects an answer that cites a rule that does not exist', () => {
    expect(parseAiResult(raw({ criteria: [{ ruleId: 'TT9', outcome: 'met', note: 'x' }] }), passing(), 'm')).toBeNull()
  })

  it.each([
    ['not an object', null],
    ['unknown verdict', raw({ verdict: 'buy' })],
    ['empty summary', raw({ summary: '  ' })],
    ['criteria not a list', raw({ criteria: 'TT1' })],
    ['unknown outcome', raw({ criteria: [{ ruleId: 'TT1', outcome: 'maybe', note: 'x' }] })],
  ])('rejects %s', (_name, bad) => {
    expect(parseAiResult(bad, passing(), 'm')).toBeNull()
  })

  it('lowers ready to wait when the Trend Template is not fully met, and says so', () => {
    const input = passing()
    input.trendTemplate.passedCount = input.trendTemplate.total - 1
    const r = parseAiResult(raw(), input, 'm')
    expect(r?.verdict).toBe('wait')
    expect(r?.adjusted).toBe(true)
  })

  it('lowers ready to wait when there is no base ready or breaking out', () => {
    const input = passing()
    input.vcp.status = 'extended'
    expect(parseAiResult(raw(), input, 'm')?.verdict).toBe('wait')
    input.vcp.status = null
    expect(parseAiResult(raw(), input, 'm')?.adjusted).toBe(true)
  })

  it('does not touch wait or no', () => {
    const input = passing()
    input.trendTemplate.passedCount = 0
    expect(parseAiResult(raw({ verdict: 'no' }), input, 'm')).toMatchObject({ verdict: 'no', adjusted: false })
  })

  it('caps list lengths and text length', () => {
    const r = parseAiResult(raw({ summary: 'x'.repeat(900), risks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], uncovered: [' '] }), passing(), 'm')
    expect(r?.summary.length).toBeLessThanOrEqual(500)
    expect(r?.risks).toHaveLength(5)
    expect(r?.uncovered).toEqual([])
  })
})
```

- [ ] **Step 2: Verificare che falliscono**

Run: `npx vitest run tests/lib/minervini-ai.test.ts`
Expected: FAIL, `buildSystemPrompt is not a function` e simili.

- [ ] **Step 3: Implementare**

Aggiungere in testa a `lib/minervini-ai.ts` l'import `import { RULEBOOK_VERSION, RULE_IDS, rulebookPrompt } from '@/lib/minervini-rulebook'` (sostituendo quello esistente) e in coda:

```ts
export type Verdict = 'ready' | 'wait' | 'no'
export type Outcome = 'met' | 'not_met' | 'not_assessable'

export interface AiResult {
  verdict: Verdict
  summary: string
  criteria: { ruleId: string; outcome: Outcome; note: string }[]
  missing: string[]
  risks: string[]
  uncovered: string[]
  model: string
  // True when the app lowered the verdict because the numbers contradicted it.
  adjusted: boolean
}

const MAX_SUMMARY = 500
const MAX_NOTE = 220
const MAX_ITEMS = 5
const MAX_CRITERIA = 25
const VERDICTS: Verdict[] = ['ready', 'wait', 'no']
const OUTCOMES: Outcome[] = ['met', 'not_met', 'not_assessable']

export function buildSystemPrompt(): string {
  return `Sei un analista tecnico che applica il metodo di Mark Minervini (SEPA, Trend Template, VCP) a un titolo, per un investitore non esperto.
Ricevi i numeri già calcolati dall'app in formato JSON. Usa SOLO quei numeri e SOLO le regole elencate sotto. Non inventare numeri, non introdurre regole che non sono nell'elenco, non fare previsioni di prezzo e non dare consigli di acquisto o vendita: valuti se il setup rispetta il metodo.

Regole (id [tipo, stato] testo (fonte)):
${rulebookPrompt()}

Come ragionare:
- Per ogni regola che puoi valutare con i dati forniti, indica l'esito: met, not_met oppure not_assessable.
- Le regole di tipo "esterno" e quelle per cui i dati mancano sono not_assessable: non indovinarle.
- Le regole "non verificata" vanno trattate come indicazioni, non come fatti: se ti appoggi a una, dillo nella nota.
- Se peerCount è basso (meno di 15) il percentile di forza relativa è poco affidabile: segnalalo nei rischi.
- La tenuta finale (base.tightness) è una misura, non una soglia: descrivila senza dire che passa o non passa.
- verdict: "ready" solo se il Trend Template è soddisfatto e c'è una base pronta o in rottura; "wait" se manca qualcosa che può ancora arrivare; "no" se il setup non c'è.

Rispondi SOLO con un oggetto JSON con questi campi:
- verdict: "ready" | "wait" | "no"
- summary: 2-3 frasi in italiano
- criteria: lista di { ruleId, outcome, note } (ruleId deve essere uno degli id sopra; note massimo 200 caratteri, in italiano)
- missing: cosa deve ancora succedere perché il setup diventi pronto (massimo 5 punti)
- risks: rischi e punti deboli dei dati (massimo 5 punti)
- uncovered: aspetti che le regole non coprono o che non puoi valutare (massimo 5 punti)`
}

export function buildUserPrompt(input: AiInput): string {
  return `Dati del titolo (JSON):\n${JSON.stringify(input, null, 2)}`
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, MAX_NOTE))
    .slice(0, MAX_ITEMS)
}

// Rejects anything malformed or citing an unknown rule, then lowers a "ready" the numbers do not support.
export function parseAiResult(raw: unknown, input: AiInput, model: string): AiResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!VERDICTS.includes(r.verdict as Verdict)) return null
  if (typeof r.summary !== 'string' || r.summary.trim().length === 0) return null
  if (!Array.isArray(r.criteria) || r.criteria.length > MAX_CRITERIA) return null

  const criteria: AiResult['criteria'] = []
  for (const c of r.criteria) {
    if (typeof c !== 'object' || c === null) return null
    const { ruleId, outcome, note } = c as Record<string, unknown>
    if (typeof ruleId !== 'string' || !RULE_IDS.has(ruleId)) return null
    if (!OUTCOMES.includes(outcome as Outcome)) return null
    criteria.push({ ruleId, outcome: outcome as Outcome, note: typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '' })
  }

  const templateMet = input.trendTemplate.passedCount >= input.trendTemplate.total
  const hasBase = input.vcp.status === 'forming' || input.vcp.status === 'breakout'
  const lowered = r.verdict === 'ready' && !(templateMet && hasBase)
  return {
    verdict: lowered ? 'wait' : (r.verdict as Verdict),
    summary: r.summary.trim().slice(0, MAX_SUMMARY),
    criteria,
    missing: cleanList(r.missing),
    risks: cleanList(r.risks),
    uncovered: cleanList(r.uncovered),
    model,
    adjusted: lowered,
  }
}
```

- [ ] **Step 4: Verificare che passano**

Run: `npx vitest run tests/lib/minervini-ai.test.ts && npx tsc --noEmit`
Expected: PASS e nessun errore di tipo.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini-ai.ts tests/lib/minervini-ai.test.ts
git commit -m "feat: prompt and validation for the Minervini AI analysis"
```

---

### Task 4: Chiamata all'LLM con un ritento

**Files:**
- Modify: `lib/minervini-ai.ts` (aggiungere in coda)
- Test: `tests/lib/minervini-ai.test.ts` (aggiungere)

**Interfaces:**
- Consumes: `requestLlmJson(system: string, user: string): Promise<{ json: unknown; model: string } | null>` da `@/lib/llm-news`; funzioni del Task 3.
- Produces: `function generateAiResult(input: AiInput, request?: typeof requestLlmJson): Promise<AiResult | null>`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere (e importare `generateAiResult`, `vi` da vitest):

```ts
describe('generateAiResult', () => {
  const ok = { json: raw(), model: 'gemini-x' }

  it('returns the parsed result on the first valid answer', async () => {
    const request = vi.fn().mockResolvedValue(ok)
    const r = await generateAiResult(passing(), request)
    expect(r?.verdict).toBe('ready')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toContain('TT1 [calcolo, confermata]')
  })

  it('tries once more when the first answer is invalid, then gives up', async () => {
    const bad = { json: raw({ criteria: [{ ruleId: 'XX1', outcome: 'met', note: '' }] }), model: 'm' }
    const retry = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(ok)
    expect((await generateAiResult(passing(), retry))?.verdict).toBe('ready')
    expect(retry).toHaveBeenCalledTimes(2)

    const always = vi.fn().mockResolvedValue(bad)
    expect(await generateAiResult(passing(), always)).toBeNull()
    expect(always).toHaveBeenCalledTimes(2)
  })

  it('returns null at once when the LLM is not configured or the call failed', async () => {
    const request = vi.fn().mockResolvedValue(null)
    expect(await generateAiResult(passing(), request)).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Verificare che falliscono**

Run: `npx vitest run tests/lib/minervini-ai.test.ts`
Expected: FAIL, `generateAiResult is not a function`.

- [ ] **Step 3: Implementare**

In testa a `lib/minervini-ai.ts` aggiungere `import { requestLlmJson } from '@/lib/llm-news'` e in coda:

```ts
const ATTEMPTS = 2

// One request, one retry when the answer is not valid. A null from the client (no key, or the call failed after its own retries) ends it.
export async function generateAiResult(input: AiInput, request: typeof requestLlmJson = requestLlmJson): Promise<AiResult | null> {
  const system = buildSystemPrompt()
  const user = buildUserPrompt(input)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await request(system, user)
    if (!res) return null
    const parsed = parseAiResult(res.json, input, res.model)
    if (parsed) return parsed
  }
  return null
}
```

- [ ] **Step 4: Verificare che passano**

Run: `npx vitest run tests/lib/minervini-ai.test.ts && npx tsc --noEmit`
Expected: PASS e nessun errore di tipo.

- [ ] **Step 5: Commit**

```bash
git add lib/minervini-ai.ts tests/lib/minervini-ai.test.ts
git commit -m "feat: ask the LLM for the Minervini analysis with one retry"
```

---

### Task 5: Tabella, cache e route

**Files:**
- Modify: `prisma/schema.prisma` (aggiungere modello in fondo)
- Create: `prisma/migrations/20261118100000_minervini_ai_note/migration.sql`
- Create: `lib/minervini-ai-note.ts`
- Create: `app/api/minervini-ai/[symbol]/route.ts`
- Modify: `tests/helpers/db.ts` (pulizia)
- Test: `tests/api/minervini-ai.test.ts`

**Interfaces:**
- Consumes: `getMinerviniAnalysis(symbol): Promise<MinerviniAnalysis | null>` (`@/lib/minervini-data`), `isLlmConfigured()` (`@/lib/llm-news`), `buildInput`, `computeHash`, `generateAiResult`, `PROMPT_VERSION`, `AiResult` (Task 2-4), `rateLimit('heavy')` (`@/lib/rate-limit`), `requireUser` (`@/lib/auth`), `prisma` (`@/lib/db`).
- Produces:
  - `type AiNoteOutcome = { status: 'ok'; result: AiResult; cached: boolean } | { status: 'unavailable' }`
  - `function getAiNote(symbol: string): Promise<AiNoteOutcome>`
  - `POST /api/minervini-ai/[symbol]` → `200 { result, cached }`, `400 { error }`, `429` dal limite, `503 { error }`.

- [ ] **Step 1: Modello e migrazione**

Aggiungere in fondo a `prisma/schema.prisma`:

```prisma
model MinerviniAiNote {
  id            String   @id @default(cuid())
  symbol        String
  // UTC day as YYYY-MM-DD: one analysis per symbol and day.
  day           String
  inputHash     String
  result        Json
  model         String
  promptVersion Int
  generatedAt   DateTime @default(now())

  @@unique([symbol, day])
}
```

Creare `prisma/migrations/20261118100000_minervini_ai_note/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "MinerviniAiNote" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinerviniAiNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MinerviniAiNote_symbol_day_key" ON "MinerviniAiNote"("symbol", "day");
```

Run: `npx prisma generate`
Expected: client rigenerato senza errori. Applicare la migrazione al database di test con il comando che il repo usa per gli altri test di integrazione (vedi `docker-compose.test.yml` e il README: tipicamente `npx prisma migrate deploy` con `DATABASE_URL` del test).

In `tests/helpers/db.ts` aggiungere, prima di `await prisma.scanAlert.deleteMany()`:

```ts
  await prisma.minerviniAiNote.deleteMany()
```

- [ ] **Step 2: Scrivere i test della route che falliscono**

`tests/api/minervini-ai.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { POST } from '@/app/api/minervini-ai/[symbol]/route'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'

const DAY = 86_400_000
const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
  const close = 100 + i * 0.5
  return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
})

const analysis = { template: evaluateTrendTemplate(bars, 80)!, vcp: detectVcp(bars), peerCount: 12 }
const llmAnswer = {
  verdict: 'wait',
  summary: 'Trend soddisfatto, base ancora da completare.',
  criteria: [{ ruleId: 'TT1', outcome: 'met', note: 'ok' }],
  missing: ['Contrazione finale'],
  risks: [],
  uncovered: [],
}

const getMinerviniAnalysis = vi.fn()
const requestLlmJson = vi.fn()
const isLlmConfigured = vi.fn()
const rateLimit = vi.fn()

vi.mock('@/lib/minervini-data', () => ({ getMinerviniAnalysis: (s: string) => getMinerviniAnalysis(s) }))
vi.mock('@/lib/llm-news', () => ({ requestLlmJson: (...a: unknown[]) => requestLlmJson(...a), isLlmConfigured: () => isLlmConfigured() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (b: string) => rateLimit(b) }))

const call = (symbol: string) => POST(new Request(`http://localhost/api/minervini-ai/${symbol}`, { method: 'POST' }), { params: Promise.resolve({ symbol }) })

describe('POST /api/minervini-ai/[symbol]', () => {
  beforeEach(async () => {
    await resetDb()
    vi.clearAllMocks()
    getMinerviniAnalysis.mockResolvedValue(analysis)
    requestLlmJson.mockResolvedValue({ json: llmAnswer, model: 'gemini-x' })
    isLlmConfigured.mockReturnValue(true)
    rateLimit.mockResolvedValue(null)
  })

  it('generates, stores and returns the analysis', async () => {
    const res = await call('aapl')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cached).toBe(false)
    expect(body.result.verdict).toBe('wait')
    expect(await prisma.minerviniAiNote.count()).toBe(1)
    expect(getMinerviniAnalysis).toHaveBeenCalledWith('AAPL')
  })

  it('serves a second identical request from the cache without calling the LLM', async () => {
    await call('AAPL')
    const res = await call('AAPL')
    expect((await res.json()).cached).toBe(true)
    expect(requestLlmJson).toHaveBeenCalledTimes(1)
    expect(await prisma.minerviniAiNote.count()).toBe(1)
  })

  it('regenerates once when the numbers changed in the same day', async () => {
    await call('AAPL')
    getMinerviniAnalysis.mockResolvedValue({ ...analysis, peerCount: 30 })
    const res = await call('AAPL')
    expect((await res.json()).cached).toBe(false)
    expect(requestLlmJson).toHaveBeenCalledTimes(2)
    expect(await prisma.minerviniAiNote.count()).toBe(1)
  })

  it('answers 503 when the LLM is not configured, the history is too short or the answer is invalid', async () => {
    isLlmConfigured.mockReturnValue(false)
    expect((await call('AAPL')).status).toBe(503)

    isLlmConfigured.mockReturnValue(true)
    getMinerviniAnalysis.mockResolvedValue(null)
    expect((await call('AAPL')).status).toBe(503)

    getMinerviniAnalysis.mockResolvedValue(analysis)
    requestLlmJson.mockResolvedValue({ json: { verdict: 'buy' }, model: 'm' })
    expect((await call('AAPL')).status).toBe(503)
    expect(await prisma.minerviniAiNote.count()).toBe(0)
  })

  it('refuses a malformed symbol', async () => {
    for (const bad of ['', '../x', 'A'.repeat(20), 'AA PL']) expect((await call(bad)).status).toBe(400)
    expect(getMinerviniAnalysis).not.toHaveBeenCalled()
  })

  it('returns the rate limit response as is', async () => {
    rateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await call('AAPL')).status).toBe(429)
    expect(requestLlmJson).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Verificare che falliscono**

Run: `npx vitest run tests/api/minervini-ai.test.ts`
Expected: FAIL, modulo `@/app/api/minervini-ai/[symbol]/route` non trovato.

- [ ] **Step 4: Implementare cache e route**

`lib/minervini-ai-note.ts`:

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isLlmConfigured } from '@/lib/llm-news'
import { PROMPT_VERSION, buildInput, computeHash, generateAiResult, type AiResult } from '@/lib/minervini-ai'
import { getMinerviniAnalysis } from '@/lib/minervini-data'

export type AiNoteOutcome = { status: 'ok'; result: AiResult; cached: boolean } | { status: 'unavailable' }

const KEEP_DAYS = 14

const today = () => new Date().toISOString().slice(0, 10)

// One analysis per symbol and day: the stored one is reused while the numbers behind it are the same.
export async function getAiNote(symbol: string): Promise<AiNoteOutcome> {
  if (!isLlmConfigured()) return { status: 'unavailable' }
  const analysis = await getMinerviniAnalysis(symbol)
  if (!analysis) return { status: 'unavailable' }

  const input = buildInput(symbol, analysis)
  const inputHash = computeHash(input)
  const day = today()

  const existing = await prisma.minerviniAiNote.findUnique({ where: { symbol_day: { symbol, day } } })
  if (existing && existing.inputHash === inputHash) return { status: 'ok', result: existing.result as unknown as AiResult, cached: true }

  const result = await generateAiResult(input)
  if (!result) return { status: 'unavailable' }

  const data = { inputHash, result: result as unknown as Prisma.InputJsonValue, model: result.model, promptVersion: PROMPT_VERSION, generatedAt: new Date() }
  await prisma.minerviniAiNote.upsert({ where: { symbol_day: { symbol, day } }, create: { symbol, day, ...data }, update: data })
  const oldest = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await prisma.minerviniAiNote.deleteMany({ where: { day: { lt: oldest } } })
  return { status: 'ok', result, cached: false }
}
```

`app/api/minervini-ai/[symbol]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { getAiNote } from '@/lib/minervini-ai-note'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response
  const limited = await rateLimit('heavy')
  if (limited) return limited

  const symbol = (await params).symbol.toUpperCase()
  if (!SYMBOL.test(symbol)) return NextResponse.json({ error: 'Simbolo non valido' }, { status: 400 })

  try {
    const note = await getAiNote(symbol)
    if (note.status === 'unavailable') return NextResponse.json({ error: 'Analisi AI non disponibile' }, { status: 503 })
    return NextResponse.json({ result: note.result, cached: note.cached })
  } catch (err) {
    console.error('Minervini AI failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Analisi AI non disponibile' }, { status: 503 })
  }
}
```

- [ ] **Step 5: Verificare che passa**

Run: `npx vitest run tests/api/minervini-ai.test.ts tests/api/auth-coverage.test.ts && npx tsc --noEmit`
Expected: PASS, compresa la copertura di `requireUser` per la nuova route.

- [ ] **Step 6: Commit**

```bash
git add prisma lib/minervini-ai-note.ts app/api/minervini-ai tests/api/minervini-ai.test.ts tests/helpers/db.ts
git commit -m "feat: cached Minervini AI analysis behind an authenticated route"
```

---

### Task 6: Componente e punti d'ingresso

**Files:**
- Create: `components/MinerviniAiAnalysis.tsx`
- Create: `components/MinerviniAiAnalysis.module.css`
- Modify: `components/MinerviniSection.tsx`
- Modify: `components/ScannerTable.tsx` (riga `Row`, intorno alle righe 172-228)
- Test: `tests/components/MinerviniAiAnalysis.test.tsx`

**Interfaces:**
- Consumes: `POST /api/minervini-ai/[symbol]` → `{ result: AiResult, cached: boolean }` (Task 5); tipo `AiResult` (Task 3).
- Produces: `function MinerviniAiAnalysis(props: { symbol: string; autoStart?: boolean }): JSX.Element`.

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/components/MinerviniAiAnalysis.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'

const result = {
  verdict: 'wait',
  summary: 'Trend soddisfatto, base da completare.',
  criteria: [
    { ruleId: 'TT1', outcome: 'met', note: 'Prezzo sopra le medie.' },
    { ruleId: 'V5', outcome: 'not_assessable', note: 'Nessuna soglia nei libri.' },
  ],
  missing: ['Contrazione finale'],
  risks: ['Campione RS piccolo'],
  uncovered: ['Fondamentali'],
  model: 'gemini-x',
  adjusted: false,
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('MinerviniAiAnalysis', () => {
  afterEach(() => vi.restoreAllMocks())

  it('starts idle with a button and calls nothing until it is clicked', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" />)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Analisi AI' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/minervini-ai/AAPL', { method: 'POST' })
  })

  it('shows the verdict, the criteria and the disclaimer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result, cached: false }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByRole('heading', { name: 'Da attendere' })).toBeInTheDocument()
    expect(screen.getByText('Trend soddisfatto, base da completare.')).toBeInTheDocument()
    expect(screen.getByText('TT1')).toBeInTheDocument()
    expect(screen.getByText('Non valutabile')).toBeInTheDocument()
    expect(screen.getByText('Contrazione finale')).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('says when the verdict was lowered by the numbers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ result: { ...result, adjusted: true }, cached: true }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByText(/verdetto abbassato/i)).toBeInTheDocument()
  })

  it('shows a skeleton while it loads', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByRole('status', { name: /analisi in corso/i })).toBeInTheDocument()
  })

  it('shows a short message when the analysis is not available, and offers a retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }))
    render(<MinerviniAiAnalysis symbol="AAPL" autoStart />)
    expect(await screen.findByText(/analisi ai non disponibile/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Verificare che falliscono**

Run: `npx vitest run tests/components/MinerviniAiAnalysis.test.tsx`
Expected: FAIL, componente non trovato.

- [ ] **Step 3: Implementare il componente**

`components/MinerviniAiAnalysis.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AiResult, Outcome, Verdict } from '@/lib/minervini-ai'
import styles from './MinerviniAiAnalysis.module.css'

const VERDICT: Record<Verdict, { title: string; tone: 'gain' | 'warn' | 'loss' }> = {
  ready: { title: 'Setup pronto', tone: 'gain' },
  wait: { title: 'Da attendere', tone: 'warn' },
  no: { title: 'Non adatto', tone: 'loss' },
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
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  )
}

export function MinerviniAiAnalysis({ symbol, autoStart = false }: { symbol: string; autoStart?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const run = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/minervini-ai/${encodeURIComponent(symbol)}`, { method: 'POST' })
      if (!res.ok) return setState({ kind: 'error' })
      const body = (await res.json()) as { result: AiResult }
      setState({ kind: 'done', result: body.result })
    } catch {
      setState({ kind: 'error' })
    }
  }, [symbol])

  useEffect(() => {
    if (autoStart) void run()
  }, [autoStart, run])

  if (state.kind === 'idle') {
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.button} onClick={run}>
          Analisi AI
        </button>
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
        {result.criteria.map((c) => (
          <li key={c.ruleId} className={styles.criterion} data-outcome={c.outcome}>
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
```

`components/MinerviniAiAnalysis.module.css` (usa le stesse variabili di `MinerviniPanel.module.css`):

```css
.wrap {
  --tone: var(--muted);
  display: grid;
  gap: 10px;
  min-width: 0;
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--rule));
  border-radius: var(--radius-card);
  background: var(--surface);
}

.wrap[data-tone='gain'] {
  --tone: var(--gain-bright);
}

.wrap[data-tone='warn'] {
  --tone: var(--amber-bright);
}

.wrap[data-tone='loss'] {
  --tone: var(--loss-bright);
}

.title {
  margin: 0;
  font-size: 18px;
  color: var(--tone);
}

.summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--bone);
}

.muted {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}

.button {
  justify-self: start;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--bone);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.button:hover {
  border-color: var(--brass);
}

.criteria,
.list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.criterion {
  display: grid;
  grid-template-columns: 44px 112px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
}

.ruleId {
  font-family: var(--font-num);
  color: var(--muted);
}

.outcome {
  color: var(--muted);
}

.criterion[data-outcome='met'] .outcome {
  color: var(--gain-bright);
}

.criterion[data-outcome='not_met'] .outcome {
  color: var(--loss-bright);
}

.note {
  min-width: 0;
  color: var(--bone);
}

.block {
  display: grid;
  gap: 4px;
}

.blockTitle {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.list li {
  font-size: 13px;
  line-height: 1.5;
  color: var(--bone);
}

.sk {
  border-radius: 6px;
  background: var(--surface-raised);
  animation: pulse 1.4s ease-in-out infinite;
}

.skTitle {
  width: 40%;
  height: 20px;
}

.skLine {
  width: 100%;
  height: 14px;
}

@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}

@media (max-width: 480px) {
  .criterion {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .note {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 4: Inserire il componente**

`components/MinerviniSection.tsx` diventa:

```tsx
import { getMinerviniAnalysis } from '@/lib/minervini-data'
import { MinerviniPanel } from '@/components/MinerviniPanel'
import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'

export async function MinerviniSection({ symbol }: { symbol: string }) {
  const analysis = await getMinerviniAnalysis(symbol).catch(() => null)
  return (
    <>
      <MinerviniPanel analysis={analysis} />
      {analysis && <MinerviniAiAnalysis symbol={symbol} />}
    </>
  )
}
```

In `components/ScannerTable.tsx`: aggiungere `import { MinerviniAiAnalysis } from '@/components/MinerviniAiAnalysis'` accanto a `ScanChart`; nella funzione `Row` aggiungere sotto `const [chartOpen, setChartOpen] = useState(false)`:

```tsx
  const [aiOpen, setAiOpen] = useState(false)
```

nel blocco `<div className={styles.actions}>`, subito dopo il pulsante "Mostra grafico":

```tsx
        <button type="button" className={styles.chartToggle} aria-expanded={aiOpen} onClick={() => setAiOpen((o) => !o)}>
          Analisi AI
        </button>
```

e dopo `{chartOpen && <ScanChart symbol={r.symbol} />}`:

```tsx
      {aiOpen && <MinerviniAiAnalysis symbol={r.symbol} autoStart />}
```

Nota: questo file ha modifiche non committate dell'utente; aggiungere solo queste righe e non toccare le altre.

- [ ] **Step 5: Verificare**

Run: `npx vitest run tests/components && npx tsc --noEmit && npx eslint components lib app tests`
Expected: PASS. Se un test esistente di `ScannerTable` conta i pulsanti per nome, aggiornarlo per il nuovo pulsante "Analisi AI".

- [ ] **Step 6: Verifica nel browser**

Run: `npm run dev`, aprire `http://localhost:3000/scanner`, premere "Analisi AI" su una riga; poi `http://localhost:3000/stock/<simbolo in watchlist>`. Verificare: scheletro durante il caricamento, risultato con verdetto, errore leggibile se `GEMINI_API_KEY` manca. Riportare cosa si è visto, anche se qualcosa non funziona.

- [ ] **Step 7: Commit**

```bash
git add components/MinerviniAiAnalysis.tsx components/MinerviniAiAnalysis.module.css components/MinerviniSection.tsx tests/components/MinerviniAiAnalysis.test.tsx
git add -p components/ScannerTable.tsx
git commit -m "feat: AI analysis button in the scanner and the stock page"
```

---

### Task 7: Test di competenza (fuori dalla suite normale)

**Files:**
- Create: `vitest.eval.config.ts`
- Create: `tests/eval/extract-cases.mjs`
- Create: `tests/eval/cases.json` (generato dallo script)
- Create: `tests/eval/bars.ts`
- Create: `tests/eval/find-negatives.eval.ts`
- Create: `tests/eval/minervini-ai.eval.ts`
- Modify: `package.json` (script `eval:minervini`)
- Modify: `vitest.config.ts` (escludere `tests/eval/**`)

**Interfaces:**
- Consumes: `evaluateTrendTemplate`, `detectVcp` (`@/lib/minervini`), `buildInput`, `generateAiResult` (`@/lib/minervini-ai`). Non importa `lib/minervini-data` né `lib/db` (evita il database).
- Produces: `tests/eval/results.json` con una riga per caso (`symbol`, `date`, `label`, `verdict`, `citedUnknown`), e un riepilogo a console.

Nota di metodo: i casi positivi sono scelti col senno di poi, quindi il test misura se l'AI applica bene le regole, non se il metodo funziona. La **soglia di accettazione** va fissata con l'utente prima del primo lancio e scritta nel file (Step 6): non adattarla ai risultati.

- [ ] **Step 1: Escludere la cartella dalla suite normale**

In `vitest.config.ts`, dentro `test: {`, aggiungere `exclude: ['**/node_modules/**', 'tests/eval/**'],`.

Creare `vitest.eval.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 30 * 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

In `package.json`, negli `scripts`: `"eval:minervini": "vitest run --config vitest.eval.config.ts"`.

- [ ] **Step 2: Estrarre i casi positivi**

`tests/eval/extract-cases.mjs` (legge `data/sources/`, che è fuori da git, e scrive solo ticker, data e prezzo):

```js
import { readFileSync, writeFileSync } from 'node:fs'

const text = readFileSync('data/sources/minervini/charts-pdf.md', 'utf8')
const pattern = /\b([A-Z]{1,5}) broke out through \$([\d.]+) on ([A-Z][a-z]+ \d{1,2}, \d{4})/g
const seen = new Set()
const cases = []
for (const m of text.matchAll(pattern)) {
  const [, symbol, price, when] = m
  const date = new Date(`${when} UTC`).toISOString().slice(0, 10)
  const key = `${symbol}:${date}`
  if (seen.has(key)) continue
  seen.add(key)
  cases.push({ symbol, date, price: Number(price), label: 'winner' })
}
writeFileSync('tests/eval/cases.json', `${JSON.stringify(cases, null, 2)}\n`)
console.log(`${cases.length} cases`)
```

Run: `node tests/eval/extract-cases.mjs`
Expected: `22 cases` circa (il file ne cita 35 con la formula; contano solo quelli con data e prezzo). Aprire `tests/eval/cases.json` e controllare a occhio 3 righe contro `charts-pdf.md` (per esempio NVDA 2023-01-12 prezzo 160.56).

- [ ] **Step 3: Funzione per lo storico con date**

`getDailyBars` copre solo gli ultimi 2 anni, non basta per i casi del 2023. `tests/eval/bars.ts`:

```ts
import type { Bar } from '@/lib/history'

// Daily bars between two dates straight from Yahoo; null on any failure.
export async function barsBetween(symbol: string, from: Date, to: Date): Promise<Bar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(from.getTime() / 1000)}&period2=${Math.floor(to.getTime() / 1000)}&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  const r = json?.chart?.result?.[0]
  const q = r?.indicators?.quote?.[0]
  if (!r?.timestamp || !q) return null
  const bars: Bar[] = []
  r.timestamp.forEach((t: number, i: number) => {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null || q.volume[i] == null) return
    bars.push({ t: t * 1000, high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] })
  })
  return bars
}
```

- [ ] **Step 4: Cercare i negativi**

`tests/eval/find-negatives.eval.ts` (si lancia con `npx vitest run --config vitest.eval.config.ts find-negatives`; scrive `tests/eval/negatives.json`):

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import { barsBetween } from './bars'

const SAMPLE = 80
const STEP = 5
const FORWARD = 15
const STOP = 0.08
const MAX_NEGATIVES = 25

describe('find negatives', () => {
  it('lists breakouts the detector flagged that fell through the 8% stop within three weeks', async () => {
    const universe: string[] = JSON.parse(readFileSync('data/sp500.json', 'utf8')).map((s: string | { symbol: string }) => (typeof s === 'string' ? s : s.symbol))
    const symbols = universe.filter((_, i) => i % Math.floor(universe.length / SAMPLE) === 0).slice(0, SAMPLE)
    const found: { symbol: string; date: string; price: number; label: 'failed' }[] = []
    for (const symbol of symbols) {
      if (found.length >= MAX_NEGATIVES) break
      const bars = await barsBetween(symbol, new Date('2021-01-01'), new Date())
      if (!bars || bars.length < 400) continue
      for (let end = 260; end < bars.length - FORWARD; end += STEP) {
        const slice = bars.slice(0, end)
        const template = evaluateTrendTemplate(slice, null)
        if (!template || template.passedCount < template.total) continue
        const vcp = detectVcp(slice)
        if (vcp.status !== 'breakout') continue
        const entry = slice[slice.length - 1].close
        const low = Math.min(...bars.slice(end, end + FORWARD).map((b) => b.low))
        if (low < entry * (1 - STOP)) {
          found.push({ symbol, date: new Date(slice[slice.length - 1].t).toISOString().slice(0, 10), price: entry, label: 'failed' })
          break
        }
      }
    }
    writeFileSync('tests/eval/negatives.json', `${JSON.stringify(found, null, 2)}\n`)
    console.log(`${found.length} negatives`)
  })
})
```

Nota: se `data/sp500.json` ha una forma diversa da array di stringhe o di `{ symbol }`, adattare la riga `universe` guardando le prime righe del file.

Run: `npx vitest run --config vitest.eval.config.ts find-negatives`
Expected: `N negatives` con N tra 10 e 25. Se N è sotto 10, aumentare `SAMPLE` e rilanciare.

- [ ] **Step 5: Il test di competenza**

`tests/eval/minervini-ai.eval.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import { buildInput, generateAiResult } from '@/lib/minervini-ai'
import { barsBetween } from './bars'

interface Case {
  symbol: string
  date: string
  price: number
  label: 'winner' | 'failed'
}

// Fixed with the user BEFORE the first run. Do not adjust after seeing results.
const MIN_AGREEMENT = 0 // TODO set with the user: share of cases where the verdict matches the label
const MAX_READY_ON_FAILED = 1 // TODO set with the user: share of "failed" cases the AI may call ready

const DAY = 86_400_000

describe('minervini ai competence', () => {
  it('judges the day before each known breakout', async () => {
    const cases: Case[] = [...JSON.parse(readFileSync('tests/eval/cases.json', 'utf8')), ...JSON.parse(readFileSync('tests/eval/negatives.json', 'utf8'))]
    const rows: { symbol: string; date: string; label: string; verdict: string | null; ok: boolean | null }[] = []
    for (const c of cases) {
      const at = new Date(`${c.date}T00:00:00Z`)
      const bars = await barsBetween(c.symbol, new Date(at.getTime() - 800 * DAY), new Date(at.getTime() - DAY))
      if (!bars || bars.length < 222) {
        rows.push({ symbol: c.symbol, date: c.date, label: c.label, verdict: null, ok: null })
        continue
      }
      // No peers at a historical date: the RS criterion is left out, as in the app when the sample is too small.
      const template = evaluateTrendTemplate(bars, null)!
      const input = buildInput(c.symbol, { template, vcp: detectVcp(bars), peerCount: 0 })
      const result = await generateAiResult(input)
      const verdict = result?.verdict ?? null
      const ok = verdict === null ? null : c.label === 'winner' ? verdict !== 'no' : verdict !== 'ready'
      rows.push({ symbol: c.symbol, date: c.date, label: c.label, verdict, ok })
    }
    writeFileSync('tests/eval/results.json', `${JSON.stringify(rows, null, 2)}\n`)

    const judged = rows.filter((r) => r.ok !== null)
    const agreement = judged.filter((r) => r.ok).length / judged.length
    const failed = judged.filter((r) => r.label === 'failed')
    const readyOnFailed = failed.length ? failed.filter((r) => r.verdict === 'ready').length / failed.length : 0
    console.table(rows)
    console.log({ judged: judged.length, skipped: rows.length - judged.length, agreement, readyOnFailed })

    expect(agreement).toBeGreaterThanOrEqual(MIN_AGREEMENT)
    expect(readyOnFailed).toBeLessThanOrEqual(MAX_READY_ON_FAILED)
  })
})
```

Questo file ha due soglie lasciate a 0 e 1 (test sempre verde) **volutamente**, finché non le fissiamo con l'utente nello Step 6: finché restano così il lancio serve solo a produrre la tabella.

- [ ] **Step 6: Fissare le soglie con l'utente e lanciare**

Chiedere all'utente due numeri e scriverli in `MIN_AGREEMENT` e `MAX_READY_ON_FAILED`, rimuovendo i `TODO`. Poi:

Run: `npm run eval:minervini`
Expected: una tabella con una riga per caso e il riepilogo `{ judged, skipped, agreement, readyOnFailed }`; `tests/eval/results.json` scritto. Riportare i numeri all'utente senza correggere le soglie dopo.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts vitest.eval.config.ts package.json tests/eval
git commit -m "test: competence check for the Minervini AI analysis"
```

---

## Self-review

**Copertura dello spec**
- Rulebook costante e test di coerenza con il documento: Task 1.
- `buildInput`, `computeHash`, versione del prompt e del rulebook: Task 2.
- Formato dell'output e validazione in quattro passi (forma, id esistenti, coerenza con i numeri, un solo ritento): Task 3 e 4. La coerenza con i numeri è estesa oltre lo spec (richiede anche una base `forming` o `breakout`, oltre al Trend Template soddisfatto): è una scelta coerente con la definizione di `ready` nel prompt, da segnalare all'utente.
- Tabella per simbolo e giorno, una generazione al giorno, rigenerazione se l'hash cambia, pulizia dei vecchi: Task 5.
- Route con login, bucket `heavy`, 429, 503, 400: Task 5.
- Pulsante nello scanner e nel pannello, scheletro, disclaimer, nessuna rottura se non disponibile: Task 6.
- Test di competenza con positivi da `charts-pdf`, negativi dallo storico, soglia fissata prima, fuori dalla suite: Task 7.
- Rimandato (immagine, AVWAP, batch, testo dei libri): nessun task, come previsto.

**Segnaposto:** due `TODO` esistono nel codice dello Step 5 del Task 7 e sono voluti (soglie da fissare con l'utente nello Step 6, che li rimuove). Nessun altro.

**Coerenza dei tipi:** `AiInput`, `AiResult`, `Verdict`, `Outcome`, `PROMPT_VERSION`, `RULEBOOK_VERSION`, `RULE_IDS`, `generateAiResult(input, request?)`, `getAiNote(symbol)` hanno la stessa firma ovunque compaiano. `AiInput.trendTemplate.criteria[].id` è la stringa `TT1..TT8`, mentre `Criterion.id` nel codice esistente è un numero: la conversione avviene solo in `buildInput`.

**Rischi noti per chi esegue**
- Il test della route usa il database di test (come gli altri test di integrazione): la migrazione va applicata lì prima di lanciarlo.
- `getMinerviniAnalysis` calcola l'RS sui pari di watchlist e scoperte (massimo 40), non sull'universo dello scanner: il prompt riceve `peerCount` per questo.
- In `tests/eval` le chiamate a Yahoo e a Gemini sono reali e possono dare errori di rete: i casi senza dati finiscono in `skipped`, non rompono la tabella.
