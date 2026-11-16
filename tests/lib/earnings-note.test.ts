import { describe, expect, it } from 'vitest'
import { computeEarningsNoteHash, parseEarningsNote, type EarningsNoteInput } from '@/lib/earnings-note'

describe('parseEarningsNote', () => {
  it('accepts a valid payload and caps watchFor at 3', () => {
    const r = parseEarningsNote({ headline: 'Utili sopra le attese', body: 'Uno.\n\nDue.', watchFor: ['a', 'b', 'c', 'd'] }, 'm')
    expect(r).toMatchObject({ headline: 'Utili sopra le attese', model: 'm' })
    expect(r?.watchFor).toEqual(['a', 'b', 'c'])
  })
  it.each([{ headline: '', body: 'x' }, { headline: 'h', body: 5 }, null])('rejects invalid payload %#', (bad) => {
    expect(parseEarningsNote(bad, 'm')).toBeNull()
  })
})

describe('computeEarningsNoteHash', () => {
  const base: EarningsNoteInput = {
    stock: { symbol: 'NVDA', name: 'NVIDIA' },
    surprises: [{ period: '2026-07-31', actual: 1.2, estimate: 1.1, surprisePercent: 9 }],
    years: [],
    nextEarnings: { date: '2026-11-25', epsEstimate: 1.3 },
  }
  it('is stable for the same data', () => {
    expect(computeEarningsNoteHash({ ...base })).toBe(computeEarningsNoteHash(base))
  })
  it('changes when a new quarter is reported', () => {
    const next = { ...base, surprises: [{ period: '2026-10-31', actual: 1.4, estimate: 1.3, surprisePercent: 7 }, ...base.surprises] }
    expect(computeEarningsNoteHash(next)).not.toBe(computeEarningsNoteHash(base))
  })
})
