import { createHash } from 'node:crypto'
import { requestLlmJson } from '@/lib/llm-news'
import type { BaseMetrics, VcpStatus } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import { RULEBOOK_VERSION, RULE_IDS, rulebookPrompt } from '@/lib/minervini-rulebook'

// Bump on every change to the prompt or the output format, so cached analyses are regenerated.
export const PROMPT_VERSION = 2

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

export function computeHash(input: AiInput, rulebookVersion = RULEBOOK_VERSION, promptVersion = PROMPT_VERSION): string {
  return createHash('sha256').update(`mai${promptVersion}:r${rulebookVersion}:${JSON.stringify(input)}`).digest('hex')
}

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
- missing: cosa deve ancora succedere perché il setup diventi in linea con il metodo (massimo 5 punti), scritto come condizioni osservabili ("il prezzo deve superare il pivot") e non come istruzioni di acquisto o vendita
- risks: rischi e punti deboli dei dati (massimo 5 punti)
- uncovered: aspetti che le regole non coprono o che non puoi valutare (massimo 5 punti)`
}

export function buildUserPrompt(input: AiInput): string {
  return `Dati del titolo (JSON):\n${JSON.stringify(input, null, 2)}`
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim().slice(0, MAX_NOTE))
  return [...new Set(items)].slice(0, MAX_ITEMS)
}

// Light shape check for a result read back from the database, where an older version may have stored something else.
export function isAiResult(value: unknown): value is AiResult {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    VERDICTS.includes(r.verdict as Verdict) &&
    typeof r.summary === 'string' &&
    Array.isArray(r.criteria) &&
    Array.isArray(r.missing) &&
    Array.isArray(r.risks) &&
    Array.isArray(r.uncovered)
  )
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
    // The model sometimes cites a rule twice: the first mention wins.
    if (criteria.some((c) => c.ruleId === ruleId)) continue
    criteria.push({ ruleId, outcome: outcome as Outcome, note: typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '' })
  }

  // Every criterion must pass, including relative strength: when too few peers leave it out of the count, it is still not met.
  const templateMet = input.trendTemplate.passedCount >= input.trendTemplate.total && input.trendTemplate.criteria.every((c) => c.ok)
  // A base the code itself flags as too deep, too short or too long is not a base ready to buy.
  const hasBase = (input.vcp.status === 'forming' || input.vcp.status === 'breakout') && input.base !== null && input.base.weeksOk && input.base.depthOk
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

const ATTEMPTS = 2
// The route may run for 60 seconds at most and the client already retries on its own: a second attempt only starts if the first was quick.
const ATTEMPT_BUDGET_MS = 30_000

// One request, one retry when the answer is not valid. A null from the client (no key, or the call failed after its own retries) ends it.
export async function generateAiResult(input: AiInput, request: typeof requestLlmJson = requestLlmJson): Promise<AiResult | null> {
  const system = buildSystemPrompt()
  const user = buildUserPrompt(input)
  const start = Date.now()
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await request(system, user)
    if (!res) return null
    const parsed = parseAiResult(res.json, input, res.model)
    if (parsed) return parsed
    if (Date.now() - start > ATTEMPT_BUDGET_MS) return null
  }
  return null
}
