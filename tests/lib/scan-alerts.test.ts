import { describe, expect, it } from 'vitest'
import { buildScanEmail, collectAlerts, escapeHtml, type EmailInput, type EmailItem } from '@/lib/scan-alerts'
import { planFor, type ScanRow } from '@/lib/scan-verdict'
import type { PlanContext } from '@/lib/scanner'

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 102, rs: 90, passedCount: 8, vcpStatus: 'breakout', pivot: 100, pivotDistancePct: 2, volumeRatio: 1.8, missing: null, ...over,
})
const NO_CTX: PlanContext = { caution: null, market: null }
const item = (over: Partial<ScanRow> = {}, reason: EmailItem['reason'] = 'watched', ctx: PlanContext = NO_CTX): EmailItem => {
  const r = row(over)
  return { row: r, ...planFor(r, ctx), reason }
}
const input = (items: EmailItem[], over: Partial<EmailInput> = {}): EmailInput => ({ items, market: null, sessionScan: false, appUrl: null, ...over })

describe('collectAlerts', () => {
  it('watches the armed stocks that reached 8 of 8, ignoring the others', () => {
    expect(collectAlerts({ full: ['AAA', 'BBB'], armed: ['AAA', 'CCC'], newEntrantsOn: false, knownFull: [] })).toEqual({ watched: ['AAA'], entrants: [] })
  })

  it('adds the new 8-of-8 stocks only when the switch is on', () => {
    const base = { full: ['AAA', 'BBB', 'CCC'], armed: [], knownFull: ['AAA'] }
    expect(collectAlerts({ ...base, newEntrantsOn: false }).entrants).toEqual([])
    expect(collectAlerts({ ...base, newEntrantsOn: true }).entrants).toEqual(['BBB', 'CCC'])
  })

  it('never lists a stock twice: a watched stock is not also a new entrant', () => {
    expect(collectAlerts({ full: ['AAA', 'BBB'], armed: ['BBB'], newEntrantsOn: true, knownFull: [] })).toEqual({ watched: ['BBB'], entrants: ['AAA'] })
  })

  it('says nothing when there is nothing new', () => {
    expect(collectAlerts({ full: [], armed: ['AAA'], newEntrantsOn: true, knownFull: [] })).toEqual({ watched: [], entrants: [] })
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
  })
})

describe('buildScanEmail subject', () => {
  it('names the stock when there is one', () => {
    expect(buildScanEmail(input([item()])).subject).toBe('Scanner Minervini: AAA ha raggiunto 8 su 8')
  })

  it('counts and lists the stocks, strongest relative strength first', () => {
    const { subject } = buildScanEmail(input([item({ symbol: 'LOW', rs: 75 }), item({ symbol: 'TOP', rs: 99 })]))
    expect(subject).toBe('Scanner Minervini: 2 titoli hanno raggiunto 8 su 8 (TOP, LOW)')
  })
})

describe('buildScanEmail content', () => {
  it('writes buy range, stop and profit zone on separate lines, with the maximum loss', () => {
    const { text } = buildScanEmail(input([item()]))
    expect(text).toContain('Cosa fare: Si può comprare')
    expect(text).toContain('Compra: tra 100,00 e 105,00')
    expect(text).toContain('Vendi sotto: 93,84 (perdita massima circa 8,0%)')
    expect(text).toContain('Profitto: verso 122,40–127,50')
  })

  it('says "sopra" for a stock still below its pivot', () => {
    const { text } = buildScanEmail(input([item({ vcpStatus: 'forming', price: 96, pivotDistancePct: -4, volumeRatio: 1 })]))
    expect(text).toContain('Cosa fare: Da tenere d’occhio')
    expect(text).toContain('Compra: sopra 100,00')
  })

  it('says there are no prices when there is nothing to buy', () => {
    const { text, html } = buildScanEmail(input([item({ vcpStatus: null, pivot: null, pivotDistancePct: null })]))
    expect(text).toContain('Prezzi: nessuno')
    expect(html).toContain('Nessun punto d’ingresso')
    expect(text).not.toContain('Vendi sotto')
  })

  it('shows relative strength, pivot with distance and volume against the average', () => {
    const { text } = buildScanEmail(input([item()]))
    expect(text).toContain('Forza relativa: 90')
    expect(text).toContain('Pivot: 100,00, 2,0% sopra')
    expect(text).toContain('Volume: +80% sulla media')
  })

  it('names why each stock is in the email', () => {
    const { text } = buildScanEmail(input([item({ symbol: 'AAA', rs: 99 }, 'watched'), item({ symbol: 'BBB', rs: 80 }, 'new')]))
    expect(text).toContain('Motivo: Lo seguivi')
    expect(text).toContain('Motivo: Nuovo negli 8 su 8')
  })

  it('opens with the health of the market and the partial-volume warning', () => {
    const { text } = buildScanEmail(input([item()], { market: { abovePct: 35, level: 'weak' }, sessionScan: true }))
    expect(text).toContain('Mercato debole: solo 35% dei titoli')
    expect(text).toContain('mercato aperto')
  })

  it('links to the stock page when APP_URL is known, tolerating a trailing slash', () => {
    const { text, html } = buildScanEmail(input([item({ symbol: 'BRK.B' })], { appUrl: 'https://app.example.com/' }))
    expect(text).toContain('Scheda: https://app.example.com/stock/BRK.B')
    expect(html).toContain('href="https://app.example.com/stock/BRK.B"')
  })

  it('has no link when APP_URL is unknown', () => {
    const { text, html } = buildScanEmail(input([item()]))
    expect(text).not.toContain('Scheda:')
    expect(html).not.toContain('href=')
  })

  it('ends with the disclaimer in both formats', () => {
    const { text, html } = buildScanEmail(input([item()]))
    expect(text).toContain('non è consulenza finanziaria')
    expect(html).toContain('non è consulenza finanziaria')
  })

  it('is a narrow html document with inline styles', () => {
    const { html } = buildScanEmail(input([item()]))
    expect(html).toContain('max-width:600px')
    expect(html).toContain('Si può comprare')
  })
})

describe('buildScanEmail escaping', () => {
  it('escapes company data in the html and leaves the plain text untouched', () => {
    const evil = { name: '<b>Evil</b> & "Co"', sector: 'A<B' }
    const { html, text } = buildScanEmail(input([item(evil)]))
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; &quot;Co&quot;')
    expect(html).toContain('A&lt;B')
    expect(html).not.toContain('<b>Evil')
    expect(text).toContain('<b>Evil</b> & "Co"')
  })

  it('escapes a hostile link base', () => {
    const { html } = buildScanEmail(input([item()], { appUrl: 'https://x.test/"><script>' }))
    expect(html).not.toContain('<script>')
  })
})
