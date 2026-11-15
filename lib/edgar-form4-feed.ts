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
