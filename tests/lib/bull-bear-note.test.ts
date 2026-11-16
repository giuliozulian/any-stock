import { describe, expect, it } from 'vitest'
import { parseBullBear } from '@/lib/bull-bear-note'

describe('parseBullBear', () => {
  it('keeps at most 4 points per side and drops blanks', () => {
    const r = parseBullBear({ bull: ['a', ' ', 'b', 'c', 'd', 'e'], bear: ['x'] }, 'm')
    expect(r?.bull).toEqual(['a', 'b', 'c', 'd'])
    expect(r?.bear).toEqual(['x'])
  })
  it('accepts one empty side', () => {
    expect(parseBullBear({ bull: ['a'], bear: [] }, 'm')?.bear).toEqual([])
  })
  it.each([null, {}, { bull: [], bear: [] }, { bull: 'a' }])('rejects %#', (bad) => {
    expect(parseBullBear(bad, 'm')).toBeNull()
  })
})
