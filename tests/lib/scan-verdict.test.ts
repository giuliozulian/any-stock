import { describe, expect, it } from 'vitest'
import type { Bar } from '@/lib/history'
import { detectVcp, evaluateTrendTemplate } from '@/lib/minervini'
import type { MinerviniAnalysis } from '@/lib/minervini-data'
import { MARKET_TEXT, VERDICT, duringSession, fmtNum, fmtPrice, planFor, planForAnalysis, rowFromAnalysis, sentence, toScanRow, type ScanRow } from '@/lib/scan-verdict'
import { tradePlan } from '@/lib/scanner'

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout', pivot: 98, pivotDistancePct: 2, volumeRatio: 1.8, missing: null, ...over,
})

describe('formatting', () => {
  it('writes numbers the Italian way', () => {
    expect(fmtNum(4.83)).toBe('4,8')
    expect(fmtNum(8, 1)).toBe('8,0')
    expect(fmtPrice(98)).toBe('98,00')
    // it-IT does not group four-digit numbers, it does from five digits up.
    expect(fmtPrice(1234.5)).toBe('1234,50')
    expect(fmtPrice(12345.6)).toBe('12.345,60')
  })
})

describe('VERDICT', () => {
  it('has a label and a unique rank for every verdict', () => {
    const ranks = Object.values(VERDICT).map((v) => v.rank)
    expect(new Set(ranks).size).toBe(9)
    expect(VERDICT.buy.label).toBe('Si può comprare')
    expect(VERDICT.confirm.label).toBe('Aspetta conferma')
    expect(VERDICT['weak-fundamentals'].label).toBe('Tecnico ok, fondamentali deboli')
    expect(VERDICT['weak-fundamentals'].rank).toBe(VERDICT.buy.rank + 1)
  })
})

describe('sentence', () => {
  it('explains a confirmed breakout with the pivot and the volume', () => {
    const r = row()
    const text = sentence(r, tradePlan(r), null)
    expect(text).toContain('98,00')
    expect(text).toContain('+80% sulla media')
  })

  it('explains why a breakout is not a buy when the scan ran with the market open', () => {
    const r = row()
    expect(sentence(r, { ...tradePlan(r), verdict: 'confirm' }, 'session')).toMatch(/volume di oggi è parziale/i)
  })

  it('explains why a breakout is not a buy in a weak market', () => {
    const r = row()
    expect(sentence(r, { ...tradePlan(r), verdict: 'confirm' }, 'weak-market')).toMatch(/il mercato è debole/i)
  })

  it('explains weak fundamentals with what falls short', () => {
    const r = row({ fundamentals: { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 } })
    const text = sentence(r, tradePlan(r), null)
    expect(text).toContain('98,00')
    expect(text).toContain('ricavi −14% (ne servono oltre 25%)')
    expect(text).toMatch(/meglio non comprare/i)
  })

  it('explains a buy held back by the VWAP of the base', () => {
    const r = row({ avwap: 110 })
    const out = planFor(r, { caution: null, market: null })
    expect(out.plan.verdict).toBe('confirm')
    expect(sentence(r, out.plan, out.note)).toMatch(/VWAP/)
    expect(sentence(r, out.plan, out.note)).toContain('110,00')
  })

  it('says what is missing for a 7-of-8 stock', () => {
    const r = row({ passedCount: 7, missing: 'Forza relativa almeno 70' })
    expect(sentence(r, tradePlan(r), null)).toContain('Manca un criterio: Forza relativa almeno 70')
  })

  it('explains a stock without a base', () => {
    const r = row({ vcpStatus: null, pivot: null, pivotDistancePct: null })
    expect(sentence(r, tradePlan(r), null)).toMatch(/nessuna base/i)
  })
})

describe('planFor', () => {
  it('does not call weak fundamentals a buy, so no alert email goes out for them', () => {
    const out = planFor(row({ fundamentals: { epsGrowthQoq: 0, salesGrowthQoq: -14, roe: 12 } }), { caution: null, market: 'healthy' })
    expect(out.plan.verdict).toBe('weak-fundamentals')
  })

  it('turns a buy into "wait for confirmation" with the market open and keeps the note', () => {
    const out = planFor(row(), { caution: 'session', market: 'healthy' })
    expect(out.plan.verdict).toBe('confirm')
    expect(out.note).toBe('session')
  })

  it('keeps a buy in normal conditions', () => {
    expect(planFor(row(), { caution: null, market: null })).toMatchObject({ plan: { verdict: 'buy' }, note: null })
  })
})

describe('MARKET_TEXT', () => {
  it('words each level with the rounded percentage', () => {
    expect(MARKET_TEXT.healthy(68.4)).toBe('Mercato in salute: 68% dei titoli è sopra le medie a 150 e 200 giorni.')
    expect(MARKET_TEXT.weak(35)).toBe('Mercato debole: solo 35% dei titoli è sopra le medie a 150 e 200 giorni.')
  })
})

