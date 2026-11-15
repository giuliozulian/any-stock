import { describe, expect, it } from 'vitest'
import { parseFeedEntries, parseForm4Transaction } from '@/lib/edgar-form4-feed'

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
