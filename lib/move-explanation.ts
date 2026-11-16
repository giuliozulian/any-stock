import { prisma } from './db'
import { getCompanyNews, type FinnhubNewsItem } from './finnhub'
import { isLlmConfigured, requestLlmJson } from './llm-news'

export interface MoveExplanationResult {
  explanation: string
  confidence: 'clear' | 'uncertain'
  model: string
}

const MAX_HEADLINES = 8
const NEWS_WINDOW_DAYS = 3
export const MAX_EXPLAINED_PER_PAGE = 5

const SYSTEM_PROMPT = `Sei un analista che spiega a un investitore non esperto perché un titolo si è mosso molto oggi.
Ricevi la variazione e le ultime notizie sul titolo. Usa SOLO quelle notizie: non inventare cause, numeri o fatti.
Se le notizie non spiegano il movimento, dillo chiaramente invece di ipotizzare, e usa confidence "uncertain".
Non fare previsioni di prezzo e non dare consigli di acquisto o vendita.
Rispondi SOLO con un oggetto JSON con questi campi:
- explanation: una o due frasi in italiano, massimo 240 caratteri
- confidence: "clear" se almeno una notizia spiega chiaramente il movimento, altrimenti "uncertain"`

export function buildMovePrompt(symbol: string, name: string, changePct: number, news: FinnhubNewsItem[]): string {
  const lines = news.slice(0, MAX_HEADLINES).map((n) => {
    const date = new Date(n.datetime * 1000).toISOString().slice(0, 10)
    const summary = n.summary ? ` — ${n.summary.slice(0, 200)}` : ''
    return `- [${date}] ${n.headline}${summary}`
  })
  return [
    `Titolo: ${name} (${symbol})`,
    `Variazione di oggi: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`,
    lines.length > 0 ? `Notizie recenti:\n${lines.join('\n')}` : 'Notizie recenti: nessuna trovata.',
  ].join('\n')
}

export function parseMoveExplanation(raw: unknown, model: string): MoveExplanationResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const explanation = typeof r.explanation === 'string' ? r.explanation.trim() : ''
  if (!explanation) return null
  return {
    explanation: explanation.slice(0, 320),
    confidence: r.confidence === 'clear' ? 'clear' : 'uncertain',
    model,
  }
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export async function getMoveExplanations(symbols: string[], now: Date = new Date()) {
  const rows = await prisma.moveExplanation.findMany({ where: { day: dayKey(now), symbol: { in: symbols } } })
  return new Map(rows.map((r) => [r.symbol, r]))
}

async function explainOne(m: { symbol: string; name: string; changePct: number }, now: Date): Promise<void> {
  const from = new Date(now.getTime() - NEWS_WINDOW_DAYS * 86_400_000)
  const news = await getCompanyNews(m.symbol, dayKey(from), dayKey(now)).catch(() => [])
  const result = await requestLlmJson(SYSTEM_PROMPT, buildMovePrompt(m.symbol, m.name, m.changePct, news))
  const parsed = result ? parseMoveExplanation(result.json, result.model) : null
  if (!parsed) return
  const data = { changePct: m.changePct, explanation: parsed.explanation, confidence: parsed.confidence, model: parsed.model, generatedAt: new Date() }
  await prisma.moveExplanation.upsert({
    where: { symbol_day: { symbol: m.symbol, day: dayKey(now) } },
    create: { symbol: m.symbol, day: dayKey(now), ...data },
    update: data,
  })
}

// Genera in sequenza le spiegazioni mancanti per i primi movimenti: serve chiamarla fuori dal rendering della pagina.
export async function ensureMoveExplanations(
  movers: Array<{ symbol: string; name: string; changePct: number }>,
  now: Date = new Date()
): Promise<void> {
  if (!isLlmConfigured()) return
  const top = movers.slice(0, MAX_EXPLAINED_PER_PAGE)
  const existing = await getMoveExplanations(top.map((m) => m.symbol), now)
  for (const m of top) {
    if (existing.has(m.symbol)) continue
    try {
      await explainOne(m, now)
    } catch (err) {
      console.error(`Move explanation failed for ${m.symbol}:`, err instanceof Error ? err.message : err)
    }
  }
}
