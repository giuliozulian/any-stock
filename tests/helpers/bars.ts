import type { Bar } from '@/lib/history'

// Daily bars on weekdays only, one per close, starting on `start` (YYYY-MM-DD, a weekday), stamped at 14:00 UTC like a US session.
export function weekdayBars(start: string, closes: number[]): Bar[] {
  const bars: Bar[] = []
  const d = new Date(`${start}T14:00:00Z`)
  for (const close of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    bars.push({ t: d.getTime(), high: close, low: close, close, volume: 1000 })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return bars
}
