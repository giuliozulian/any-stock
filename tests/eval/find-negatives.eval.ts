import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import { barsBetween } from './bars'

const SAMPLE = 80
const STEP = 5
const FORWARD = 15
const STOP = 0.08
const MAX_NEGATIVES = 25

describe('find negatives', () => {
  it('lists breakouts the detector flagged that fell through the 8% stop within three weeks', async () => {
    const universe: string[] = JSON.parse(readFileSync('data/sp500.json', 'utf8')).map((s: { symbol: string }) => s.symbol)
    const symbols = universe.filter((_, i) => i % Math.floor(universe.length / SAMPLE) === 0).slice(0, SAMPLE)
    const found: { symbol: string; date: string; price: number; label: 'failed' }[] = []
    for (const symbol of symbols) {
      if (found.length >= MAX_NEGATIVES) break
      const bars = await barsBetween(symbol, new Date('2021-01-01'), new Date())
      if (!bars || bars.length < 400) continue
      for (let end = 260; end < bars.length - FORWARD; end += STEP) {
        const slice = bars.slice(0, end)
        const template = evaluateTrendTemplate(slice, null)
        if (!template || template.passedCount < template.total) continue
        const vcp = detectVcp(slice)
        if (vcp.status !== 'breakout') continue
        const entry = slice[slice.length - 1].close
        const low = Math.min(...bars.slice(end, end + FORWARD).map((b) => b.low))
        if (low < entry * (1 - STOP)) {
          found.push({ symbol, date: new Date(slice[slice.length - 1].t).toISOString().slice(0, 10), price: entry, label: 'failed' })
          break
        }
      }
    }
    writeFileSync('tests/eval/negatives.json', `${JSON.stringify(found, null, 2)}\n`)
    console.log(`${found.length} negatives`)
  })
})
