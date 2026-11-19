import { createHash } from 'node:crypto'
import type { InsiderCluster } from './insiders'
import { isLlmConfigured, requestLlmJson } from './llm-news'
import { sharedCache } from './shared-cache'

export interface ClusterNoteInput {
  symbol: string
  name: string
  marketCap: number | null
  cluster: InsiderCluster
}

const PROMPT_VERSION = 1
const MAX_CHARS = 420
const TTL_MS = 3 * 24 * 60 * 60 * 1000
const cache = sharedCache<{ at: number; note: string }>('cluster-note')

const SYSTEM_PROMPT = `Sei un analista azionario prudente che spiega a un investitore non esperto perché un gruppo di dirigenti sta comprando azioni della propria società.
Ricevi solo i dati degli acquisti (chi, ruolo, quando, quanto). Usa SOLO quei dati: non inventare notizie, risultati, catalizzatori o numeri che non sono forniti; non fare previsioni di prezzo e non dare consigli di acquisto o vendita.
Spiega cosa dicono questi acquisti: quante persone, quanto sono in alto nella società, se l'importo è grande rispetto alla società, se sono concentrati in pochi giorni, se qualcuno ha comprato più volte. Se i dati sono deboli (importi piccoli, solo consiglieri) dillo.
Rispondi SOLO con un oggetto JSON con un campo: note, in italiano, una o due frasi, massimo ${MAX_CHARS} caratteri.`

const usd = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)} milioni di dollari` : `${Math.round(v / 1_000)} mila dollari`)

export function buildClusterNoteContext(input: ClusterNoteInput): string {
  const { cluster } = input
  const lines = [
    `Società: ${input.name} (${input.symbol})${input.marketCap ? `, capitalizzazione ${usd(input.marketCap)}` : ''}`,
    `Acquisti sul mercato dal ${cluster.from} al ${cluster.to}: ${cluster.insiders} insider, ${cluster.purchases} operazioni, totale ${usd(cluster.total)}${input.marketCap ? ` (${((cluster.total / input.marketCap) * 100).toFixed(3)}% della capitalizzazione)` : ''}`,
    `Il più grosso: ${cluster.lead.name}${cluster.lead.role ? ` (${cluster.lead.role})` : ''}, ${usd(cluster.lead.value)}`,
    'Operazioni:',
    ...cluster.trades.map((t) => `- ${t.date} ${t.name}${t.role ? ` (${t.role})` : ''}: ${Math.round(t.shares)} azioni a ${t.price.toFixed(2)} dollari = ${usd(t.value)}`),
  ]
  return lines.join('\n')
}

export function parseClusterNote(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const note = (raw as Record<string, unknown>).note
  if (typeof note !== 'string' || note.trim().length === 0) return null
  return note.trim().slice(0, MAX_CHARS + 60)
}

// Why these insiders are buying, read from the purchases alone. Cached per symbol and per exact set of trades, so a new purchase rewrites it and nothing else does. Null when no model is configured or it fails.
export async function getClusterNote(input: ClusterNoteInput): Promise<string | null> {
  if (!isLlmConfigured()) return null
  const context = buildClusterNoteContext(input)
  const key = `${input.symbol}:${createHash('sha256').update(`cn${PROMPT_VERSION}:${context}`).digest('hex').slice(0, 24)}`
  const hit = await cache.get(key, TTL_MS)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.note

  const result = await requestLlmJson(SYSTEM_PROMPT, context)
  const note = result ? parseClusterNote(result.json) : null
  if (note) await cache.set(key, { at: Date.now(), note })
  return note
}
