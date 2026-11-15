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
