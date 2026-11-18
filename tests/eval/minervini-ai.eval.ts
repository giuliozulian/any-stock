import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import { buildInput, generateAiResult } from '@/lib/minervini-ai'
import { barsBetween } from './bars'

interface Case {
  symbol: string
  date: string
  price: number
  label: 'winner' | 'failed'
}

// Fixed with the user BEFORE the first run. Do not adjust after seeing results.
const MIN_AGREEMENT = 0 // TODO set with the user: share of cases where the verdict matches the label
const MAX_READY_ON_FAILED = 1 // TODO set with the user: share of "failed" cases the AI may call ready
const MIN_READY_ON_WINNERS = 0 // TODO set with the user: share of winners the AI must call ready (without it, answering "wait" every time would pass)

const DAY = 86_400_000

describe('minervini ai competence', () => {
  it('judges the day before each known breakout', async () => {
    const cases: Case[] = [...JSON.parse(readFileSync('tests/eval/cases.json', 'utf8')), ...JSON.parse(readFileSync('tests/eval/negatives.json', 'utf8'))]
    const rows: { symbol: string; date: string; label: string; verdict: string | null; ok: boolean | null }[] = []
    for (const c of cases) {
      const at = new Date(`${c.date}T00:00:00Z`)
      const bars = await barsBetween(c.symbol, new Date(at.getTime() - 800 * DAY), at)
      if (!bars || bars.length < 222) {
        rows.push({ symbol: c.symbol, date: c.date, label: c.label, verdict: null, ok: null })
        continue
      }
      // No peers at a historical date: the RS criterion is left out, as in the app when the sample is too small.
      const template = evaluateTrendTemplate(bars, null)!
      const input = buildInput(c.symbol, { template, vcp: detectVcp(bars), peerCount: 0 })
      const result = await generateAiResult(input)
      const verdict = result?.verdict ?? null
      const ok = verdict === null ? null : c.label === 'winner' ? verdict !== 'no' : verdict !== 'ready'
      rows.push({ symbol: c.symbol, date: c.date, label: c.label, verdict, ok })
    }
    writeFileSync('tests/eval/results.json', `${JSON.stringify(rows, null, 2)}\n`)

    const judged = rows.filter((r) => r.ok !== null)
    const agreement = judged.filter((r) => r.ok).length / judged.length
    const failed = judged.filter((r) => r.label === 'failed')
    const readyOnFailed = failed.length ? failed.filter((r) => r.verdict === 'ready').length / failed.length : 0
    const winners = judged.filter((r) => r.label === 'winner')
    const readyOnWinners = winners.length ? winners.filter((r) => r.verdict === 'ready').length / winners.length : 0
    console.table(rows)
    console.log({ judged: judged.length, skipped: rows.length - judged.length, agreement, readyOnFailed, readyOnWinners })

    expect(agreement).toBeGreaterThanOrEqual(MIN_AGREEMENT)
    expect(readyOnFailed).toBeLessThanOrEqual(MAX_READY_ON_FAILED)
    expect(readyOnWinners).toBeGreaterThanOrEqual(MIN_READY_ON_WINNERS)
  })
})
