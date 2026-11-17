import { createHash, timingSafeEqual } from 'node:crypto'

// Constant-time comparison of two secrets. Hashing first makes the comparison independent of the lengths.
// An empty value never matches, so an unset secret cannot be satisfied by an empty input.
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
