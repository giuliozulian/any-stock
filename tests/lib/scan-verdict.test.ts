import { describe, expect, it } from 'vitest'
import { MARKET_TEXT, VERDICT, duringSession, fmtNum, fmtPrice, planFor, sentence, toScanRow, type ScanRow } from '@/lib/scan-verdict'
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
    expect(new Set(ranks).size).toBe(7)
    expect(VERDICT.buy.label).toBe('Si può comprare')
    expect(VERDICT.confirm.label).toBe('Aspetta conferma')
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
    expect(toScanRow(result)).toEqual({ ...row(), missing: null })
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
