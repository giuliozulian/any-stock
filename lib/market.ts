export const BIG_MOVE_THRESHOLD_PCT = 15

export interface MoverInput {
  symbol: string
  name: string
  changePct: number
}

export function bigMovers<T extends MoverInput>(items: T[], threshold: number = BIG_MOVE_THRESHOLD_PCT): T[] {
  return items
    .filter((i) => Math.abs(i.changePct) >= threshold)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
}
