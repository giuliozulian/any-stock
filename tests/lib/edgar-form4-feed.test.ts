import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseDailyIndex, parseForm4Transaction, getForm4ClusterSeeds, resetForm4Cache } from '@/lib/edgar-form4-feed'
import * as edgarRoles from '@/lib/edgar-roles'

const idxLine = (form: string, name: string, cik: number, accession: string) => `${form.padEnd(12)}${name.padEnd(62)}${String(cik).padEnd(12)}20261112    edgar/data/${cik}/${accession}.txt`
const idx = (...lines: string[]) => `Form Type   Company Name   CIK   Date Filed   File Name\n${'-'.repeat(100)}\n${lines.join('\n')}\n`

describe('parseDailyIndex', () => {
  it('extracts cik, company name and accession number from each Form 4 row', () => {
    const rows = idx(idxLine('4', 'AAA INC', 1, '0000000001-26-000001'), idxLine('4', 'BBB CORP', 2, '0000000002-26-000001'))
    expect(parseDailyIndex(rows)).toEqual([
      { cik: 1, companyName: 'AAA INC', accessionNumber: '0000000001-26-000001' },
      { cik: 2, companyName: 'BBB CORP', accessionNumber: '0000000002-26-000001' },
    ])
  })

  it('ignores other form types, amendments and the header', () => {
    const rows = idx(idxLine('10-K', 'AAA INC', 1, '0000000001-26-000005'), idxLine('4/A', 'AAA INC', 1, '0000000001-26-000006'), idxLine('144', 'AAA INC', 1, '0000000001-26-000007'))
    expect(parseDailyIndex(rows)).toEqual([])
  })

  it('keeps company names that contain digits and spaces', () => {
    expect(parseDailyIndex(idx(idxLine('4', '3M CO  (THE)', 66740, '0000066740-26-000001')))).toEqual([{ cik: 66740, companyName: '3M CO  (THE)', accessionNumber: '0000066740-26-000001' }])
  })

  it('returns an empty array for an empty index', () => {
    expect(parseDailyIndex('')).toEqual([])
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
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')
  const A = (n: number) => `0000000001-26-${String(n).padStart(6, '0')}`
  const xmlFor = (name: string, code: string) =>
    `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${name}</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`
  const issuer = (cik: number, name: string, acc: string) => idxLine('4', name, cik, acc)

  // Serves daily indexes by date; every other day answers 404 like a weekend. `filings` maps accession -> response.
  function mockSec(indexes: Record<string, string>, filings: Record<string, () => Response | Promise<Response>>) {
    global.fetch = vi.fn(async (url: string) => {
      const day = url.match(/form\.(\d{8})\.idx/)?.[1]
      if (day) return indexes[day] !== undefined ? new Response(indexes[day], { status: 200 }) : new Response('not found', { status: 404 })
      const acc = Object.keys(filings).find((a) => url.includes(`${a}.txt`))
      if (acc) return filings[acc]()
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch
  }
  const fetchedUrls = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string)

  beforeEach(() => {
    resetForm4Cache()
    vi.spyOn(edgarRoles, 'getTickerByCik').mockImplementation(async (cik) => ({ 1: 'AAA', 2: 'BBB' }[cik] ?? null))
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('counts distinct purchasers by symbol across the days of the window and keeps symbols at or above minBuyers', async () => {
    // Jane buys today, John buys yesterday: the cluster only exists when both days are read.
    mockSec(
      { [today]: idx(issuer(1, 'AAA INC', A(9001)), issuer(2, 'BBB CORP', '0000000002-26-009001')), [yesterday]: idx(issuer(1, 'AAA INC', A(9002)), issuer(1, 'AAA INC', A(9003)), issuer(3, 'UNMAPPED LLC', '0000000003-26-009001')) },
      {
        [A(9001)]: () => new Response(xmlFor('Jane Doe', 'P')),
        [A(9002)]: () => new Response(xmlFor('John Roe', 'P')),
        [A(9003)]: () => new Response(xmlFor('Sam Sale', 'S')),
        '0000000002-26-009001': () => new Response(xmlFor('Solo Buyer', 'P')),
      },
    )
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })

  it('requests one index per day of the window, under the right quarter folder', async () => {
    mockSec({}, {})
    await getForm4ClusterSeeds(7, 2)
    const idxUrls = fetchedUrls().filter((u) => u.includes('daily-index'))
    expect(idxUrls).toHaveLength(7)
    expect(idxUrls[0]).toMatch(/daily-index\/\d{4}\/QTR[1-4]\/form\.\d{8}\.idx$/)
    expect(idxUrls.some((u) => u.includes(`form.${today}.idx`))).toBe(true)
  })

  it('never fetches filings of a symbol with fewer filings than minBuyers, nor a CIK with no mapped ticker', async () => {
    mockSec({ [today]: idx(issuer(2, 'BBB CORP', '0000000002-26-009101'), issuer(3, 'UNMAPPED LLC', '0000000003-26-009101'), issuer(3, 'UNMAPPED LLC', '0000000003-26-009102')) }, {})
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([])
    expect(fetchedUrls().some((u) => u.includes('.txt'))).toBe(false)
  })

  it('a single failed filing fetch does not affect the count for other filings of the same symbol', async () => {
    mockSec(
      { [today]: idx(issuer(1, 'AAA INC', A(9201)), issuer(1, 'AAA INC', A(9202)), issuer(1, 'AAA INC', A(9203))) },
      {
        [A(9201)]: () => new Response(xmlFor('Jane Doe', 'P')),
        [A(9202)]: () => new Response(xmlFor('John Roe', 'P')),
        [A(9203)]: () => {
          throw new Error('network blip')
        },
      },
    )
    expect((await getForm4ClusterSeeds(7, 2)).find((s) => s.symbol === 'AAA')?.buyerCount).toBe(2)
  })

  it('fetches the filing by the complete-submission .txt URL, not a guessed XML document name', async () => {
    mockSec({ [today]: idx(issuer(1, 'AAA INC', A(9301)), issuer(1, 'AAA INC', A(9302))) }, { [A(9301)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9302)]: () => new Response(xmlFor('John Roe', 'P')) })
    await getForm4ClusterSeeds(7, 2)
    expect(fetchedUrls().some((u) => u.includes(`/data/1/${A(9301)}.txt`))).toBe(true)
    expect(fetchedUrls().some((u) => u.includes('primary_doc.xml'))).toBe(false)
  })

  it('fetches a filing only once even if it is listed under its issuer and its insider, whatever the order', async () => {
    mockSec(
      { [today]: idx(idxLine('4', 'SOME INSIDER', 9, A(9401)), issuer(1, 'AAA INC', A(9401)), issuer(1, 'AAA INC', A(9402)), issuer(1, 'AAA INC', A(9402))) },
      { [A(9401)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9402)]: () => new Response(xmlFor('John Roe', 'P')) },
    )
    vi.spyOn(edgarRoles, 'getTickerByCik').mockImplementation(async (cik) => ({ 1: 'AAA' }[cik] ?? null))
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
    expect(fetchedUrls().filter((u) => u.includes(`${A(9401)}.txt`))).toHaveLength(1)
    expect(fetchedUrls().filter((u) => u.includes(`${A(9402)}.txt`))).toHaveLength(1)
  })

  it('does not fetch a filing again on a later scan: what a Form 4 says about its buyer never changes', async () => {
    mockSec({ [today]: idx(issuer(1, 'AAA INC', A(9501)), issuer(1, 'AAA INC', A(9502))) }, { [A(9501)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9502)]: () => new Response(xmlFor('John Roe', 'P')) })
    await getForm4ClusterSeeds(7, 2)
    const before = fetchedUrls().filter((u) => u.includes('.txt')).length
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
    expect(fetchedUrls().filter((u) => u.includes('.txt'))).toHaveLength(before)
  })

  it('stops at maxFilings, starting from the symbols with the most filings', async () => {
    vi.spyOn(edgarRoles, 'getTickerByCik').mockImplementation(async (cik) => ({ 1: 'AAA', 2: 'BBB' }[cik] ?? null))
    mockSec(
      { [today]: idx(issuer(2, 'BBB CORP', '0000000002-26-009601'), issuer(2, 'BBB CORP', '0000000002-26-009602'), issuer(1, 'AAA INC', A(9601)), issuer(1, 'AAA INC', A(9602)), issuer(1, 'AAA INC', A(9603))) },
      { [A(9601)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9602)]: () => new Response(xmlFor('John Roe', 'P')), [A(9603)]: () => new Response(xmlFor('Sam Poe', 'P')), '0000000002-26-009601': () => new Response(xmlFor('B One', 'P')), '0000000002-26-009602': () => new Response(xmlFor('B Two', 'P')) },
    )
    const seeds = await getForm4ClusterSeeds(7, 2, 45000, 3)
    expect(seeds.map((s) => s.symbol)).toEqual(['AAA'])
  })

  it('returns the partial result gathered so far once the overall deadline passes, instead of waiting for every filing', async () => {
    mockSec(
      { [today]: idx(issuer(1, 'AAA INC', A(9701)), issuer(1, 'AAA INC', A(9702))) },
      // The second one never resolves: a stuck SEC request that would otherwise block the whole scan.
      { [A(9701)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9702)]: () => new Promise<Response>(() => {}) },
    )
    expect(await getForm4ClusterSeeds(7, 1, 30)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 1 }])
  })

  it('keeps the other days when one index fails, and skips days with no index (404)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes(`form.${today}.idx`)) return new Response('boom', { status: 500 })
      if (url.includes(`form.${yesterday}.idx`)) return new Response(idx(issuer(1, 'AAA INC', A(9801)), issuer(1, 'AAA INC', A(9802))), { status: 200 })
      if (url.includes('daily-index')) return new Response('not found', { status: 404 })
      if (url.includes(A(9801))) return new Response(xmlFor('Jane Doe', 'P'))
      if (url.includes(A(9802))) return new Response(xmlFor('John Roe', 'P'))
      throw new Error(`unexpected URL in test: ${url}`)
    }) as unknown as typeof fetch
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })

  it('returns an empty array when every index fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('SEC down')
    }) as unknown as typeof fetch
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([])
  })

  it('documents a known v1 limitation: the same insider spelled differently across filings counts as two distinct buyers', async () => {
    mockSec({ [today]: idx(issuer(1, 'AAA INC', A(9901)), issuer(1, 'AAA INC', A(9902))) }, { [A(9901)]: () => new Response(xmlFor('Jane Doe', 'P')), [A(9902)]: () => new Response(xmlFor('JANE DOE', 'P')) })
    expect(await getForm4ClusterSeeds(7, 2)).toEqual([{ symbol: 'AAA', name: 'AAA INC', buyerCount: 2 }])
  })
})
