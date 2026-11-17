import { describe, expect, it } from 'vitest'
import {
  AAA_YIELD,
  DCF_GROWTH_MAX,
  DISCOUNT_RATE,
  GRAHAM_GROWTH_MAX,
  LYNCH_PE_MAX,
  LYNCH_PE_MIN,
  MIN_BOOK_TO_PRICE,
  RELIABLE_MAX_SPREAD,
  TERMINAL_GROWTH,
  VALUATION_TUNED_ON,
} from '@/lib/valuation-config'

describe('valuation config', () => {
  it('holds the parameters the fair value models are tuned on', () => {
    expect(AAA_YIELD).toBe(4.5)
    expect(DISCOUNT_RATE).toBe(0.09)
    expect(TERMINAL_GROWTH).toBe(0.025)
    expect(GRAHAM_GROWTH_MAX).toBe(15)
    expect(DCF_GROWTH_MAX).toBe(12)
    expect(LYNCH_PE_MIN).toBe(5)
    expect(LYNCH_PE_MAX).toBe(25)
    expect(MIN_BOOK_TO_PRICE).toBe(0.1)
    expect(RELIABLE_MAX_SPREAD).toBe(2)
  })

  it('says when it was last tuned, as an ISO date', () => {
    expect(VALUATION_TUNED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('keeps the discount rate above the terminal growth, or the cash flow model would blow up', () => {
    expect(DISCOUNT_RATE).toBeGreaterThan(TERMINAL_GROWTH)
  })
})
