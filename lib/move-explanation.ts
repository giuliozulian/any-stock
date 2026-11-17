import { prisma } from './db'
import { getCompanyNews, getReportedEarnings, type FinnhubNewsItem, type ReportedEarnings } from './finnhub'
import { requestLlmJson } from './llm-news'
import { getRecentEightK, itemLabels, type RecentFiling } from './sec-filings'

export interface MoveSource {
  title: string
  url: string
}

export interface MoveExplanationResult {
  explanation: string
  confidence: 'clear' | 'uncertain'
  model: string
  sources: MoveSource[]
}

const MAX_HEADLINES = 8
const NEWS_WINDOW_DAYS = 3
export const MAX_EXPLAINED_PER_PAGE = 5
// A stored explanation is rebuilt when the move has grown or shrunk by this many points since it was written.
const STALE_DELTA_PCT = 3

const SYSTEM_PROMPT = `Sei un analista che spiega a un investitore non esperto perché un titolo si è mosso molto nell'ultima seduta.
Ricevi la variazione, le ultime notizie numerate e, se ci sono, i documenti ufficiali depositati alla SEC. Usa SOLO quelle informazioni: non inventare cause, numeri o fatti.
Una notizia più vecchia di due giorni rispetto alla seduta spiega il movimento solo se dice chiaramente che l'evento è appena avvenuto.
Se le informazioni non spiegano il movimento, dillo chiaramente invece di ipotizzare, e usa confidence "uncertain".
Non fare previsioni di prezzo e non dare consigli di acquisto o vendita.
Rispondi SOLO con un oggetto JSON con questi campi:
- explanation: una o due frasi in italiano, massimo 240 caratteri
- confidence: "clear" se almeno una notizia o un documento spiega chiaramente il movimento, altrimenti "uncertain"
- used: elenco dei numeri delle notizie su cui si basa la spiegazione (vuoto se nessuna)`

