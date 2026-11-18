import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import type { FinvizRow } from '@/lib/finviz'
import { resetDb } from '../helpers/db'

const requestLlmJson = vi.fn()
const isLlmConfigured = vi.fn()
vi.mock('@/lib/llm-news', () => ({ requestLlmJson: (s: string, u: string) => requestLlmJson(s, u), isLlmConfigured: () => isLlmConfigured() }))

import { parseNotes, runFinvizScreen } from '@/lib/finviz-screen'

const DAY = 86_400_000
const uptrend = (slope: number): Bar[] =>
  Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * slope
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })

const row = (symbol: string, o: Partial<FinvizRow> = {}): FinvizRow => ({ symbol, price: 100, sma50: 5, sma200: 20, high52: -10, low52: 80, ...o })
const list = (rows: FinvizRow[]) => async () => ({ rows, total: rows.length, truncated: false })
const noon = () => new Date('2026-11-18T09:00:00Z')

describe('runFinvizScreen', () => {
  beforeEach(async () => {
    await resetDb()
    requestLlmJson.mockReset()
    isLlmConfigured.mockReset()
    isLlmConfigured.mockReturnValue(true)
  })

  it('keeps only stocks passing the technical rows, runs the scanner rules and attaches the Gemini note', async () => {
    requestLlmJson.mockResolvedValue({ json: { notes: { GOOD: 'Trend solido, base da completare.' } }, model: 'm' })
    const fetchBars = vi.fn(async () => uptrend(0.5))
    const out = await runFinvizScreen({ fetchList: list([row('GOOD'), row('LOWSMA', { sma50: -1 }), row('FAR', { high52: -40 })]), fetchBars, now: noon })

    expect(fetchBars).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ total: 3, passedTechnical: 1, noteAvailable: true })
    expect(out.picks).toHaveLength(1)
    expect(out.picks[0]).toMatchObject({ symbol: 'GOOD', note: 'Trend solido, base da completare.' })
    expect(out.picks[0].label).toBeTruthy()
    expect(out.picks[0].text).toBeTruthy()
  })

  it('still answers when Gemini is not configured or fails', async () => {
    isLlmConfigured.mockReturnValue(false)
    const off = await runFinvizScreen({ fetchList: list([row('GOOD')]), fetchBars: async () => uptrend(0.5), now: noon })
    expect(off.noteAvailable).toBe(false)
    expect(off.picks[0].note).toBeNull()

    isLlmConfigured.mockReturnValue(true)
    requestLlmJson.mockRejectedValue(new Error('LLM request failed: 429'))
    const failed = await runFinvizScreen({ fetchList: list([row('GOOD')]), fetchBars: async () => uptrend(0.5), now: noon })
    expect(failed.noteAvailable).toBe(false)
    expect(failed.picks).toHaveLength(1)
  })

  it('drops a stock whose history is too short or cannot be read', async () => {
    const out = await runFinvizScreen({
      fetchList: list([row('SHORT'), row('BROKEN')]),
      fetchBars: async (s) => {
        if (s === 'BROKEN') throw new Error('network')
        return uptrend(0.5).slice(0, 50)
      },
      now: noon,
    })
    expect(out.passedTechnical).toBe(2)
    expect(out.picks).toEqual([])
  })

  it('ranks against the stocks of the latest complete scan', async () => {
    const run = await prisma.scanRun.create({ data: { status: 'done', total: 6, cursor: 6, finishedAt: new Date() } })
    await prisma.scanResult.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ runId: run.id, symbol: `P${i}`, name: `P${i}`, status: 'ok', weightedReturn: i * 0.01 })) })
    const out = await runFinvizScreen({ fetchList: list([row('GOOD')]), fetchBars: async () => uptrend(0.5), now: noon })
    expect(out.picks[0].rs).toBe(100)
  })
})

describe('parseNotes', () => {
  it('keeps only notes for the requested symbols, trimmed and capped', () => {
    const notes = parseNotes({ notes: { A: '  ok  ', B: '', C: 5, X: 'unknown', D: 'x'.repeat(500) } }, ['A', 'B', 'C', 'D'])
    expect([...notes.keys()]).toEqual(['A', 'D'])
    expect(notes.get('A')).toBe('ok')
    expect(notes.get('D')).toHaveLength(260)
  })

  it('returns nothing for a malformed answer', () => {
    expect(parseNotes('nope', ['A']).size).toBe(0)
    expect(parseNotes({ notes: 'x' }, ['A']).size).toBe(0)
  })
})
