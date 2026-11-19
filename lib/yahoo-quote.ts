export interface YahooQuote {
  name: string
  exchange: string
  currency: string
  price: number
  changePct: number | null
}

// Yahoo covers exchanges that the free Finnhub plan does not (e.g. Borsa Italiana, ".MI"); used only to preview a symbol.
export async function getYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { longName?: string; shortName?: string; symbol?: string; fullExchangeName?: string; currency?: string; regularMarketPrice?: number; chartPreviousClose?: number } }> }
    }
    const meta = json.chart?.result?.[0]?.meta
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null
    const prev = meta.chartPreviousClose
    return {
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol,
      exchange: meta.fullExchangeName ?? '',
      currency: meta.currency ?? '',
      price: meta.regularMarketPrice,
      changePct: typeof prev === 'number' && prev > 0 ? ((meta.regularMarketPrice - prev) / prev) * 100 : null,
    }
  } catch {
    return null
  }
}

export interface YahooSearchResult {
  symbol: string
  description: string
  type: string
}

const SEARCHABLE_TYPES = new Set(['EQUITY', 'ETF'])

// Yahoo lists every venue of a security (".MI", ".L", ".DE"), where Finnhub's free plan knows only the US ones plus a few more.
export async function searchYahoo(query: string): Promise<YahooSearchResult[]> {
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`Yahoo search failed: ${res.status}`)
  const json = (await res.json()) as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string }> }
  return (json.quotes ?? [])
    .filter((q): q is { symbol: string; shortname?: string; longname?: string; quoteType: string } => Boolean(q.symbol && q.quoteType && SEARCHABLE_TYPES.has(q.quoteType)))
    .map((q) => ({ symbol: q.symbol, description: q.longname ?? q.shortname ?? q.symbol, type: q.quoteType }))
}
