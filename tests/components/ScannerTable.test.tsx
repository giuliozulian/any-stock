import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ScannerTable, type ScannerRow } from '@/components/ScannerTable'
import { TREND_TEMPLATE_LABELS } from '@/lib/minervini'

const row = (over: Partial<ScannerRow>): ScannerRow => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Tech', price: 100, rs: 90, passedCount: 8, vcpStatus: null, pivot: null, pivotDistancePct: null, volumeRatio: null, missing: null, ...over,
})

const rows = [
  row({ symbol: 'LOW', name: 'Low RS', rs: 75, sector: 'Energy' }),
  row({ symbol: 'TOP', name: 'Top RS', rs: 99, price: 100, vcpStatus: 'forming', pivot: 105, pivotDistancePct: -4.8 }),
  row({ symbol: 'BRK', name: 'Breaking', rs: 80, price: 50.6, vcpStatus: 'breakout', pivot: 50, pivotDistancePct: 1.2, volumeRatio: 1.8 }),
  row({ symbol: 'NEAR', name: 'Near miss', rs: 60, passedCount: 7, missing: TREND_TEMPLATE_LABELS[7] }),
]

const hrefs = () =>
  within(screen.getByRole('list'))
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'))
    .filter((h) => h?.startsWith('/stock/'))
const rowOf = (symbol: string) => within(screen.getByRole('list')).getByText(symbol, { selector: 'span' }).closest('a')!

describe('ScannerTable groups and order', () => {
  it('shows the 8-of-8 stocks first, sorted by RS, each linking to its page', () => {
    render(<ScannerTable rows={rows} />)
    expect(hrefs()).toEqual(['/stock/TOP', '/stock/BRK', '/stock/LOW'])
  })

  it('counts each group on its switch', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.getByRole('button', { name: /8 su 8/ })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: /quasi/i })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /8 su 8/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to the stocks that miss one criterion and names it', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(hrefs()).toEqual(['/stock/NEAR'])
    expect(within(rowOf('NEAR')).getByText(new RegExp(TREND_TEMPLATE_LABELS[7]))).toBeInTheDocument()
  })

  it('says what to do when nothing passes', () => {
    render(<ScannerTable rows={[row({ symbol: 'NEAR', passedCount: 7, missing: 'x' })]} />)
    expect(screen.getByText(/nessun titolo supera tutti i criteri/i)).toBeInTheDocument()
  })
})

