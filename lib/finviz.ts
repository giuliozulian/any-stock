// The Finviz free screener, with the Minervini/CAN SLIM filters saved.
// The terms of Finviz discourage automated access to the screener: keep the number of requests small and never retry in a loop.

// Price over $10, average volume over 500K, EPS and sales growth quarter over quarter over 25%, ROE over 15%, price above the 200-day average, 50-day above 200-day.
export const FINVIZ_FILTERS = ['sh_price_o10', 'sh_avgvol_o500', 'fa_epsqoq_o25', 'fa_salesqoq_o25', 'fa_roe_o15', 'ta_sma200_pa', 'ta_sma50_sa200']

export const PAGE_SIZE = 20
export const MAX_PAGES = 5
const PAGE_DELAY_MS = 1000

// The 52-week and "price above SMA50" filters are Elite-only (or a single slot), so they are applied on the rows.
export const MAX_BELOW_HIGH = -25
export const MIN_ABOVE_LOW = 30

// v=171 is the Technical view: SMA and 52-week columns come as % distances from the price.
export function finvizUrl(offset = 0): string {
  return `https://finviz.com/screener/stocks?v=171&f=${FINVIZ_FILTERS.join('%2C')}${offset > 0 ? `&r=${offset + 1}` : ''}`
}

export interface FinvizRow {
  symbol: string
  price: number
  sma50: number
  sma200: number
  high52: number
  low52: number
}

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

function number(text: string): number | null {
  const n = Number(text.replace(/[%,\s]/g, ''))
  return text.trim() !== '' && text.trim() !== '-' && Number.isFinite(n) ? n : null
}

export function parseScreener(html: string): { rows: FinvizRow[]; total: number | null } {
  const total = html.match(/#\d+ \/ ([\d,]+) Total/)?.[1]
  const rows: FinvizRow[] = []
  for (const chunk of html.split('data-row-key="').slice(1)) {
    const symbol = chunk.slice(0, chunk.indexOf('"')).toUpperCase()
    if (!SYMBOL.test(symbol)) continue
    const cells = new Map<string, string>()
    for (const m of chunk.matchAll(/data-column-id="(\w+)"[^>]*>([\s\S]*?)<\/div>/g)) cells.set(m[1], m[2].replace(/<[^>]*>/g, '').trim())
    const [price, sma50, sma200, high52, low52] = ['price', 'sma50', 'sma200', 'high52w', 'low52w'].map((id) => number(cells.get(id) ?? ''))
    if (price === null || sma50 === null || sma200 === null || high52 === null || low52 === null) continue
    rows.push({ symbol, price, sma50, sma200, high52, low52 })
  }
  return { rows, total: total ? Number(total.replace(/,/g, '')) : null }
}

// What the free filters cannot express: above the 50-day, near the high, well off the low.
export function passesTechnical(r: FinvizRow): boolean {
  return r.sma50 > 0 && r.high52 >= MAX_BELOW_HIGH && r.low52 >= MIN_ABOVE_LOW
}

export class FinvizUnavailableError extends Error {}

export interface FinvizFetchResult {
  rows: FinvizRow[]
  total: number
  // True when the list had more pages than we are willing to read.
  truncated: boolean
}

export async function fetchFinvizRows(fetchPage: (url: string) => Promise<string> = defaultFetch, wait: (ms: number) => Promise<void> = sleep): Promise<FinvizFetchResult> {
  const rows: FinvizRow[] = []
  let total = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await wait(PAGE_DELAY_MS)
    const parsed = parseScreener(await fetchPage(finvizUrl(page * PAGE_SIZE)))
    if (parsed.total === null) throw new FinvizUnavailableError('Finviz did not return the screener table')
    total = parsed.total
    rows.push(...parsed.rows)
    if ((page + 1) * PAGE_SIZE >= total) break
  }
  return { rows, total, truncated: total > MAX_PAGES * PAGE_SIZE }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new FinvizUnavailableError(`Finviz answered ${res.status}`)
  return res.text()
}
