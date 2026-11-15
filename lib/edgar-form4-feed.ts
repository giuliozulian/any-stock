import { getTickerByCik } from './edgar-roles'

const UA = 'any-stock/1.0 (personal watchlist app)'

export interface Form4FeedEntry {
  cik: number
  companyName: string
  accessionNumber: string
}

// One <entry> of the EDGAR "getcurrent" Atom feed, e.g.:
// <title>4 - AAA INC (0000000001) (Reporting)</title>
// <id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id>
export function parseFeedEntries(atomXml: string): Form4FeedEntry[] {
  const entries: Form4FeedEntry[] = []
  const blocks = atomXml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  for (const block of blocks) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    const accessionNumber = block.match(/accession-number=([\d-]+)/)?.[1]
    const cikMatch = title?.match(/\((\d+)\)/)
    if (!title || !accessionNumber || !cikMatch) continue
    const companyName = title
      .replace(/^\d+\s*-\s*/, '')
      .replace(/\s*\(\d+\).*$/, '')
      .trim()
    entries.push({ cik: Number(cikMatch[1]), companyName, accessionNumber })
  }
  return entries
}

export interface Form4Transaction {
  insiderName: string
  code: string
}

// Owner name and transaction code(s) of a Form 4. A filing with several rows (e.g. a sale and a purchase in the same document) is treated as a purchase if ANY row is code P — reading only the first row would miss real purchases that happen to be listed second.
export function parseForm4Transaction(xml: string): Form4Transaction | null {
  const insiderName = xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/)?.[1]?.trim()
  if (!insiderName) return null
  const codes = [...xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<transactionCode>([^<]*)<\/transactionCode>/g)].map((m) => m[1]?.trim()).filter((c): c is string => Boolean(c))
  if (codes.length === 0) return null
  return { insiderName, code: codes.includes('P') ? 'P' : codes[0] }
}

export interface Form4ClusterSeed {
  symbol: string
  name: string
  buyerCount: number
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return res.text()
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// Market-wide insider-cluster seeds: symbols with at least `minBuyers` distinct insiders filing an open-market purchase (code P) among the `limit` most recent Form 4 filings on EDGAR, across every company — not just symbols already tracked elsewhere. Returns [] when the feed itself is unreachable; one bad filing is skipped without affecting the others.
export async function getForm4ClusterSeeds(limit = 100, minBuyers = 2, overallDeadlineMs = 15000): Promise<Form4ClusterSeed[]> {
  let atomXml: string
  try {
    atomXml = await fetchText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=${limit}&output=atom`)
  } catch (err) {
    console.error('Form4 cluster feed failed:', err instanceof Error ? err.message : String(err))
    return []
  }
  // Dedup by accession number: safe regardless of whether the feed ever lists one filing under two entries (e.g. issuer and insider CIK) — a true duplicate is fetched once, and a feed with no duplicates is unaffected.
  const entries = [...new Map(parseFeedEntries(atomXml).map((e) => [e.accessionNumber, e])).values()]

  const bySymbol = new Map<string, { name: string; buyers: Set<string> }>()
  const fanOut = runWithConcurrency(entries, 5, async (entry) => {
    const symbol = await getTickerByCik(entry.cik).catch(() => null)
    if (!symbol) return
    // The complete-submission .txt file has a deterministic name (CIK + dashed accession number) and embeds the primary document's XML inline — no per-filing-agent document filename to guess (Form 4 XML filenames vary; see lib/edgar-roles.ts's getInsiderRoles, which reads the real filename from the submissions API for the same reason).
    let xml: string
    try {
      xml = await fetchText(`https://www.sec.gov/Archives/edgar/data/${entry.cik}/${entry.accessionNumber}.txt`)
    } catch {
      return
    }
    const transaction = parseForm4Transaction(xml)
    if (!transaction || transaction.code !== 'P') return
    const existing = bySymbol.get(symbol) ?? { name: entry.companyName, buyers: new Set<string>() }
    existing.buyers.add(transaction.insiderName)
    bySymbol.set(symbol, existing)
  })

  // Each worker already timed out individually (fetchText's AbortSignal); this overall deadline bounds the whole batch, so a scan never blocks on SEC past it — bySymbol holds whatever finished in time, and that partial result is returned.
  await Promise.race([fanOut, new Promise<void>((resolve) => setTimeout(resolve, overallDeadlineMs))])

  return [...bySymbol.entries()]
    .map(([symbol, { name, buyers }]) => ({ symbol, name, buyerCount: buyers.size }))
    .filter((s) => s.buyerCount >= minBuyers)
    .sort((a, b) => b.buyerCount - a.buyerCount)
}