// The trading day is the calendar day where the stock trades: a UTC date would roll over in the US afternoon and drop today's explanations.
export function tradingDay(now: Date = new Date(), timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
const previousDay = (day: string) => daysBefore(day, 1)

function formatDay(day: string): string {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

export function buildMovePrompt(symbol: string, name: string, changePct: number, news: FinnhubNewsItem[], filings: RecentFiling[] = []): string {
  const lines = news.slice(0, MAX_HEADLINES).map((n, i) => {
    const date = new Date(n.datetime * 1000).toISOString().slice(0, 10)
    const summary = n.summary ? ` — ${n.summary.slice(0, 200)}` : ''
    return `${i + 1}. [${date}] ${n.headline}${summary}`
  })
  const docs = filings.map((f) => `- [${f.date}] 8-K: ${itemLabels(f.items).join(', ') || 'altro'}`)
  return [
    `Titolo: ${name} (${symbol})`,
    `Variazione dell'ultima seduta: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`,
    lines.length > 0 ? `Notizie recenti:\n${lines.join('\n')}` : 'Notizie recenti: nessuna trovata.',
    ...(docs.length > 0 ? [`Documenti ufficiali depositati:\n${docs.join('\n')}`] : []),
  ].join('\n')
}

export function parseMoveExplanation(raw: unknown, model: string, news: FinnhubNewsItem[] = []): MoveExplanationResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const explanation = typeof r.explanation === 'string' ? r.explanation.trim() : ''
  if (!explanation) return null
  const used = Array.isArray(r.used) ? r.used : []
  const sources: MoveSource[] = []
  for (const n of used) {
    const item = typeof n === 'number' ? news.slice(0, MAX_HEADLINES)[n - 1] : undefined
    if (item?.url && !sources.some((s) => s.url === item.url)) sources.push({ title: item.headline, url: item.url })
  }
  return {
    explanation: explanation.slice(0, 320),
    confidence: r.confidence === 'clear' ? 'clear' : 'uncertain',
    model,
    sources: sources.slice(0, 3),
  }
}

// Results published today before the open, or yesterday after the close, are the likeliest reason for a move in today's session.
export function earningsMovedToday(e: ReportedEarnings, today: string): boolean {
  return (e.date === today && e.hour !== 'amc') || (e.date === previousDay(today) && e.hour === 'amc')
}

export function earningsExplanation(e: ReportedEarnings): string {
  const when = e.hour === 'amc' ? `dopo la chiusura del ${formatDay(e.date)}` : e.hour === 'bmo' ? `prima dell’apertura del ${formatDay(e.date)}` : `il ${formatDay(e.date)}`
  const head = `Ha pubblicato i risultati trimestrali ${when}`
  if (e.epsActual === null || e.epsEstimate === null) return `${head}.`
  const diff = e.epsEstimate !== 0 ? ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 100 : null
  const verdict = e.epsActual > e.epsEstimate ? 'sopra' : e.epsActual < e.epsEstimate ? 'sotto' : 'in linea con'
  const gap = diff !== null && verdict !== 'in linea con' ? ` (${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(0)}%)` : ''
  return `${head}: utile per azione ${e.epsActual.toFixed(2)} contro ${e.epsEstimate.toFixed(2)} atteso, ${verdict} le stime${gap}.`
}

export function isStale(row: { changePct: number; kind: string }, changePct: number): boolean {
  return row.kind !== 'fact' && Math.abs(row.changePct - changePct) >= STALE_DELTA_PCT
}

export async function getMoveExplanations(symbols: string[], day: string = tradingDay()) {
  const rows = await prisma.moveExplanation.findMany({ where: { day, symbol: { in: symbols } } })
  return new Map(rows.map((r) => [r.symbol, r]))
}

async function explainOne(m: { symbol: string; name: string; changePct: number }, now: Date): Promise<void> {
  const day = tradingDay(now)
  const yesterday = previousDay(day)
  const [earnings, filings, news] = await Promise.all([
    getReportedEarnings(m.symbol, yesterday, day).catch(() => []),
    getRecentEightK(m.symbol, yesterday).catch(() => null),
    getCompanyNews(m.symbol, daysBefore(day, NEWS_WINDOW_DAYS), day).catch(() => []),
  ])
  const filingSource = (filings ?? []).find((f) => f.items.includes('2.02'))
  const reported = earnings.find((e) => earningsMovedToday(e, day))
  let parsed: MoveExplanationResult | null
  let kind: 'fact' | 'ai'
  if (reported) {
    parsed = {
      explanation: earningsExplanation(reported),
      confidence: 'clear',
      model: 'dati',
      sources: filingSource ? [{ title: '8-K sui risultati (SEC)', url: filingSource.url }] : [],
    }
    kind = 'fact'
  } else {
    const result = await requestLlmJson(SYSTEM_PROMPT, buildMovePrompt(m.symbol, m.name, m.changePct, news, filings ?? []))
    parsed = result ? parseMoveExplanation(result.json, result.model, news) : null
    kind = 'ai'
  }
  if (!parsed) return
  const data = { changePct: m.changePct, explanation: parsed.explanation, confidence: parsed.confidence, model: parsed.model, kind, sources: parsed.sources as unknown as object, generatedAt: new Date() }
  await prisma.moveExplanation.upsert({
    where: { symbol_day: { symbol: m.symbol, day } },
    create: { symbol: m.symbol, day, ...data },
    update: data,
  })
}

// Explains the biggest moves that have no (or an outdated) explanation. Call it outside page rendering: it is sequential and calls an LLM.
// Earnings-driven moves are explained from the data with no LLM, so they work even when no model is configured.
export async function ensureMoveExplanations(
  movers: Array<{ symbol: string; name: string; changePct: number }>,
  now: Date = new Date()
): Promise<void> {
  const top = [...movers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, MAX_EXPLAINED_PER_PAGE)
  const existing = await getMoveExplanations(top.map((m) => m.symbol), tradingDay(now))
  for (const m of top) {
    const row = existing.get(m.symbol)
    if (row && !isStale(row, m.changePct)) continue
    try {
      await explainOne(m, now)
    } catch (err) {
      console.error(`Move explanation failed for ${m.symbol}:`, err instanceof Error ? err.message : err)
    }
  }
}
