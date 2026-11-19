export type SortKey = 'sym' | 'settore' | 'prezzo' | 'cap' | 'oggi' | 'da' | 'agg'
export type Trend = 'tutti' | 'su' | 'giu' | 'guadagno' | 'perdita'

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'sym', label: 'Titolo' },
  { key: 'settore', label: 'Settore' },
  { key: 'prezzo', label: 'Prezzo' },
  { key: 'cap', label: 'Capitalizzazione' },
  { key: 'oggi', label: 'Oggi' },
  { key: 'da', label: 'Da quando lo segui' },
  { key: 'agg', label: 'Aggiunto il' },
]

export const TREND_OPTIONS: { key: Trend; label: string }[] = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'su', label: 'Oggi in rialzo' },
  { key: 'giu', label: 'Oggi in ribasso' },
  { key: 'guadagno', label: 'In guadagno' },
  { key: 'perdita', label: 'In perdita' },
]

export interface ViewRow {
  symbol: string
  name: string
  sector: string | null
  price: number | null
  marketCap: number | null
  changePct: number | null
  sincePct: number | null
  addedAt: Date
  hasAlert: boolean
}

export interface ViewParams {
  ordina?: string
  dir?: string
  settore?: string
  andamento?: string
  avvisi?: string
  q?: string
}

export interface WatchlistView {
  sortKey: SortKey | null
  sortDir: 'asc' | 'desc'
  sector: string | null
  trend: Trend
  onlyAlerts: boolean
  query: string
}

const TEXT_FIRST: SortKey[] = ['sym', 'settore']

// Words and numbers read straight from the address bar: anything that is not a known value falls back to "no filter".
export function parseView(params: ViewParams, knownSectors: string[] = []): WatchlistView {
  const sortKey = SORT_OPTIONS.find((o) => o.key === params.ordina)?.key ?? null
  return {
    sortKey,
    sortDir: params.dir === 'asc' ? 'asc' : 'desc',
    sector: params.settore && knownSectors.includes(params.settore) ? params.settore : null,
    trend: TREND_OPTIONS.find((o) => o.key === params.andamento)?.key ?? 'tutti',
    onlyAlerts: params.avvisi === '1',
    query: (params.q ?? '').trim().slice(0, 40),
  }
}

export function isFiltered(view: WatchlistView): boolean {
  return view.sector !== null || view.trend !== 'tutti' || view.onlyAlerts || view.query !== ''
}

// Query string for a link that keeps the current view and changes `over`; empty values are left out.
export function viewHref(view: WatchlistView, over: Partial<Record<keyof ViewParams, string>> = {}): string {
  const base: ViewParams = {
    ordina: view.sortKey ?? '',
    dir: view.sortKey ? view.sortDir : '',
    settore: view.sector ?? '',
    andamento: view.trend === 'tutti' ? '' : view.trend,
    avvisi: view.onlyAlerts ? '1' : '',
    q: view.query,
  }
  const merged = { ...base, ...over }
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `/?${s}` : '/'
}

// Direction a sort link points to: names start A-Z, numbers and dates start from the largest; clicking the active one flips it.
export function nextSortDir(view: WatchlistView, key: SortKey): 'asc' | 'desc' {
  const active = view.sortKey === key
  if (TEXT_FIRST.includes(key)) return active && view.sortDir === 'asc' ? 'desc' : 'asc'
  return active && view.sortDir === 'desc' ? 'asc' : 'desc'
}

function sortValue(row: ViewRow, key: SortKey): number | string | null {
  switch (key) {
    case 'sym':
      return row.symbol
    case 'settore':
      return row.sector
    case 'prezzo':
      return row.price
    case 'cap':
      return row.marketCap
    case 'oggi':
      return row.changePct
    case 'da':
      return row.sincePct
    case 'agg':
      return row.addedAt.getTime()
  }
}

export function applyView<T extends ViewRow>(rows: T[], view: WatchlistView): T[] {
  const q = view.query.toLowerCase()
  const kept = rows.filter((r) => {
    if (view.sector !== null && r.sector !== view.sector) return false
    if (view.onlyAlerts && !r.hasAlert) return false
    if (q && !r.symbol.toLowerCase().startsWith(q) && !r.name.toLowerCase().includes(q)) return false
    switch (view.trend) {
      case 'su':
        return (r.changePct ?? 0) > 0
      case 'giu':
        return (r.changePct ?? 0) < 0
      case 'guadagno':
        return (r.sincePct ?? 0) > 0
      case 'perdita':
        return (r.sincePct ?? 0) < 0
      default:
        return true
    }
  })
  const key = view.sortKey
  if (!key) return kept
  // Rows with no value for the chosen column go last in either direction.
  return [...kept].sort((a, b) => {
    const x = sortValue(a, key)
    const y = sortValue(b, key)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    const cmp = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)
    return view.sortDir === 'asc' ? cmp : -cmp
  })
}
