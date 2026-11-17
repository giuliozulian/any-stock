import { sharedCache } from './shared-cache'

// Public, community-maintained dataset of the sitting members of Congress (github.com/unitedstates/congress-legislators).
const BASE = 'https://unitedstates.github.io/congress-legislators'
const TTL_MS = 24 * 60 * 60 * 1000

export interface Legislator {
  bioguide: string
  first: string
  last: string
  full: string
  chamber: 'house' | 'senate'
  state: string
  district: string | null
  party: string
  committees: Array<{ name: string; title: string | null; code: string }>
}

interface RawLegislator {
  id: { bioguide: string }
  name: { first: string; last: string; official_full?: string; nickname?: string }
  terms: Array<{ type: string; state: string; district?: number; party: string }>
}

interface RawCommittee {
  thomas_id: string
  name: string
}

type RawMembership = Record<string, Array<{ bioguide: string; title?: string }>>

const PARTY: Record<string, string> = { Democrat: 'Democratico', Republican: 'Repubblicano', Independent: 'Indipendente' }

// Committees whose decisions move markets or whole sectors: sitting on one makes a member's purchases worth a closer look.
export const KEY_COMMITTEES = new Set([
  'SSFI', 'SSBK', 'SSCM', 'SSAS', 'SSEG', 'SSAP', 'SLIN', 'HSWM', 'HSBA', 'HSIF', 'HSAS', 'HSAP', 'HLIG', 'HSSY',
])
const LEADER_TITLE = /^(chair|chairman|chairwoman|ranking member|vice chair)/i

export function shortCommittee(name: string): string {
  return name.replace(/^(House|Senate|Joint)\s+(Select\s+|Permanent Select\s+)?Committee on (the )?/i, '').replace(/^Committee on (the )?/i, '')
}

export function buildLegislators(raw: RawLegislator[], committees: RawCommittee[], membership: RawMembership): Legislator[] {
  const names = new Map(committees.map((c) => [c.thomas_id, c.name]))
  const byBioguide = new Map<string, Array<{ name: string; title: string | null; code: string }>>()
  // Only top-level committees: subcommittee codes carry extra digits and are not in the committee list.
  for (const [code, members] of Object.entries(membership)) {
    const name = names.get(code)
    if (!name) continue
    for (const m of members) byBioguide.set(m.bioguide, [...(byBioguide.get(m.bioguide) ?? []), { name, title: m.title ?? null, code }])
  }
  return raw.flatMap((l) => {
    const term = l.terms[l.terms.length - 1]
    if (!term) return []
    return [
      {
        bioguide: l.id.bioguide,
        first: l.name.first,
        last: l.name.last,
        full: l.name.official_full ?? `${l.name.first} ${l.name.last}`,
        chamber: term.type === 'sen' ? ('senate' as const) : ('house' as const),
        state: term.state,
        district: term.type === 'rep' && term.district !== undefined ? String(term.district).padStart(2, '0') : null,
        party: PARTY[term.party] ?? term.party,
        committees: (byBioguide.get(l.id.bioguide) ?? []).map((c) => ({ name: c.name, title: c.title, code: c.code })),
      },
    ]
  })
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

// Filings spell names their own way ("Rohit Khanna", "Robert E. Latta"): the House district ("OH02") pins a member down exactly,
// for a senator the state and last name must agree and a first name or initial settles a tie.
export function findLegislator(list: Legislator[], member: string, chamber: string, state: string): Legislator | null {
  const tokens = norm(member).split(' ').filter((t) => !SUFFIXES.has(t))
  const first = tokens[0] ?? ''
  const last = tokens[tokens.length - 1] ?? ''
  const st = state.slice(0, 2).toUpperCase()
  const district = state.slice(2)
  const pool = list.filter((l) => l.chamber === (chamber === 'senate' ? 'senate' : 'house') && (!st || l.state === st))
  const lastMatches = pool.filter((l) => norm(l.last).split(' ').includes(last) || norm(l.last) === tokens.slice(1).join(' '))
  if (lastMatches.length === 1) return lastMatches[0]
  const byDistrict = district ? pool.filter((l) => l.district === district) : []
  if (byDistrict.length === 1) return byDistrict[0]
  const byFirst = lastMatches.filter((l) => norm(l.first).startsWith(first[0] ?? '#') || norm(l.full).includes(first))
  return byFirst.length === 1 ? byFirst[0] : null
}

export type Influence = 'alta' | 'media' | 'bassa'

// High: chairs or ranks a committee, or sits on a market-moving one. Medium: any committee. Low: none.
export function influenceOf(l: Legislator): Influence {
  if (l.committees.some((c) => (c.title && LEADER_TITLE.test(c.title)) || KEY_COMMITTEES.has(c.code))) return 'alta'
  return l.committees.length > 0 ? 'media' : 'bassa'
}

const cache = sharedCache<{ at: number; list: Legislator[] }>('legislators')

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`congress-legislators ${file} failed: ${res.status}`)
  return (await res.json()) as T
}

// The sitting members with their committees. Null when the dataset cannot be read and nothing is cached.
export async function getLegislators(): Promise<Legislator[] | null> {
  const hit = await cache.get('all', TTL_MS)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list
  try {
    const [raw, committees, membership] = await Promise.all([
      getJson<RawLegislator[]>('legislators-current.json'),
      getJson<RawCommittee[]>('committees-current.json'),
      getJson<RawMembership>('committee-membership-current.json'),
    ])
    const list = buildLegislators(raw, committees, membership)
    await cache.set('all', { at: Date.now(), list })
    return list
  } catch (err) {
    console.error('Legislators failed:', err instanceof Error ? err.message : err)
    return hit?.list ?? null
  }
}
