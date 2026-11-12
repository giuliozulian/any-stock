import { createHash } from 'node:crypto'
import { prisma } from './db'
import { isLlmConfigured, requestLlmJson } from './llm-news'
import { getRecentVideos } from './youtube'

export type Verdict = 'positive' | 'neutral' | 'negative'
export type Confidence = 'low' | 'medium' | 'high'

export interface InsightInput {
  stock: { symbol: string; name: string }
  news: { headline: string; source: string; publishedAt: Date; summary: string | null }[]
  videos: { title: string; channel: string; publishedAt: string }[]
}

export interface InsightResult {
  summary: string
  verdict: Verdict
  score: number
  keyPoints: string[]
  risks: string[]
  confidence: Confidence
  model: string
}

const MAX_NEWS = 10
const MAX_VIDEOS = 6
const MAX_LIST = 4
const SUMMARY_CHARS = 400

const SYSTEM_PROMPT = `Sei un analista azionario prudente. Ricevi le ultime notizie e i titoli dei video YouTube recenti su un titolo quotato.
Scrivi un riassunto e una valutazione complessiva, solo in base al contenuto fornito. Non inventare fatti e non fare previsioni di prezzo.
Le notizie sono più affidabili dei video: i video sono opinioni di terzi, usali solo come segnale di sentiment e pesali meno.
Se il materiale è scarso o non riguarda davvero il titolo, usa verdict "neutral" e confidence "low".
Rispondi SOLO con un oggetto JSON con questi campi:
- summary: riassunto in italiano di massimo 2 frasi brevi (circa 250 caratteri) che dice cosa emerge da notizie e video e come valutarli per il titolo, parole semplici
- verdict: "positive" | "neutral" | "negative" (tono complessivo del materiale per il titolo)
- score: intero da 1 (segnale debolissimo) a 5 (segnale molto forte) sulla forza del verdetto
- keyPoints: da 1 a 4 punti chiave in italiano, ciascuno massimo 140 caratteri
- risks: da 0 a 4 rischi o incognite in italiano, ciascuno massimo 140 caratteri
- confidence: "low" | "medium" | "high" (quanto il materiale basta a giudicare)`

export function buildInsightInput(
  stock: { symbol: string; name: string },
  news: InsightInput['news'],
  videos: { title: string; channel: string; publishedAt: string }[],
): InsightInput {
  return {
    stock: { symbol: stock.symbol, name: stock.name },
    news: news.slice(0, MAX_NEWS).map((n) => ({
      headline: n.headline,
      source: n.source,
      publishedAt: n.publishedAt,
      summary: n.summary ? n.summary.slice(0, SUMMARY_CHARS) : null,
    })),
    videos: videos
      .slice(0, MAX_VIDEOS)
      .map((v) => ({ title: v.title, channel: v.channel, publishedAt: v.publishedAt })),
  }
}

export function computeInputHash(input: InsightInput): string {
  const payload = {
    symbol: input.stock.symbol,
    news: input.news.map((n) => [n.headline, n.publishedAt.toISOString(), n.summary]),
    // L'ordine per rilevanza di YouTube può cambiare senza che cambi il contenuto.
    videos: input.videos
      .map((v) => [v.title, v.channel, v.publishedAt])
      .sort((a, b) => a.join('|').localeCompare(b.join('|'))),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function stringList(value: unknown, min: number): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 200))
    .slice(0, MAX_LIST)
  return items.length >= min ? items : null
}

export function parseInsight(raw: unknown, model: string): InsightResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const summary = typeof r.summary === 'string' ? r.summary.trim() : ''
  const score = typeof r.score === 'number' ? Math.round(r.score) : NaN
  const keyPoints = stringList(r.keyPoints, 1)
  const risks = stringList(r.risks, 0)

  if (summary.length === 0) return null
  if (r.verdict !== 'positive' && r.verdict !== 'neutral' && r.verdict !== 'negative') return null
  if (r.confidence !== 'low' && r.confidence !== 'medium' && r.confidence !== 'high') return null
  if (!Number.isFinite(score) || score < 1 || score > 5) return null
  if (!keyPoints || !risks) return null

  return { summary: summary.slice(0, 600), verdict: r.verdict, score, keyPoints, risks, confidence: r.confidence, model }
}

function buildUserPrompt({ stock, news, videos }: InsightInput): string {
  const newsLines = news.map(
    (n) => `- [${n.publishedAt.toISOString().slice(0, 10)}] ${n.source}: ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`,
  )
  const videoLines = videos.map((v) => `- [${v.publishedAt.slice(0, 10)}] ${v.channel}: ${v.title}`)
  return [
    `Titolo: ${stock.name} (${stock.symbol})`,
    `Notizie recenti:\n${newsLines.length ? newsLines.join('\n') : '(nessuna)'}`,
    `Video YouTube recenti (solo titoli):\n${videoLines.length ? videoLines.join('\n') : '(nessuno)'}`,
  ].join('\n\n')
}

export async function generateInsight(input: InsightInput): Promise<InsightResult | null> {
  const result = await requestLlmJson(SYSTEM_PROMPT, buildUserPrompt(input))
  if (!result) return null
  return parseInsight(result.json, result.model)
}

export type InsightStatus = 'skipped' | 'unchanged' | 'updated' | 'failed'

// Un errore YouTube non blocca: si procede con le sole news. Gli errori LLM si propagano al chiamante.
export async function refreshStockInsight(stockId: string): Promise<InsightStatus> {
  if (!isLlmConfigured()) return 'skipped'

  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    include: { news: { orderBy: { publishedAt: 'desc' }, take: MAX_NEWS }, insight: true },
  })
  if (!stock) return 'skipped'

  const videos = await getRecentVideos(stock.symbol, stock.name).catch(() => [])
  if (stock.news.length === 0 && videos.length === 0) return 'skipped'

  const input = buildInsightInput(stock, stock.news, videos)
  const inputHash = computeInputHash(input)
  if (stock.insight?.inputHash === inputHash) return 'unchanged'

  const result = await generateInsight(input)
  if (!result) return 'failed'

  const data = {
    summary: result.summary,
    verdict: result.verdict,
    score: result.score,
    keyPoints: result.keyPoints,
    risks: result.risks,
    confidence: result.confidence,
    model: result.model,
    inputHash,
    generatedAt: new Date(),
  }
  await prisma.stockInsight.upsert({ where: { stockId }, create: { stockId, ...data }, update: data })
  return 'updated'
}
