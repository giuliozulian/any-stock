import { createHash } from 'node:crypto'
import { prisma } from './db'
import { getEarningsSurprises, type EarningsSurprise } from './finnhub'
import { getAnnualFinancials, type YearFinancials } from './fundamentals'
import { isLlmConfigured, requestLlmJson } from './llm-news'

export interface EarningsNoteInput {
  stock: { symbol: string; name: string }
  surprises: EarningsSurprise[]
  years: YearFinancials[]
  nextEarnings: { date: string; epsEstimate: number | null } | null
}

export interface EarningsNoteResult {
  headline: string
  body: string
  watchFor: string[]
  model: string
}

const PROMPT_VERSION = 1
const MAX_YEARS = 3
const MAX_WATCH = 3

const SYSTEM_PROMPT = `Sei un analista azionario prudente che spiega a un investitore non esperto come stanno andando i conti di un'azienda.
Ricevi gli ultimi trimestri (utile per azione reale contro la stima degli analisti), i bilanci annuali recenti e la data della prossima trimestrale.
Spiega in parole semplici cosa è cambiato rispetto ai periodi precedenti, se l'azienda ha battuto o mancato le attese e quanto, e come si muovono ricavi, utili e margini.
Usa SOLO i dati forniti: non inventare numeri, non commentare il tono del management (non hai le trascrizioni), non fare previsioni di prezzo né consigli. Se un dato manca, dillo.
Rispondi SOLO con un oggetto JSON con questi campi:
- headline: una frase in italiano che riassume l'andamento dei conti, massimo 110 caratteri
- body: spiegazione in italiano, 2 paragrafi separati da una riga vuota (circa 500-800 caratteri in tutto): (1) gli ultimi trimestri contro le attese; (2) la tendenza di ricavi, utili e margini negli anni
- watchFor: da 0 a 3 cose da guardare alla prossima trimestrale, in italiano, massimo 140 caratteri ciascuna`

const num = (v: number | null, digits = 2) => (v === null ? 'n.d.' : v.toFixed(digits))
const bn = (v: number | null) => (v === null ? 'n.d.' : `${(v / 1e9).toFixed(2)} mld $`)

function buildUserPrompt({ stock, surprises, years, nextEarnings }: EarningsNoteInput): string {
  const q = surprises.map(
    (s) => `- trimestre al ${s.period}: EPS reale ${num(s.actual)} contro stima ${num(s.estimate)} (sorpresa ${num(s.surprisePercent, 1)}%)`,
  )
  const y = years.map((r) => {
    const margin = r.revenue && r.netIncome !== null ? `${((r.netIncome / r.revenue) * 100).toFixed(1)}%` : 'n.d.'
    return `- ${r.year}: ricavi ${bn(r.revenue)}, utile netto ${bn(r.netIncome)}, margine netto ${margin}, flusso di cassa operativo ${bn(r.operatingCashFlow)}`
  })
  return [
    `Titolo: ${stock.name} (${stock.symbol})`,
    `Ultimi trimestri:\n${q.length ? q.join('\n') : '(nessun dato)'}`,
    `Bilanci annuali (dal più recente):\n${y.length ? y.join('\n') : '(nessun dato)'}`,
    nextEarnings
      ? `Prossima trimestrale: ${nextEarnings.date}${nextEarnings.epsEstimate !== null ? `, EPS atteso ${num(nextEarnings.epsEstimate)}` : ''}`
      : 'Prossima trimestrale: data non disponibile',
  ].join('\n\n')
}

export function computeEarningsNoteHash(input: EarningsNoteInput): string {
  const payload = {
    v: PROMPT_VERSION,
    symbol: input.stock.symbol,
    surprises: input.surprises.map((s) => [s.period, s.actual, s.estimate]),
    years: input.years.map((y) => [y.year, y.revenue, y.netIncome, y.operatingCashFlow]),
    next: input.nextEarnings?.date ?? null,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function parseEarningsNote(raw: unknown, model: string): EarningsNoteResult | null {
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

export async function generateEarningsNote(input: EarningsNoteInput): Promise<EarningsNoteResult | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(input))
  if (!result) return null
  return parseEarningsNote(result.json, result.model)
}

export type EarningsNoteStatus = 'skipped' | 'unchanged' | 'updated' | 'failed'

export async function refreshEarningsNote(stockId: string): Promise<EarningsNoteStatus> {
  if (!isLlmConfigured()) return 'skipped'

  const stock = await prisma.stock.findUnique({ where: { id: stockId }, include: { earningsNote: true } })
  if (!stock) return 'skipped'

  // Una fonte che non risponde non blocca la nota: si usa quello che c'è.
  const [surprises, years] = await Promise.all([
    getEarningsSurprises(stock.symbol).catch(() => []),
    getAnnualFinancials(stock.symbol).catch(() => []),
  ])
  if (surprises.length === 0 && years.length === 0) return 'skipped'

  const input: EarningsNoteInput = {
    stock: { symbol: stock.symbol, name: stock.name },
    surprises,
    years: [...years].sort((a, b) => b.year - a.year).slice(0, MAX_YEARS),
    nextEarnings: stock.nextEarningsDate
      ? { date: stock.nextEarningsDate.toISOString().slice(0, 10), epsEstimate: stock.nextEarningsEpsEstimate }
      : null,
  }

  const inputHash = computeEarningsNoteHash(input)
  if (stock.earningsNote?.inputHash === inputHash) return 'unchanged'

  const result = await generateEarningsNote(input)
  if (!result) return 'failed'

  const data = {
    headline: result.headline,
    body: result.body,
    watchFor: result.watchFor,
    model: result.model,
    inputHash,
    generatedAt: new Date(),
  }
  await prisma.stockEarningsNote.upsert({ where: { stockId }, create: { stockId, ...data }, update: data })
  return 'updated'
}
