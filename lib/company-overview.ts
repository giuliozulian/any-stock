import { requestLlmJson } from '@/lib/llm-news'

export interface CompanyOverview {
  sector: string
  description: string
}

const TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; value: CompanyOverview }>()

const SYSTEM_PROMPT = `Sei un divulgatore finanziario. Dato un titolo quotato, spiega a un lettore non esperto che azienda è.
Usa solo ciò che sai con certezza; se non conosci l'azienda, restituisci sector e description come stringhe vuote.
Rispondi SOLO con un oggetto JSON con questi campi:
- sector: settore in italiano, 1-3 parole (es. "Semiconduttori", "Banche", "ETF tematico")
- description: 2-3 frasi in italiano, parole semplici: cosa fa l'azienda (o cosa replica l'ETF), come guadagna e perché è conosciuta. Massimo 450 caratteri.`

export function parseOverview(raw: unknown): CompanyOverview | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const sector = typeof r.sector === 'string' ? r.sector.trim() : ''
  const description = typeof r.description === 'string' ? r.description.trim() : ''
  if (!sector || !description) return null
  return { sector: sector.slice(0, 60), description: description.slice(0, 600) }
}

export async function getCompanyOverview(symbol: string, name: string, industryHint?: string): Promise<CompanyOverview | null> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  try {
    const result = await requestLlmJson(SYSTEM_PROMPT, `Titolo: ${name} (${symbol})${industryHint ? `\nSettore indicato dal data provider: ${industryHint}` : ''}`)
    const value = result ? parseOverview(result.json) : null
    if (value) cache.set(key, { at: Date.now(), value })
    return value
  } catch {
    return null
  }
}
