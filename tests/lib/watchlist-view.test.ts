import { describe, expect, it } from 'vitest'
import { applyView, isFiltered, nextSortDir, parseView, viewHref, type ViewRow } from '@/lib/watchlist-view'

const row = (symbol: string, over: Partial<ViewRow> = {}): ViewRow => ({
  symbol,
  name: `${symbol} Inc`,
  sector: 'Tecnologia',
  price: 100,
  marketCap: 1e11,
  changePct: 0,
  sincePct: 0,
  addedAt: new Date('2026-11-01'),
  hasAlert: false,
  ...over,
})

const ROWS = [
  row('AAPL', { name: 'Apple', price: 200, marketCap: 3e12, changePct: 1.5, sincePct: 10, addedAt: new Date('2026-10-01') }),
  row('XOM', { name: 'Exxon Mobil', sector: 'Energia', price: 110, marketCap: 4e11, changePct: -2, sincePct: -5, addedAt: new Date('2026-11-10'), hasAlert: true }),
  row('NVDA', { name: 'Nvidia', price: 140, marketCap: null, changePct: 3, sincePct: null, addedAt: new Date('2026-11-05') }),
]
const view = (params = {}) => parseView(params, ['Tecnologia', 'Energia'])
const symbols = (rows: ViewRow[]) => rows.map((r) => r.symbol)

describe('parseView', () => {
  it('falls back to no filter and no sort for unknown or missing values', () => {
    expect(view({ ordina: 'boh', andamento: 'boh', settore: 'Inventato' })).toEqual({ sortKey: null, sortDir: 'desc', sector: null, trend: 'tutti', onlyAlerts: false, query: '' })
    expect(isFiltered(view())).toBe(false)
  })
  it('reads sort, direction, sector, trend, alerts and a trimmed search', () => {
    expect(view({ ordina: 'cap', dir: 'asc', settore: 'Energia', andamento: 'giu', avvisi: '1', q: '  xo ' })).toEqual({ sortKey: 'cap', sortDir: 'asc', sector: 'Energia', trend: 'giu', onlyAlerts: true, query: 'xo' })
    expect(isFiltered(view({ q: 'x' }))).toBe(true)
  })
})

describe('applyView filters', () => {
  it('filters by sector, by alerts and by symbol start or name', () => {
    expect(symbols(applyView(ROWS, view({ settore: 'Energia' })))).toEqual(['XOM'])
    expect(symbols(applyView(ROWS, view({ avvisi: '1' })))).toEqual(['XOM'])
    expect(symbols(applyView(ROWS, view({ q: 'nv' })))).toEqual(['NVDA'])
    expect(symbols(applyView(ROWS, view({ q: 'mobil' })))).toEqual(['XOM'])
  })
  it('filters by today and by gain since following; an unknown value counts as neither up nor down', () => {
    expect(symbols(applyView(ROWS, view({ andamento: 'su' })))).toEqual(['AAPL', 'NVDA'])
    expect(symbols(applyView(ROWS, view({ andamento: 'giu' })))).toEqual(['XOM'])
    expect(symbols(applyView(ROWS, view({ andamento: 'guadagno' })))).toEqual(['AAPL'])
    expect(symbols(applyView(ROWS, view({ andamento: 'perdita' })))).toEqual(['XOM'])
  })
  it('combines filters', () => {
    expect(symbols(applyView(ROWS, view({ andamento: 'su', settore: 'Tecnologia', q: 'app' })))).toEqual(['AAPL'])
  })
})

describe('applyView sorting', () => {
  it('keeps the original order without a sort key', () => {
    expect(symbols(applyView(ROWS, view()))).toEqual(['AAPL', 'XOM', 'NVDA'])
  })
  it('sorts names A-Z and numbers high to low, and flips on request', () => {
    expect(symbols(applyView(ROWS, view({ ordina: 'sym', dir: 'asc' })))).toEqual(['AAPL', 'NVDA', 'XOM'])
    expect(symbols(applyView(ROWS, view({ ordina: 'prezzo' })))).toEqual(['AAPL', 'NVDA', 'XOM'])
    expect(symbols(applyView(ROWS, view({ ordina: 'prezzo', dir: 'asc' })))).toEqual(['XOM', 'NVDA', 'AAPL'])
  })
  it('sorts by date added, newest first by default', () => {
    expect(symbols(applyView(ROWS, view({ ordina: 'agg' })))).toEqual(['XOM', 'NVDA', 'AAPL'])
  })
  it('puts rows with no value last in either direction', () => {
    expect(symbols(applyView(ROWS, view({ ordina: 'cap' })))).toEqual(['AAPL', 'XOM', 'NVDA'])
    expect(symbols(applyView(ROWS, view({ ordina: 'cap', dir: 'asc' })))).toEqual(['XOM', 'AAPL', 'NVDA'])
  })
})

describe('viewHref and nextSortDir', () => {
  it('keeps the view in a link and leaves out empty values', () => {
    expect(viewHref(view())).toBe('/')
    expect(viewHref(view({ settore: 'Energia', andamento: 'su' }), { ordina: 'oggi', dir: 'desc' })).toBe('/?ordina=oggi&dir=desc&settore=Energia&andamento=su')
    expect(viewHref(view({ settore: 'Energia' }), { settore: '' })).toBe('/')
  })
  it('starts text columns A-Z and number columns high to low, and flips the active one', () => {
    expect(nextSortDir(view(), 'sym')).toBe('asc')
    expect(nextSortDir(view({ ordina: 'sym', dir: 'asc' }), 'sym')).toBe('desc')
    expect(nextSortDir(view(), 'oggi')).toBe('desc')
    expect(nextSortDir(view({ ordina: 'oggi', dir: 'desc' }), 'oggi')).toBe('asc')
  })
})
