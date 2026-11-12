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
