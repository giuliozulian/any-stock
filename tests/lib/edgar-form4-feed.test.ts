import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseFeedEntries, parseForm4Transaction, getForm4ClusterSeeds } from '@/lib/edgar-form4-feed'
import * as edgarRoles from '@/lib/edgar-roles'

const ATOM_SAMPLE = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title>4 - AAA INC (0000000001) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id>
</entry>
<entry>
<title>4 - BBB CORP (0000000002) (Reporting)</title>
<id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000001</id>
</entry>
</feed>`

describe('parseFeedEntries', () => {
  it('extracts cik, company name and accession number from each entry', () => {
    const entries = parseFeedEntries(ATOM_SAMPLE)
    expect(entries).toEqual([
      { cik: 1, companyName: 'AAA INC', accessionNumber: '0000000001-26-000001' },
      { cik: 2, companyName: 'BBB CORP', accessionNumber: '0000000002-26-000001' },
    ])
  })

  it('skips an entry with no parseable title or accession number', () => {
    const broken = `<feed><entry><title>garbage</title></entry></feed>`
    expect(parseFeedEntries(broken)).toEqual([])
  })

  it('returns an empty array for a feed with no entries', () => {
    expect(parseFeedEntries('<feed></feed>')).toEqual([])
  })
})

const form4Xml = (ownerName: string, codes: string[]) => `
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>${ownerName}</rptOwnerName></reportingOwnerId>
  </reportingOwner>
  <nonDerivativeTable>
    ${codes.map((c) => `<nonDerivativeTransaction><transactionCoding><transactionCode>${c}</transactionCode></transactionCoding></nonDerivativeTransaction>`).join('\n')}
  </nonDerivativeTable>
</ownershipDocument>`

describe('parseForm4Transaction', () => {
  it('reads the owner name and a single purchase code', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['P']))).toEqual({ insiderName: 'Jane Doe', code: 'P' })
  })

  it('reads a single sale code', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['S']))).toEqual({ insiderName: 'Jane Doe', code: 'S' })
  })

  it('treats the filing as a purchase if ANY transaction row is code P, even if a sale is listed first', () => {
    expect(parseForm4Transaction(form4Xml('Jane Doe', ['S', 'P']))).toEqual({ insiderName: 'Jane Doe', code: 'P' })
  })

  it('returns null when there is no owner name', () => {
    expect(parseForm4Transaction('<ownershipDocument><nonDerivativeTable></nonDerivativeTable></ownershipDocument>')).toBeNull()
  })

  it('returns null when there is no transaction row at all', () => {
    expect(parseForm4Transaction('<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Jane Doe</rptOwnerName></reportingOwnerId></reportingOwner></ownershipDocument>')).toBeNull()
  })
})

describe('getForm4ClusterSeeds', () => {
  const originalFetch = global.fetch
  const FEED = `<feed>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000002</id></entry>
    <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000003</id></entry>
    <entry><title>4 - BBB CORP (0000000002) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000001</id></entry>
    <entry><title>4 - UNMAPPED LLC (0000000003) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000003-26-000001</id></entry>
  </feed>`
  const xmlFor = (name: string, code: string) =>
    `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${name}</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`

  beforeEach(() => {
    vi.spyOn(edgarRoles, 'getTickerByCik').mockImplementation(async (cik) => ({ 1: 'AAA', 2: 'BBB' }[cik] ?? null))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('getcurrent')) return new Response(FEED, { status: 200 })
      // Filing URLs strip dashes from the accession number (real EDGAR archive path convention, same as lib/edgar-roles.ts).
      if (url.includes('000000000126000001')) return new Response(xmlFor('Jane Doe', 'P'), { status: 200 })
      if (url.includes('000000000126000002')) return new Response(xmlFor('John Roe', 'P'), { status: 200 })
      if (url.includes('000000000126000003')) throw new Error('network blip')
      if (url.includes('000000000226000001')) return new Response(xmlFor('Solo Buyer', 'P'), { status: 200 })
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('groups distinct purchasers by symbol and keeps only symbols at or above minBuyers', async () => {
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })

  it('never calls fetch for a CIK with no mapped ticker', async () => {
    await getForm4ClusterSeeds(100, 2)
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('0000000003'), expect.anything())
  })

  it('a single failed filing fetch does not affect the count for other filings of the same symbol', async () => {
    // AAA has 3 entries, one throws (accession ...000003); the other two (Jane, John) must still count.
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds.find((s) => s.symbol === 'AAA')?.buyerCount).toBe(2)
  })

  it('returns an empty array when the feed itself fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('SEC down')
    }) as unknown as typeof fetch
    expect(await getForm4ClusterSeeds(100, 2)).toEqual([])
  })

  it('documents a known v1 limitation: the same insider spelled differently across filings counts as two distinct buyers', async () => {
    vi.spyOn(edgarRoles, 'getTickerByCik').mockResolvedValue('AAA')
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('getcurrent')) {
        return new Response(
          `<feed>
            <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000010</id></entry>
            <entry><title>4 - AAA INC (0000000001) (Reporting)</title><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000011</id></entry>
          </feed>`,
          { status: 200 },
        )
      }
      if (url.includes('000010')) return new Response(xmlFor('Jane Doe', 'P'), { status: 200 })
      if (url.includes('000011')) return new Response(xmlFor('JANE DOE', 'P'), { status: 200 })
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch

    // Same real person, different capitalization — v1 has no name normalization, so this is counted as 2, not 1.
    const seeds = await getForm4ClusterSeeds(100, 2)
    expect(seeds).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })
})
