import { secUserAgent } from './sec'

const TTL_MS = 24 * 60 * 60 * 1000
const roleCache = new Map<string, { at: number; roles: Record<string, string | null> }>()
let tickerMap: { at: number; map: Map<string, number>; byCik: Map<number, string> } | null = null

// The SEC allows at most 10 requests a second per address and answers 429 (blocking the address for a while) above that.
// Every call to sec.gov waits for its slot, so the parallel workers of the insider scan share one budget of ~8 requests a second.
const SEC_MIN_GAP_MS = process.env.NODE_ENV === 'test' ? 0 : 125
let nextSlot = 0

async function waitForSecSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + SEC_MIN_GAP_MS
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now))
}

// SEC rate-limits (429) under load — one retry after the Retry-After delay (or 1s if absent) turns a transient throttle into a success instead of dropping this symbol's whole lookup.
export async function fetchFromSec(url: string): Promise<Response> {
  await waitForSecSlot()
  const res = await fetch(url, { headers: { 'User-Agent': secUserAgent() }, signal: AbortSignal.timeout(10000) })
  if (res.status !== 429) return res
  const retryAfterMs = (Number(res.headers.get('Retry-After')) || 1) * 1000
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
  await waitForSecSlot()
  return fetch(url, { headers: { 'User-Agent': secUserAgent() }, signal: AbortSignal.timeout(10000) })
}

async function secJson<T>(url: string): Promise<T> {
  const res = await fetchFromSec(url)
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return (await res.json()) as T
}

// company_tickers.json ranks the primary share class first for a CIK with several (e.g. BRK.A before BRK.B) — keep that first ticker, not the last one a plain Map.set loop would leave behind.
function byCikFirstWins(entries: { cik_str: number; ticker: string }[]): Map<number, string> {
  const byCik = new Map<number, string>()
  for (const v of entries) if (!byCik.has(v.cik_str)) byCik.set(v.cik_str, v.ticker.toUpperCase())
  return byCik
}

async function ensureTickerMap(): Promise<{ map: Map<string, number>; byCik: Map<number, string> }> {
  if (!tickerMap || Date.now() - tickerMap.at > TTL_MS) {
    const data = await secJson<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json')
    const entries = Object.values(data)
    tickerMap = {
      at: Date.now(),
      map: new Map(entries.map((v) => [v.ticker.toUpperCase(), v.cik_str])),
      byCik: byCikFirstWins(entries),
    }
  }
  return tickerMap
}

export async function getCik(symbol: string): Promise<number | null> {
  const { map } = await ensureTickerMap()
  return map.get(symbol.toUpperCase()) ?? null
}

// Ticker for a CIK, from the same SEC company_tickers.json cache getCik uses. Null when the filer has no mapped ticker (fund, 13F-only filer, foreign issuer not covered by the file).
export async function getTickerByCik(cik: number): Promise<string | null> {
  const { byCik } = await ensureTickerMap()
  return byCik.get(cik) ?? null
}

// Role of the reporting owner as written in a Form 4 (officer title wins, then director, then 10% owner).
export function parseRole(xml: string): string | null {
  const rel = xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/)?.[1]
  if (!rel) return null
  const flag = (tag: string) => new RegExp(`<${tag}>\\s*(1|true)\\s*</${tag}>`, 'i').test(rel)
  const text = (tag: string) => rel.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`))?.[1] || null
  if (flag('isOfficer')) return text('officerTitle') ?? 'Officer'
  if (flag('isDirector')) return 'Director'
  if (flag('isTenPercentOwner')) return '10% Owner'
  return text('otherText') ?? null
}

// Roles by insider name, read from each insider's latest Form 4 on EDGAR. Names that cannot be resolved are null.
export async function getInsiderRoles(symbol: string, latestAccessionByName: Record<string, string>): Promise<Record<string, string | null>> {
  const key = symbol.toUpperCase()
  const hit = roleCache.get(key)
  const names = Object.keys(latestAccessionByName)
  if (hit && Date.now() - hit.at < TTL_MS && names.every((n) => n in hit.roles)) return hit.roles

  const roles: Record<string, string | null> = { ...(hit?.roles ?? {}) }
  try {
    const cik = await getCik(key)
    if (cik === null) return roles
    const sub = await secJson<{ filings: { recent: { accessionNumber: string[]; primaryDocument: string[] } } }>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)
    const docs = new Map(sub.filings.recent.accessionNumber.map((a, i) => [a, sub.filings.recent.primaryDocument[i]]))
    const todo = names.filter((n) => !(n in roles))
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(
        todo.slice(i, i + 5).map(async (name) => {
          const acc = latestAccessionByName[name]
          const doc = docs.get(acc)?.replace(/^xsl[^/]*\//, '')
          roles[name] = null
          if (!doc) return
          try {
            const res = await fetchFromSec(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${doc}`)
            if (res.ok) roles[name] = parseRole(await res.text())
          } catch {
            // role stays null
          }
        }),
      )
    }
    roleCache.set(key, { at: Date.now(), roles })
  } catch (err) {
    console.error(`Insider roles failed for ${key}:`, err instanceof Error ? err.message : String(err))
  }
  return roles
}