describe('what to do, at what price, until when', () => {
  it('says "Si può comprare" with the buy range, the stop and the profit zone for a confirmed breakout', () => {
    render(<ScannerTable rows={rows} />)
    const r = within(rowOf('BRK'))
    expect(r.getByText('Si può comprare')).toBeInTheDocument()
    expect(r.getByText('tra 50,00 e 52,50')).toBeInTheDocument()
    expect(r.getByText('46,55')).toBeInTheDocument()
    expect(r.getByText(/perdita massima circa 8,0%/i)).toBeInTheDocument()
    expect(r.getByText('verso 60,72–63,25')).toBeInTheDocument()
    expect(r.getByText(/\+80%/)).toBeInTheDocument()
  })

  it('says to wait while the price is below the pivot, and only buy above it', () => {
    render(<ScannerTable rows={rows} />)
    const r = within(rowOf('TOP'))
    expect(r.getByText('Da tenere d’occhio')).toBeInTheDocument()
    expect(r.getByText('sopra 105,00')).toBeInTheDocument()
    expect(r.getByText('96,60')).toBeInTheDocument()
  })

  it('says to wait for confirmation when the breakout has weak volume', () => {
    render(<ScannerTable rows={[row({ symbol: 'WEAK', vcpStatus: 'breakout', pivot: 30, price: 30.3, pivotDistancePct: 1, volumeRatio: 0.9 })]} />)
    const r = within(rowOf('WEAK'))
    expect(r.getByText('Aspetta conferma')).toBeInTheDocument()
    expect(r.getByText(/pochi scambi/i)).toBeInTheDocument()
  })

  it('gives no prices when there is nothing to buy', () => {
    render(<ScannerTable rows={rows} />)
    const r = within(rowOf('LOW'))
    expect(r.getByText('Nessun punto d’ingresso')).toBeInTheDocument()
    expect(r.queryByText(/^tra /)).not.toBeInTheDocument()
    expect(r.queryByText('Vendi sotto')).not.toBeInTheDocument()
  })

  it.each([
    ['extended', 'Troppo tardi', /inseguire/i],
    ['failed', 'Da evitare', /setup è saltato/i],
  ] as const)('explains a %s base in plain words', (vcpStatus, label, text) => {
    render(<ScannerTable rows={[row({ symbol: 'X', vcpStatus, pivot: 10, price: 12, pivotDistancePct: 20 })]} />)
    const r = within(rowOf('X'))
    expect(r.getByText(label)).toBeInTheDocument()
    expect(r.getByText(text)).toBeInTheDocument()
  })

  it('tells how to exit and what to do if it rises', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.getByText(/vendi se il prezzo chiude sotto lo stop/i)).toBeInTheDocument()
    expect(screen.getByText(/non è consulenza finanziaria/i)).toBeInTheDocument()
  })

  it('names the stocks to buy above the list, with their prices', () => {
    render(<ScannerTable rows={rows} />)
    const note = screen.getByText(/si può comprare ora secondo il metodo/i).closest('p')!
    expect(within(note).getByRole('link', { name: 'BRK' })).toHaveAttribute('href', '/stock/BRK')
    expect(note).toHaveTextContent('tra 50,00 e 52,50')
    expect(note).toHaveTextContent('stop 46,55')
    expect(within(note).queryByRole('link', { name: 'TOP' })).not.toBeInTheDocument()
  })

  it('says so when none can be bought now', () => {
    render(<ScannerTable rows={[row({ symbol: 'LOW' })]} />)
    expect(screen.getByText(/nessun titolo da comprare adesso/i)).toBeInTheDocument()
  })
})

describe('sortable columns', () => {
  it('sorts by symbol, and a second click reverses it', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Titolo' }))
    expect(hrefs()).toEqual(['/stock/BRK', '/stock/LOW', '/stock/TOP'])
    fireEvent.click(screen.getByRole('button', { name: 'Titolo' }))
    expect(hrefs()).toEqual(['/stock/TOP', '/stock/LOW', '/stock/BRK'])
  })

  it('reverses the default RS order to lowest first', () => {
    render(<ScannerTable rows={rows} />)
    const rsHeader = screen.getByRole('button', { name: 'Forza relativa' })
    expect(rsHeader).toHaveAttribute('data-sort', 'desc')
    fireEvent.click(rsHeader)
    expect(hrefs()).toEqual(['/stock/LOW', '/stock/BRK', '/stock/TOP'])
    expect(rsHeader).toHaveAttribute('data-sort', 'asc')
  })

  it('sorts by what to do: buy first, then watch, then the rest', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cosa fare' }))
    expect(hrefs()).toEqual(['/stock/BRK', '/stock/TOP', '/stock/LOW'])
  })

  it('keeps stocks without a pivot last in either direction', () => {
    render(<ScannerTable rows={rows} />)
    const header = screen.getByRole('button', { name: 'Distanza dal pivot' })
    fireEvent.click(header)
    expect(hrefs()).toEqual(['/stock/BRK', '/stock/TOP', '/stock/LOW'])
    fireEvent.click(header)
    expect(hrefs()).toEqual(['/stock/TOP', '/stock/BRK', '/stock/LOW'])
  })

  it('also sorts from the select used on small screens', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.change(screen.getByRole('combobox', { name: /ordina/i }), { target: { value: 'pivot' } })
    expect(hrefs()).toEqual(['/stock/BRK', '/stock/TOP', '/stock/LOW'])
  })
})

