import { describe, expect, it } from 'vitest'
import { parseFeedEntries } from '@/lib/edgar-form4-feed'

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
