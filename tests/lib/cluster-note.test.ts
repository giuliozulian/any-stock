import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as llm from '@/lib/llm-news'
import { buildClusterNoteContext, getClusterNote, parseClusterNote, type ClusterNoteInput } from '@/lib/cluster-note'

const input: ClusterNoteInput = {
  symbol: 'MP',
  name: 'MP Materials',
  marketCap: 6.41e9,
  cluster: {
    from: '2026-11-10',
    to: '2026-11-17',
    insiders: 2,
    purchases: 2,
    total: 2_071_000,
    lead: { name: 'Weisenburger', role: 'Director', value: 1_980_000 },
    score: 78,
    trades: [
      { name: 'Corbett', side: 'buy', shares: 2630, price: 34.86, value: 91_000, date: '2026-11-17', filingDate: '2026-11-18', role: 'CFO' },
      { name: 'Weisenburger', side: 'buy', shares: 55000, price: 36, value: 1_980_000, date: '2026-11-10', filingDate: '2026-11-12', role: 'Director' },
    ],
  },
}

describe('buildClusterNoteContext', () => {
  it('lists the company, the totals, the share of market cap and each purchase with its role', () => {
    const text = buildClusterNoteContext(input)
    expect(text).toContain('MP Materials (MP)')
    expect(text).toContain('2 insider, 2 operazioni')
    expect(text).toContain('0.032% della capitalizzazione')
    expect(text).toContain('Corbett (CFO)')
  })
})

describe('parseClusterNote', () => {
  it('trims the note and rejects anything that is not a non-empty note', () => {
    expect(parseClusterNote({ note: '  Comprano in due.  ' })).toBe('Comprano in due.')
    for (const bad of [null, {}, { note: '' }, { note: 5 }, 'x']) expect(parseClusterNote(bad)).toBeNull()
  })
})

describe('getClusterNote', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('is null without calling the model when none is configured', async () => {
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(false)
    const call = vi.spyOn(llm, 'requestLlmJson')
    expect(await getClusterNote(input)).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })

  it('asks the model once for the same trades and then serves the cached note', async () => {
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true)
    const call = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue({ json: { note: 'Due dirigenti comprano insieme.' }, model: 'm' })
    const same = { ...input, symbol: 'CACHED' }
    expect(await getClusterNote(same)).toBe('Due dirigenti comprano insieme.')
    expect(await getClusterNote(same)).toBe('Due dirigenti comprano insieme.')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('is null, and caches nothing, when the model fails', async () => {
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true)
    const call = vi.spyOn(llm, 'requestLlmJson').mockResolvedValue(null)
    const failing = { ...input, symbol: 'FAILS' }
    expect(await getClusterNote(failing)).toBeNull()
    expect(await getClusterNote(failing)).toBeNull()
    expect(call).toHaveBeenCalledTimes(2)
  })
})