describe('filters', () => {
  it('filters by what to do', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Si può comprare' }))
    expect(hrefs()).toEqual(['/stock/BRK'])
    fireEvent.click(screen.getByRole('button', { name: 'Da tenere d’occhio' }))
    expect(hrefs()).toEqual(['/stock/TOP'])
    fireEvent.click(screen.getByRole('button', { name: 'Tutti' }))
    expect(hrefs()).toHaveLength(3)
  })

  it('counts a filtered-out group fully on its switch', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Si può comprare' }))
    expect(screen.getByRole('button', { name: /8 su 8/ })).toHaveTextContent('3')
  })

  it('searches by symbol or name, ignoring case', () => {
    render(<ScannerTable rows={rows} />)
    const search = screen.getByRole('searchbox', { name: /cerca/i })
    fireEvent.change(search, { target: { value: 'break' } })
    expect(hrefs()).toEqual(['/stock/BRK'])
    fireEvent.change(search, { target: { value: 'top' } })
    expect(hrefs()).toEqual(['/stock/TOP'])
  })

  it('filters by sector, listing only sectors that exist', () => {
    render(<ScannerTable rows={rows} />)
    const sector = screen.getByRole('combobox', { name: /settore/i })
    expect(within(sector).getAllByRole('option').map((o) => o.textContent)).toEqual(['Tutti i settori', 'Energy', 'Tech'])
    fireEvent.change(sector, { target: { value: 'Energy' } })
    expect(hrefs()).toEqual(['/stock/LOW'])
  })

  it('filters by minimum RS', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.change(screen.getByRole('combobox', { name: /rs minima/i }), { target: { value: '80' } })
    expect(hrefs()).toEqual(['/stock/TOP', '/stock/BRK'])
  })

  it('shows how many of the group are visible and resets every filter', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.queryByRole('button', { name: /azzera/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: /cerca/i }), { target: { value: 'top' } })
    fireEvent.click(screen.getByRole('button', { name: 'Si può comprare' }))
    expect(screen.getByText('Mostro 0 di 3')).toBeInTheDocument()
    expect(screen.getByText(/nessun titolo con questi filtri/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /azzera/i }))
    expect(screen.getByText('Mostro 3 di 3')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /cerca/i })).toHaveValue('')
  })

  it('keeps filters when switching group', () => {
    render(<ScannerTable rows={rows} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /cerca/i }), { target: { value: 'near' } })
    expect(screen.getByText(/nessun titolo con questi filtri/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(hrefs()).toEqual(['/stock/NEAR'])
  })
})

