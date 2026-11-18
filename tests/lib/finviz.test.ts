import { describe, expect, it, vi } from 'vitest'
import { FinvizUnavailableError, MAX_PAGES, PAGE_SIZE, fetchFinvizRows, finvizUrl, parseScreener, passesTechnical, type FinvizRow } from '@/lib/finviz'

const cell = (id: string, v: string) => `<div aria-colindex="3" class="fv-table_cell" data-column-id="${id}" role="gridcell" style="left:1px"><span>${v}</span></div>`
const row = (symbol: string, o: Partial<Record<string, string>> = {}) =>
  `<div class="fv-table_row" data-row-key="${symbol}" role="row">${cell('ticker', symbol)}${cell('beta', '1.1')}${cell('sma50', o.sma50 ?? '5.00%')}${cell('sma200', o.sma200 ?? '20.00%')}${cell('high52w', o.high52w ?? '-10.00%')}${cell('low52w', o.low52w ?? '80.00%')}${cell('price', o.price ?? '100.50')}</div>`
const page = (total: number, ...rows: string[]) => `<p class="fv-table_toolbar-count">#1 / ${total} Total</p>${rows.join('')}`

describe('finviz', () => {
  it('builds the screener url with every saved filter and the page offset', () => {
    expect(finvizUrl()).toBe('https://finviz.com/screener/stocks?v=171&f=sh_price_o10%2Csh_avgvol_o500%2Cfa_epsqoq_o25%2Cfa_salesqoq_o25%2Cfa_roe_o15%2Cta_sma200_pa%2Cta_sma50_sa200')
    expect(finvizUrl(20)).toContain('&r=21')
  })

  it('reads symbol and the technical columns, and the total', () => {
    const { rows, total } = parseScreener(page(1234, row('ANET', { price: '1,193.32', high52w: '-11.08%' })))
    expect(total).toBe(1234)
    expect(rows).toEqual([{ symbol: 'ANET', price: 1193.32, sma50: 5, sma200: 20, high52: -11.08, low52: 80 }])
  })

  it('skips rows with a missing or non numeric column and invalid symbols', () => {
    const html = page(3, row('AAA', { sma50: '-' }), row('bad symbol!'), row('OK'))
    expect(parseScreener(html).rows.map((r) => r.symbol)).toEqual(['OK'])
  })

  it('keeps a stock only above the 50-day, within 25% of the high and 30% above the low', () => {
    const ok: FinvizRow = { symbol: 'A', price: 10, sma50: 0.5, sma200: 10, high52: -25, low52: 30 }
    expect(passesTechnical(ok)).toBe(true)
    expect(passesTechnical({ ...ok, sma50: -0.1 })).toBe(false)
    expect(passesTechnical({ ...ok, high52: -25.1 })).toBe(false)
    expect(passesTechnical({ ...ok, low52: 29.9 })).toBe(false)
  })

  it('reads the pages until the total is covered, pausing between requests', async () => {
    const fetchPage = vi.fn(async (url: string) => (url.includes('&r=21') ? page(25, row('BBB')) : page(25, row('AAA'))))
    const wait = vi.fn(async () => {})
    const result = await fetchFinvizRows(fetchPage, wait)
    expect(result.rows.map((r) => r.symbol)).toEqual(['AAA', 'BBB'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(result.truncated).toBe(false)
  })

  it('never reads more than the page cap and says the list was cut', async () => {
    const fetchPage = vi.fn(async () => page(10_000, row('AAA')))
    const result = await fetchFinvizRows(fetchPage, async () => {})
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES)
    expect(result.truncated).toBe(true)
    expect(MAX_PAGES * PAGE_SIZE).toBeLessThan(10_000)
  })

  it('fails when the page is not the screener table (blocked or changed)', async () => {
    await expect(fetchFinvizRows(async () => '<html>Just a moment...</html>', async () => {})).rejects.toBeInstanceOf(FinvizUnavailableError)
  })

  it('answers an empty list when Finviz finds nothing', async () => {
    const result = await fetchFinvizRows(async () => page(0), async () => {})
    expect(result).toEqual({ rows: [], total: 0, truncated: false })
  })
})
