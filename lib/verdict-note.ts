import type { FairValueResult } from './fair-value'
import { createHash } from 'node:crypto'
import { prisma } from './db'
import { evaluateStock, type Evaluation } from './evaluate'
import { isLlmConfigured, requestLlmJson } from './llm-news'

export interface VerdictNoteInput {
  stock: { symbol: string; name: string }
  price: number
  changePct: number
  peRatio: number | null
  week52Low: number | null
  week52High: number | null
  evaluation: Evaluation
  newsTone: string | null
}

export interface VerdictNoteResult {
  headline: string
  body: string
  watchFor: string[]
  model: string
}

const PROMPT_VERSION = 2
const MAX_WATCH = 3

const SYSTEM_PROMPT = `Sei un analista azionario prudente che spiega a un investitore non esperto perché un titolo ha ricevuto certi segnali.
Ricevi i dati già calcolati dall'app (momentum, giudizio degli analisti, solidità dei conti, valore equo, impatto delle notizie). Spiega in parole semplici perché i segnali sono questi e cosa pesa di più.
Usa SOLO i dati forniti: non inventare numeri o fatti, non fare previsioni di prezzo, non dare consigli di acquisto o vendita. Se un dato manca, dillo senza supporlo.
Rispondi SOLO con un oggetto JSON con questi campi:
- headline: una frase in italiano che riassume il quadro, massimo 110 caratteri
- body: spiegazione in italiano, 2 paragrafi separati da una riga vuota (circa 500-800 caratteri in tutto): (1) cosa dicono i segnali e quale pesa di più; (2) dove i segnali non concordano o cosa manca
- watchFor: da 0 a 3 cose da tenere d'occhio nelle prossime settimane, in italiano, massimo 140 caratteri ciascuna`

const num = (v: number | null, digits = 2) => (v === null ? 'n.d.' : v.toFixed(digits))

function buildUserPrompt(i: VerdictNoteInput): string {
  const e = i.evaluation
  return [
    `Titolo: ${i.stock.name} (${i.stock.symbol})`,
    `Prezzo $${num(i.price)}, variazione ultima chiusura ${num(i.changePct)}%, P/E ${num(i.peRatio, 1)}, range 52 settimane $${num(i.week52Low)}-$${num(i.week52High)}`,
    `Breve termine (momentum): ${e.shortTerm.label}. ${e.shortTerm.note}`,
    `Medio termine (analisti): ${e.mediumTerm.label}. ${e.mediumTerm.note}`,
    `Lungo termine (solidità dei conti): ${e.longTerm.label}. ${e.longTerm.note}`,
    `Conti: PEG ${num(e.details.pegRatio)}, ROE ${num(e.details.roe, 1)}%, debito/capitale ${num(e.details.debtToEquity)}, margine netto ${num(e.details.netMargin, 1)}%`,
    `Valore equo: ${e.fairValue.note}`,
    `Notizie: ${e.newsImpact.note}`,
    i.newsTone ? `Tono delle notizie e dei video: ${i.newsTone}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function computeVerdictNoteHash(input: VerdictNoteInput): string {
  const e = input.evaluation
  const payload = {
    v: PROMPT_VERSION,
    symbol: input.stock.symbol,
    labels: [e.shortTerm.label, e.mediumTerm.label, e.longTerm.label],
    notes: [e.shortTerm.note, e.mediumTerm.note, e.longTerm.note, e.newsImpact.note],
    // Only the verdict of the fair value, not its numbers: they follow every price tick and would regenerate the note on each refresh.
    fairValue: [e.fairValue.position, e.fairValue.reliable],
    details: e.details,
    newsTone: input.newsTone,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function parseVerdictNote(raw: unknown, model: string): VerdictNoteResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const headline = typeof r.headline === 'string' ? r.headline.trim() : ''
  const body = typeof r.body === 'string' ? r.body.trim() : ''
  if (!headline || !body) return null

  const watchFor = Array.isArray(r.watchFor)
    ? r.watchFor
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().slice(0, 200))
        .slice(0, MAX_WATCH)
    : []

  return { headline: headline.slice(0, 160), body: body.slice(0, 1400), watchFor, model }
}

export async function generateVerdictNote(input: VerdictNoteInput): Promise<VerdictNoteResult | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(input))
  if (!result) return null
  return parseVerdictNote(result.json, result.model)
}

export type VerdictNoteStatus = 'skipped' | 'unchanged' | 'updated' | 'failed'

// Raccoglie i dati già calcolati dall'app su cui l'IA può commentare; condiviso dalle note IA del titolo.
export async function loadVerdictInput(stockId: string, fairValue: FairValueResult | null = null): Promise<VerdictNoteInput | null> {
  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      news: { orderBy: { publishedAt: 'desc' }, take: 20, include: { analysis: true } },
      recommendations: { orderBy: { period: 'desc' }, take: 2 },
      insight: true,
    },
  })
  const latest = stock?.snapshots[0]
  if (!stock || !latest) return null

  const earliest = await prisma.priceSnapshot.findFirst({
    where: { stockId },
    orderBy: { timestamp: 'asc' },
  })

  const evaluation = evaluateStock({
    latestSnapshot: latest,
    earliestSnapshot: earliest ? { price: earliest.price, timestamp: earliest.timestamp } : null,
    fairValue,
    newsAnalyses: stock.news.flatMap((n) => (n.analysis ? [{ ...n.analysis, publishedAt: n.publishedAt }] : [])),
    recentRecommendations: stock.recommendations,
  })

  return {
    stock: { symbol: stock.symbol, name: stock.name },
    price: latest.price,
    changePct: latest.changePct,
    peRatio: latest.peRatio,
    week52Low: latest.week52Low,
    week52High: latest.week52High,
    evaluation,
    newsTone: stock.insight?.verdict ?? null,
  }
}

export { buildUserPrompt as buildVerdictContext }

// Spiega a parole il verdetto calcolato dall'app: l'IA non produce numeri, commenta quelli già presenti.
export async function refreshVerdictNote(stockId: string, fairValue: FairValueResult | null = null): Promise<VerdictNoteStatus> {
  if (!isLlmConfigured()) return 'skipped'

  const input = await loadVerdictInput(stockId, fairValue)
  if (!input) return 'skipped'

  const existing = await prisma.stockVerdictNote.findUnique({ where: { stockId }, select: { inputHash: true } })
  const inputHash = computeVerdictNoteHash(input)
  if (existing?.inputHash === inputHash) return 'unchanged'

  const result = await generateVerdictNote(input)
  if (!result) return 'failed'

  const data = {
    headline: result.headline,
    body: result.body,
    watchFor: result.watchFor,
    model: result.model,
    inputHash,
    generatedAt: new Date(),
  }
  await prisma.stockVerdictNote.upsert({ where: { stockId }, create: { stockId, ...data }, update: data })
  return 'updated'
}