describe('explanations', () => {
  it('explains the groups, what to do, prices, relative strength and pivot distance with tooltips', () => {
    render(<ScannerTable rows={rows} />)
    for (const name of ['Spiegazione dei gruppi', 'Come leggere Cosa fare', 'Come leggere i prezzi', 'Cos’è la forza relativa', 'Cos’è la distanza dal pivot']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('spells out every verdict, each price line and the pivot scale', () => {
    render(<ScannerTable rows={rows} />)
    const tips = screen.getAllByRole('tooltip').map((t) => t.textContent ?? '').join(' ')
    for (const word of ['Si può comprare', 'Aspetta conferma', 'Da tenere d’occhio', 'Troppo tardi', 'Da evitare', 'Compra', 'Vendi sotto', 'Profitto', 'zona verde']) expect(tips).toContain(word)
  })

  it('writes a dash for a missing RS', () => {
    render(<ScannerTable rows={[row({ symbol: 'NORS', rs: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('context of the scan', () => {
  it('turns a buy into "wait for confirmation" when the scan ran with the US market open', () => {
    render(<ScannerTable rows={rows} caution="session" />)
    const r = within(rowOf('BRK'))
    expect(r.getByText('Aspetta conferma')).toBeInTheDocument()
    expect(r.getByText(/volume di oggi è parziale/i)).toBeInTheDocument()
    expect(screen.getByText(/nessun titolo da comprare adesso/i)).toBeInTheDocument()
  })

  it('turns a buy into "wait for confirmation" in a weak market and says why', () => {
    render(<ScannerTable rows={rows} market={{ abovePct: 35, level: 'weak' }} />)
    const r = within(rowOf('BRK'))
    expect(r.getByText('Aspetta conferma')).toBeInTheDocument()
    expect(r.getByText(/il mercato è debole/i)).toBeInTheDocument()
  })

  it('keeps the buy on old results but warns to check today’s price', () => {
    render(<ScannerTable rows={rows} caution="stale" />)
    const r = within(rowOf('BRK'))
    expect(r.getByText('Si può comprare')).toBeInTheDocument()
    expect(r.getByText(/dati vecchi: controlla il prezzo di oggi/i)).toBeInTheDocument()
    expect(within(rowOf('TOP')).getByText(/dati vecchi/i)).toBeInTheDocument()
    expect(within(rowOf('LOW')).queryByText(/dati vecchi/i)).not.toBeInTheDocument()
    expect(screen.getByText(/alla scansione, da riverificare/i)).toBeInTheDocument()
  })

  it('shows the health of the market with its numbers', () => {
    const { rerender } = render(<ScannerTable rows={rows} market={{ abovePct: 68.4, level: 'healthy' }} />)
    expect(screen.getByText(/mercato in salute: 68% dei titoli/i)).toBeInTheDocument()
    rerender(<ScannerTable rows={rows} market={{ abovePct: 52, level: 'neutral' }} />)
    expect(screen.getByText(/mercato neutro: 52% dei titoli/i)).toBeInTheDocument()
    rerender(<ScannerTable rows={rows} market={{ abovePct: 35, level: 'weak' }} />)
    expect(screen.getByText(/mercato debole: solo 35% dei titoli/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cos’è la salute del mercato' })).toBeInTheDocument()
  })

  it('shows no market line without data', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.queryByText(/mercato (in salute|neutro|debole)/i)).not.toBeInTheDocument()
  })

  it('sorts by what to do using the adjusted verdict', () => {
    render(<ScannerTable rows={rows} market={{ abovePct: 35, level: 'weak' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cosa fare' }))
    // BRK is now "confirm" (rank 1) and still ahead of TOP "watch" (rank 2).
    expect(hrefs()).toEqual(['/stock/BRK', '/stock/TOP', '/stock/LOW'])
  })
})

describe('email alerts', () => {
  const alerts = { emailReady: true, armed: ['NEAR'], newEntrants: false }

  it('shows no bell and no switch without the alerts prop', () => {
    render(<ScannerTable rows={rows} />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avvisami|avviso attivo/i })).not.toBeInTheDocument()
  })

  it('puts a bell on the stocks that are not ready to buy yet, not on the ones that are', () => {
    render(<ScannerTable rows={rows} alerts={{ ...alerts, armed: [] }} />)
    const bells = () => screen.queryAllByRole('button', { name: /avvisami per email quando/i }).map((b) => b.getAttribute('aria-label'))
    expect(bells()).toContain('Avvisami per email quando TOP si può comprare')
    expect(bells()).not.toContain('Avvisami per email quando BRK si può comprare')
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(bells()).toContain('Avvisami per email quando NEAR si può comprare')
  })

  it('keeps the bell outside the link of the row', () => {
    render(<ScannerTable rows={rows} alerts={{ ...alerts, armed: [] }} />)
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    const bell = screen.getByRole('button', { name: 'Avvisami per email quando NEAR si può comprare' })
    expect(bell.closest('a')).toBeNull()
    expect(hrefs()).toHaveLength(1)
  })

  it('shows the switch with the saved state', () => {
    render(<ScannerTable rows={rows} alerts={{ ...alerts, newEntrants: true }} />)
    expect(screen.getByRole('switch', { name: /titolo è da comprare/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('disables bells and switch when email is not configured', () => {
    render(<ScannerTable rows={rows} alerts={{ emailReady: false, armed: [], newEntrants: false }} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /quasi/i }))
    expect(screen.getByRole('button', { name: /avvisami per email quando NEAR/i })).toBeDisabled()
  })
})

describe('TradingView link', () => {
  it('opens each stock on TradingView in a new tab', () => {
    render(<ScannerTable rows={rows} />)
    const link = screen.getByRole('link', { name: 'Apri TOP su TradingView (nuova scheda)' })
    expect(link).toHaveAttribute('href', 'https://www.tradingview.com/chart/?symbol=TOP')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})
