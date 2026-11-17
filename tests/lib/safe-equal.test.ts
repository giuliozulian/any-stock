import { describe, expect, it } from 'vitest'
import { safeEqual } from '@/lib/safe-equal'

describe('safeEqual', () => {
  it('is true only for identical strings', () => {
    expect(safeEqual('s3cret', 's3cret')).toBe(true)
    expect(safeEqual('s3cret', 's3creT')).toBe(false)
  })

  it('does not throw and says false when the lengths differ', () => {
    expect(safeEqual('short', 'a much longer secret')).toBe(false)
    expect(safeEqual('a much longer secret', 'short')).toBe(false)
  })

  it('says false when either side is empty, so an unset secret never matches an empty input', () => {
    expect(safeEqual('', '')).toBe(false)
    expect(safeEqual('x', '')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
  })
})
