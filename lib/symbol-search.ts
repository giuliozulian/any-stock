import { searchSymbol, type FinnhubSymbolResult } from './finnhub'
import { searchYahoo } from './yahoo-quote'

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/i
const MAX_RESULTS = 8

// Finnhub first (it is the source of fundamentals), then Yahoo for the venues Finnhub's free plan does not cover.
// An ISIN is only known to Finnhub under one venue (e.g. ".L"), so its base ticker is searched again on Yahoo to find the Borsa Italiana line (".MI").
export async function searchSymbols(query: string): Promise<FinnhubSymbolResult[]> {
  const [finnhub, yahoo] = await Promise.allSettled([searchSymbol(query), searchYahoo(query)])
  if (finnhub.status === 'rejected' && yahoo.status === 'rejected') throw finnhub.reason

  const found = finnhub.status === 'fulfilled' ? finnhub.value : []
  const results = [...found]
  if (yahoo.status === 'fulfilled') results.push(...yahoo.value)

  if (ISIN.test(query)) {
    const bases = new Set(found.map((r) => r.symbol.split('.')[0]))
    for (const base of bases) {
      const siblings = await searchYahoo(base).catch(() => [])
      results.push(...siblings.filter((r) => r.symbol.startsWith(`${base}.`)))
    }
  }

  const seen = new Set<string>()
  return results.filter((r) => !seen.has(r.symbol) && seen.add(r.symbol)).slice(0, MAX_RESULTS)
}
