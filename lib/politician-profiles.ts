import { requestLlmJson } from '@/lib/llm-news'
import type { CongressBuy } from '@/lib/congress'

export interface MemberProfile {
  party: string
  role: string
  influence: 'alta' | 'media' | 'bassa' | ''
  note: string
}

export interface MemberStats {
  purchases: number
  tickers: number
  avgPerfPct: number | null
}

const TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; value: MemberProfile }>()

const SYSTEM_PROMPT = `Sei un analista di politica americana. Ricevi un elenco di membri del Congresso USA (nome, camera, stato).
Per ciascuno descrivi chi è, solo con ciò che sai con certezza. Se non lo conosci con sicurezza, lascia i campi stringa vuoti.
Rispondi SOLO con un oggetto JSON {"profiles":[...]}; ogni elemento ha:
- name: il nome esattamente come ricevuto
- party: "Democratico" | "Repubblicano" | "Indipendente" | ""
- role: ruolo e commissioni principali in italiano, max 90 caratteri (es. "Senatore, commissione Bilancio e Finanze")
- influence: "alta" (leadership, presidenti di commissione, commissioni su finanza/energia/difesa/tecnologia) | "media" | "bassa" | "" se non lo sai
- note: 1 frase in italiano, max 160 caratteri, su come la sua posizione può dargli informazioni utili sui settori che regola; senza accuse né speculazioni.`

export function memberStats(buys: CongressBuy[]): Map<string, MemberStats> {
  const by = new Map<string, { purchases: number; tickers: Set<string>; perfs: number[] }>()
  for (const b of buys) {
    const e = by.get(b.member) ?? { purchases: 0, tickers: new Set<string>(), perfs: [] }
    e.purchases += 1
    e.tickers.add(b.ticker)
    if (b.perfPct !== null) e.perfs.push(b.perfPct)
    by.set(b.member, e)
  }
  return new Map([...by].map(([m, e]) => [m, { purchases: e.purchases, tickers: e.tickers.size, avgPerfPct: e.perfs.length ? e.perfs.reduce((a, b) => a + b, 0) / e.perfs.length : null }]))
}

export function parseProfiles(raw: unknown): Map<string, MemberProfile> {
  const list = (raw as { profiles?: unknown } | null)?.profiles
  const out = new Map<string, MemberProfile>()
  if (!Array.isArray(list)) return out
  for (const p of list) {
    const r = p as Record<string, unknown>
    if (typeof r?.name !== 'string') continue
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const influence = r.influence === 'alta' || r.influence === 'media' || r.influence === 'bassa' ? r.influence : ''
    out.set(r.name, { party: str(r.party, 20), role: str(r.role, 120), influence, note: str(r.note, 220) })
  }
  return out
}

export async function getMemberProfiles(members: Array<{ member: string; chamber: string; state: string }>): Promise<Map<string, MemberProfile>> {
  const result = new Map<string, MemberProfile>()
  const missing: typeof members = []
  for (const m of members) {
    const hit = cache.get(m.member)
    if (hit && Date.now() - hit.at < TTL_MS) result.set(m.member, hit.value)
    else missing.push(m)
  }
  if (missing.length === 0) return result
  // Small batches: the LLM output budget is limited, and a truncated JSON would lose every profile.
  const batches: (typeof missing)[] = []
  for (let i = 0; i < missing.length; i += 8) batches.push(missing.slice(i, i + 8))
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const lines = batch.map((m) => `- ${m.member} (${m.chamber === 'senate' ? 'Senato' : 'Camera'}${m.state ? `, ${m.state}` : ''})`).join('\n')
        const res = await requestLlmJson(SYSTEM_PROMPT, lines)
        if (!res) return
        for (const [name, value] of parseProfiles(res.json)) {
          result.set(name, value)
          cache.set(name, { at: Date.now(), value })
        }
      } catch {
        // profiles are optional: the tooltip still shows the track record from the filings
      }
    })
  )
  return result
}