describe('toScanRow', () => {
  const result = {
    symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout',
    pivot: 98, pivotDistancePct: 2, volumeRatio: 1.8, criteria: [],
  }

  it('maps a stored result and leaves "missing" empty for an 8-of-8 stock', () => {
    expect(toScanRow(result)).toEqual({ ...row(), missing: null, fundamentals: null, avwap: null })
  })

  it('carries the stored fundamentals and VWAP, and drops them when none was stored', () => {
    const r = toScanRow({ ...result, epsGrowthQoq: 40, salesGrowthQoq: null, roe: 18, avwap: 99.5 })
    expect(r.fundamentals).toEqual({ epsGrowthQoq: 40, salesGrowthQoq: null, roe: 18 })
    expect(r.avwap).toBe(99.5)
    expect(toScanRow({ ...result, epsGrowthQoq: null, salesGrowthQoq: null, roe: null }).fundamentals).toBeNull()
  })

  it('names the failed criterion of a 7-of-8 stock', () => {
    const criteria = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: `c${i + 1}`, ok: i !== 4, value: '', margin: null }))
    expect(toScanRow({ ...result, passedCount: 7, criteria }).missing).toBe('c5')
  })

  it('survives missing numbers and criteria', () => {
    const r = toScanRow({ ...result, price: null, passedCount: null, criteria: null })
    expect(r.price).toBe(0)
    expect(r.passedCount).toBe(0)
  })
})

describe('duringSession', () => {
  it('is true when the scan started or ended while the US market was open', () => {
    expect(duringSession(new Date('2026-11-16T14:00:00Z'), new Date('2026-11-16T14:03:00Z'))).toBe(true)
    expect(duringSession(new Date('2026-11-16T20:59:00Z'), new Date('2026-11-16T21:02:00Z'))).toBe(true)
    expect(duringSession(new Date('2026-11-16T13:29:00Z'), new Date('2026-11-16T13:31:00Z'))).toBe(true)
  })

  it('is false for a scan entirely outside the session or a missing end', () => {
    expect(duringSession(new Date('2026-11-16T22:00:00Z'), new Date('2026-11-16T22:03:00Z'))).toBe(false)
    expect(duringSession(new Date('2026-11-14T15:00:00Z'), null)).toBe(false)
  })
})

describe('planForAnalysis', () => {
  const DAY = 86_400_000
  const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * 0.5
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })
  const analysis = (over: Partial<MinerviniAnalysis> = {}): MinerviniAnalysis => ({ template: evaluateTrendTemplate(bars, 90)!, vcp: detectVcp(bars), peerCount: 12, ...over })
  // A breakout the way the scanner sees it: 8 criteria, strong volume, a base.
  const breakout = (over: Partial<MinerviniAnalysis> = {}): MinerviniAnalysis => {
    const a = analysis(over)
    return { ...a, vcp: { ...a.vcp, status: 'breakout', pivot: 98, volumeRatio: 1.8, volumeDryUp: true, base: null, avwap: null }, ...over }
  }

  it('builds the same row the scanner would store, from the analysis of the stock page', () => {
    const a = breakout()
    const row = rowFromAnalysis('AAA', a)
    expect(row).toMatchObject({ symbol: 'AAA', passedCount: a.template.passedCount, vcpStatus: 'breakout', pivot: 98, volumeRatio: 1.8, fundamentals: null, avwap: null })
    expect(row.price).toBeGreaterThan(0)
  })

  it('gives the same plan as the scanner for the same numbers', () => {
    const a = breakout({ fundamentals: { epsGrowthQoq: 40, salesGrowthQoq: 30, roe: 20 }, avwap: 90 })
    const out = planForAnalysis('AAA', a)
    expect(out.plan).toEqual(planFor(rowFromAnalysis('AAA', a), { caution: null, market: null }).plan)
  })

  it('says weak fundamentals for Everest Group numbers', () => {
    const out = planForAnalysis('EG', breakout({ fundamentals: { epsGrowthQoq: 0.18, salesGrowthQoq: -13.85, roe: 12.51 } }))
    expect(out.row.passedCount).toBe(8)
    expect(out.plan.verdict).toBe('weak-fundamentals')
  })

  it('prefers the VWAP of the analysis and falls back to the one of the base', () => {
    expect(rowFromAnalysis('A', breakout({ avwap: 77 })).avwap).toBe(77)
    const a = breakout()
    expect(rowFromAnalysis('A', { ...a, vcp: { ...a.vcp, avwap: 66 } }).avwap).toBe(66)
  })
})
