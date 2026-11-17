import type { CongressBuy } from '@/lib/congress'
import { findLegislator, getLegislators, influenceOf, shortCommittee } from '@/lib/legislators'

export interface MemberProfile {
  party: string
  role: string
  influence: 'alta' | 'media' | 'bassa' | ''
  // Committees, in plain text, from the public congress-legislators dataset.
  note: string
}

export interface MemberStats {
  purchases: number
  tickers: number
  avgPerfPct: number | null
  // Average of (return since purchase − S&P 500 return over the same days); null when the benchmark is missing.
  avgExcessPct: number | null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function memberStats(buys: CongressBuy[]): Map<string, MemberStats> {
  const by = new Map<string, { purchases: number; tickers: Set<string>; perfs: number[]; excess: number[] }>()
  for (const b of buys) {
    const e = by.get(b.member) ?? { purchases: 0, tickers: new Set<string>(), perfs: [], excess: [] }
    e.purchases += 1
    e.tickers.add(b.ticker)
    if (b.perfPct !== null) e.perfs.push(b.perfPct)
    if (b.perfPct !== null && typeof b.marketPct === 'number') e.excess.push(b.perfPct - b.marketPct)
    by.set(b.member, e)
  }
  return new Map([...by].map(([m, e]) => [m, { purchases: e.purchases, tickers: e.tickers.size, avgPerfPct: mean(e.perfs), avgExcessPct: mean(e.excess) }]))
}

const MAX_COMMITTEES = 3

// Profiles come from the public dataset of sitting members, never from a language model: party, chamber and committees are facts, and
// "influence" is a fixed rule over them. A member that cannot be matched (left office, unusual spelling) simply has no profile.
export async function getMemberProfiles(members: Array<{ member: string; chamber: string; state: string }>): Promise<Map<string, MemberProfile>> {
  const result = new Map<string, MemberProfile>()
  const list = await getLegislators()
  if (!list) return result
  for (const m of members) {
    const l = findLegislator(list, m.member, m.chamber, m.state)
    if (!l) continue
    const committees = l.committees.map((c) => shortCommittee(c.name))
    result.set(m.member, {
      party: l.party,
      role: `${l.chamber === 'senate' ? 'Senatore' : 'Deputato'}${committees.length ? `, commissioni: ${committees.slice(0, MAX_COMMITTEES).join(', ')}${committees.length > MAX_COMMITTEES ? ` e altre ${committees.length - MAX_COMMITTEES}` : ''}` : ''}`,
      influence: influenceOf(l),
      note: '',
    })
  }
  return result
}
