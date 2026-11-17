import { prisma } from './db'
import { isLlmConfigured, requestLlmJson } from './llm-news'

export type CandidateVerdict = 'solid' | 'caution'

export interface CandidateReview {
  verdict: CandidateVerdict
  note: string
}

export const REVIEW_TOP_N = 8

const SYSTEM_PROMPT = `Sei un analista prudente che rilegge i candidati trovati da uno scanner automatico di titoli e segnala i falsi positivi.
Ricevi i punteggi (0-100) e la motivazione generata dallo scanner. Valuta se il punteggio alto è davvero giustificato dai dati.
Il punteggio è la media di tre pilastri: Persone (insider e politici), Qualità (conti) e Momento (c'è ancora tempo? trimestrale vicina?). Un pilastro «n.d.» non è stato misurato e non entra nella media.
Segnali tipici di falso positivo: acquisti dei politici di piccola entità o di un solo parlamentare, un solo insider, dati incompleti, punteggio alto che poggia su un solo pilastro, conti deboli compensati da un solo segnale, trimestrale imminente.
Usa SOLO i dati forniti: non inventare numeri o fatti, non fare previsioni di prezzo, non dare consigli di acquisto.
Rispondi SOLO con un oggetto JSON con questi campi:
- verdict: "solid" se i segnali si rafforzano a vicenda, "caution" se il punteggio è gonfiato o poggia su un solo segnale debole
- note: una o due frasi in italiano, massimo 220 caratteri, che dicono perché`

export function parseCandidateReview(raw: unknown): CandidateReview | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const note = typeof r.note === 'string' ? r.note.trim() : ''
  if (!note || (r.verdict !== 'solid' && r.verdict !== 'caution')) return null
  return { verdict: r.verdict, note: note.slice(0, 300) }
}

export function buildReviewPrompt(c: {
  symbol: string
  name: string
  market: string
  score: number
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  partial: boolean
  reason: string
  flags?: string[]
}): string {
  const pillar = (v: number) => (v < 0 ? 'n.d.' : String(v))
  return [
    `Titolo: ${c.name} (${c.symbol}), mercato ${c.market}`,
    `Punteggio totale ${c.score}/100: persone ${pillar(c.insiderScore)}, qualità ${pillar(c.fundamentalsScore)}, momento ${pillar(c.momentumScore)}`,
    c.flags && c.flags.length > 0 ? `Avvisi: ${c.flags.join('; ')}` : null,
    c.partial ? 'Dati incompleti: alcune fonti non hanno risposto.' : null,
    `Motivazione dello scanner:\n${c.reason}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// Rilegge i primi candidati dopo lo scan; gli errori sul singolo titolo non fermano gli altri.
export async function reviewTopCandidates(limit: number = REVIEW_TOP_N): Promise<number> {
  if (!isLlmConfigured()) return 0
  const top = await prisma.discoveredCandidate.findMany({
    where: { dismissedAt: null },
    orderBy: { score: 'desc' },
    take: limit,
  })
  let reviewed = 0
  for (const c of top) {
    if (c.aiCheckedAt && c.aiCheckedAt >= c.scannedAt) continue
    try {
      const result = await requestLlmJson(SYSTEM_PROMPT, buildReviewPrompt(c))
      const review = result ? parseCandidateReview(result.json) : null
      if (!review) continue
      await prisma.discoveredCandidate.update({
        where: { id: c.id },
        data: { aiVerdict: review.verdict, aiNote: review.note, aiCheckedAt: new Date() },
      })
      reviewed++
    } catch (err) {
      console.error(`Candidate review failed for ${c.symbol}:`, err instanceof Error ? err.message : err)
    }
  }
  return reviewed
}
