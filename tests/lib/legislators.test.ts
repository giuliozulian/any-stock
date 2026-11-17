import { describe, expect, it } from 'vitest'
import { buildLegislators, findLegislator, influenceOf, shortCommittee } from '@/lib/legislators'

const raw = [
  { id: { bioguide: 'A1' }, name: { first: 'Ro', last: 'Khanna', official_full: 'Ro Khanna' }, terms: [{ type: 'rep', state: 'CA', district: 17, party: 'Democrat' }] },
  { id: { bioguide: 'J1' }, name: { first: 'Jonathan', middle: 'L.', last: 'Jackson' }, terms: [{ type: 'rep', state: 'IL', district: 1, party: 'Democrat' }] },
  { id: { bioguide: 'J2' }, name: { first: 'Jesse', last: 'Jackson' }, terms: [{ type: 'rep', state: 'IL', district: 2, party: 'Democrat' }] },
  { id: { bioguide: 'S1' }, name: { first: 'Tommy', last: 'Tuberville' }, terms: [{ type: 'sen', state: 'AL', party: 'Republican' }] },
  { id: { bioguide: 'S2' }, name: { first: 'Katie', last: 'Britt' }, terms: [{ type: 'sen', state: 'AL', party: 'Republican' }] },
] as Parameters<typeof buildLegislators>[0]
const committees = [
  { thomas_id: 'HSAS', name: 'House Committee on Armed Services' },
  { thomas_id: 'HSAG', name: 'House Committee on Agriculture' },
]
const membership = { HSAS: [{ bioguide: 'A1' }], HSAG: [{ bioguide: 'J2', title: 'Ranking Member' }, { bioguide: 'J1' }], HSAS01: [{ bioguide: 'S1' }] }
const list = buildLegislators(raw, committees, membership)

describe('buildLegislators', () => {
  it('translates parties and ignores subcommittees', () => {
    const khanna = list.find((l) => l.bioguide === 'A1')!
    expect(khanna).toMatchObject({ party: 'Democratico', chamber: 'house', state: 'CA', district: '17' })
    expect(list.find((l) => l.bioguide === 'S1')!.committees).toEqual([])
  })
})

describe('findLegislator', () => {
  it('matches a member whose filing name differs from the official one', () => {
    expect(findLegislator(list, 'Jonathan Jackson', 'house', 'IL01')?.bioguide).toBe('J1')
    expect(findLegislator(list, 'Rohit Khanna', 'house', 'CA17')?.bioguide).toBe('A1')
  })
  it('uses the first name to tell two senators of a state apart', () => {
    expect(findLegislator(list, 'Tommy Tuberville', 'senate', 'AL')?.bioguide).toBe('S1')
  })
  it('does not guess when nobody matches', () => {
    expect(findLegislator(list, 'Someone Else', 'senate', 'AL')).toBeNull()
    expect(findLegislator(list, 'Someone Else', 'house', 'TX01')).toBeNull()
  })
})

describe('influenceOf', () => {
  it('is high for a leader or a market-moving committee, medium for any seat, low for none', () => {
    const by = (id: string) => influenceOf(list.find((l) => l.bioguide === id)!)
    expect(by('A1')).toBe('alta')
    expect(by('J2')).toBe('alta')
    expect(by('J1')).toBe('media')
    expect(by('S2')).toBe('bassa')
  })
})

describe('shortCommittee', () => {
  it('drops the chamber prefix', () => {
    expect(shortCommittee('House Committee on Financial Services')).toBe('Financial Services')
    expect(shortCommittee('Senate Committee on Armed Services')).toBe('Armed Services')
    expect(shortCommittee('House Permanent Select Committee on Intelligence')).toBe('Intelligence')
  })
})
