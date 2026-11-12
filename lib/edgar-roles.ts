const TTL_MS = 24 * 60 * 60 * 1000
const UA = 'any-stock/1.0 (personal watchlist app)'
const roleCache = new Map<string, { at: number; roles: Record<string, string | null> }>()
let tickerMap: { at: number; map: Map<string, number> } | null = null

async function secJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return (await res.json()) as T
}

async function getCik(symbol: string): Promise<number | null> {
  if (!tickerMap || Date.now() - tickerMap.at > TTL_MS) {
    const data = await secJson<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json')
    tickerMap = { at: Date.now(), map: new Map(Object.values(data).map((v) => [v.ticker.toUpperCase(), v.cik_str])) }
  }
  return tickerMap.map.get(symbol.toUpperCase()) ?? null
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
            const res = await fetch(`https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${doc}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
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
