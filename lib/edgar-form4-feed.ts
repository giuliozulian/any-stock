import { fetchFromSec, getTickerByCik } from './edgar-roles'


export interface Form4FeedEntry {
  cik: number
  companyName: string
  accessionNumber: string
}

// One Form 4 row of an EDGAR daily form index (form.YYYYMMDD.idx), fixed-width columns:
// 4           AAA INC                                                       1         20261112    edgar/data/1/0000000001-26-000001.txt
// A filing is listed once under its issuer and once under each insider; "4/A" amendments are not purchases of their own and are skipped.
export function parseDailyIndex(idx: string): Form4FeedEntry[] {
  const entries: Form4FeedEntry[] = []
  for (const line of idx.split('\n')) {
    const m = line.match(/^4\s+(.*?)\s+(\d+)\s+\d{8}\s+edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt\s*$/)
    if (m) entries.push({ cik: Number(m[2]), companyName: m[1].trim(), accessionNumber: m[3] })
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
  const res = await fetchFromSec(url)
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

const WINDOW_DAYS = 7
const MAX_FILINGS = 600
const INDEX_TTL_MS = 6 * 60 * 60 * 1000
const indexCache = new Map<string, { at: number; entries: Form4FeedEntry[] }>()
// A filed Form 4 never changes, so what it says about its buyer is kept for the life of the instance: later scans skip the fetch.
const filingCache = new Map<string, Form4Transaction | null>()

export function resetForm4Cache(): void {
  indexCache.clear()
  filingCache.clear()
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Daily indexes live under /daily-index/{year}/QTR{n}/. Weekends and holidays have none (404) and are simply skipped.
async function getDayEntries(day: string): Promise<Form4FeedEntry[]> {
  const hit = indexCache.get(day)
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.entries
  const [year, month] = day.split('-')
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${Math.ceil(Number(month) / 3)}/form.${year}${month}${day.slice(8)}.idx`
  const res = await fetchFromSec(url)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  const entries = parseDailyIndex(await res.text())
  indexCache.set(day, { at: Date.now(), entries })
  return entries
}

// Market-wide insider-cluster seeds: symbols where at least `minBuyers` distinct insiders filed an open-market purchase (code P) over the last `windowDays` days, read from EDGAR's daily form indexes across every company — not just symbols already tracked elsewhere.
// Only symbols with at least `minBuyers` Form 4 filings can qualify, so the rest are never fetched; the most-filed symbols go first within a budget of `maxFilings` fetches. Returns [] when no index is reachable; one bad filing is skipped without affecting the others.
export async function getForm4ClusterSeeds(windowDays = WINDOW_DAYS, minBuyers = 2, overallDeadlineMs = 45000, maxFilings = MAX_FILINGS): Promise<Form4ClusterSeed[]> {
  const now = new Date()
  const days = Array.from({ length: windowDays }, (_, i) => isoDay(new Date(now.getTime() - i * 86_400_000)))
  const results = await Promise.allSettled(days.map(getDayEntries))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length === results.length) {
    console.error('Form4 daily indexes failed:', (failed[0] as PromiseRejectedResult).reason instanceof Error ? (failed[0] as PromiseRejectedResult).reason.message : String((failed[0] as PromiseRejectedResult).reason))
    return []
  }

  // A filing is listed under its issuer and under each insider, and only the issuer's CIK maps to a ticker.
  // Group by accession number so a filing is fetched once, and look for the ticker across all of its entries.
  const filings = new Map<string, Form4FeedEntry[]>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const entry of r.value) filings.set(entry.accessionNumber, [...(filings.get(entry.accessionNumber) ?? []), entry])
  }

  const bySymbolFilings = new Map<string, { entry: Form4FeedEntry; accessionNumber: string }[]>()
  await runWithConcurrency([...filings.entries()], 20, async ([accessionNumber, candidates]) => {
    for (const candidate of candidates) {
      const symbol = await getTickerByCik(candidate.cik).catch(() => null)
      if (symbol) {
        bySymbolFilings.set(symbol, [...(bySymbolFilings.get(symbol) ?? []), { entry: candidate, accessionNumber }])
        return
      }
    }
  })

  const queue: { symbol: string; entry: Form4FeedEntry; accessionNumber: string }[] = []
  for (const [symbol, list] of [...bySymbolFilings.entries()].filter(([, l]) => l.length >= minBuyers).sort((a, b) => b[1].length - a[1].length)) {
    for (const f of list) queue.push({ symbol, ...f })
  }

  const bySymbol = new Map<string, { name: string; buyers: Set<string> }>()
  const fanOut = runWithConcurrency(queue.slice(0, maxFilings), 5, async ({ symbol, entry, accessionNumber }) => {
    let transaction: Form4Transaction | null
    if (filingCache.has(accessionNumber)) transaction = filingCache.get(accessionNumber) ?? null
    else {
      try {
        // The complete-submission .txt file has a deterministic name (CIK + dashed accession number) and embeds the primary document's XML inline — no per-filing-agent document filename to guess.
        transaction = parseForm4Transaction(await fetchText(`https://www.sec.gov/Archives/edgar/data/${entry.cik}/${accessionNumber}.txt`))
      } catch {
        return
      }
      filingCache.set(accessionNumber, transaction)
    }
    if (!transaction || transaction.code !== 'P') return
    const existing = bySymbol.get(symbol) ?? { name: entry.companyName, buyers: new Set<string>() }
    existing.buyers.add(transaction.insiderName)
    bySymbol.set(symbol, existing)
  })

  // Each worker already timed out individually (fetchText's AbortSignal); this overall deadline bounds the whole batch, so a scan never blocks on SEC past it — bySymbol holds whatever finished in time, and that partial result is returned. Filings that did finish are cached, so the next scan picks up where this one stopped.
  await Promise.race([fanOut, new Promise<void>((resolve) => setTimeout(resolve, overallDeadlineMs))])

  return [...bySymbol.entries()]
    .map(([symbol, { name, buyers }]) => ({ symbol, name, buyerCount: buyers.size }))
    .filter((s) => s.buyerCount >= minBuyers)
    .sort((a, b) => b.buyerCount - a.buyerCount)
}
