// Parameters of the fair value models. They are judgement calls, not facts: review them from time to time and move the date below.
export const VALUATION_TUNED_ON = '2026-11-17'

// Yield of AAA corporate bonds, in %: the "4,4 ÷ AAA" term of Graham's growth formula.
export const AAA_YIELD = 4.5

// Discounted cash flow.
export const DISCOUNT_RATE = 0.09
export const TERMINAL_GROWTH = 0.025
export const DCF_GROWTH_MAX = 12

// Graham with growth and Lynch.
export const GRAHAM_GROWTH_MAX = 15
export const LYNCH_PE_MIN = 5
export const LYNCH_PE_MAX = 25

// Graham number: book value per share must be at least this share of the price, or the company has too few assets for the method.
export const MIN_BOOK_TO_PRICE = 0.1

// The estimate is reliable when the highest model is at most this many times the lowest.
export const RELIABLE_MAX_SPREAD = 2
