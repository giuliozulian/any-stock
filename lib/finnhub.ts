const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

export interface FinnhubSymbolResult {
  symbol: string
  description: string
  type: string
}

export interface FinnhubQuote {
  currentPrice: number
  changePercent: number
  high: number
  low: number
  open: number
  previousClose: number
}

export interface FinnhubProfile {
  name: string
  exchange: string
  currency: string
  marketCapitalization: number
}

export interface FinnhubMetrics {
  peRatio: number | null
  week52High: number | null
  week52Low: number | null
  pegRatio: number | null
  roe: number | null
  netMargin: number | null
  debtToEquity: number | null
  dividendYield: number | null
  payoutRatio: number | null
  relativePerf13W: number | null
  epsTTM: number | null
  epsGrowth5Y: number | null
}

export interface FinnhubRecommendation {
  period: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

export interface FinnhubNewsItem {
  headline: string
  url: string
  source: string
  summary: string
  datetime: number
}

function apiKey(): string {
  const key = process.env.FINNHUB_API_KEY
  if (!key) throw new Error('FINNHUB_API_KEY is not set')
  return key
}

async function finnhubFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${FINNHUB_BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('token', apiKey())

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Finnhub request failed: ${res.status} ${path}`)
  }
  return res.json() as Promise<T>
}

export async function searchSymbol(query: string): Promise<FinnhubSymbolResult[]> {
  const data = await finnhubFetch<{ result: FinnhubSymbolResult[] }>('/search', { q: query })
  return data.result
}

export async function getQuote(symbol: string): Promise<FinnhubQuote> {
  const data = await finnhubFetch<{ c: number; dp: number; h: number; l: number; o: number; pc: number }>('/quote', { symbol })
  return {
    currentPrice: data.c,
    changePercent: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
  }
}

export async function getProfile(symbol: string): Promise<FinnhubProfile> {
  const data = await finnhubFetch<{
    name: string
    exchange: string
    currency: string
    marketCapitalization: number
  }>('/stock/profile2', { symbol })
  return {
    name: data.name,
    exchange: data.exchange,
    currency: data.currency,
    marketCapitalization: data.marketCapitalization,
  }
}

export async function getMetrics(symbol: string): Promise<FinnhubMetrics> {
  const data = await finnhubFetch<{ metric: Record<string, number | undefined> }>('/stock/metric', {
    symbol,
    metric: 'all',
  })
  return {
    peRatio: data.metric.peBasicExclExtraTTM ?? null,
    week52High: data.metric['52WeekHigh'] ?? null,
    week52Low: data.metric['52WeekLow'] ?? null,
    pegRatio: data.metric.pegTTM ?? null,
    roe: data.metric.roeTTM ?? null,
    netMargin: data.metric.netProfitMarginTTM ?? null,
    debtToEquity: data.metric['totalDebt/totalEquityAnnual'] ?? null,
    dividendYield: data.metric.currentDividendYieldTTM ?? null,
    payoutRatio: data.metric.payoutRatioTTM ?? null,
    relativePerf13W: data.metric['priceRelativeToS&P50013Week'] ?? null,
    epsTTM: data.metric.epsTTM ?? null,
    epsGrowth5Y: data.metric.epsGrowth5Y ?? null,
  }
}

export async function getRecommendationTrend(symbol: string): Promise<FinnhubRecommendation[]> {
  const data = await finnhubFetch<Array<{ symbol: string; period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>>('/stock/recommendation', { symbol })
  return data.map((d) => ({
    period: d.period,
    strongBuy: d.strongBuy,
    buy: d.buy,
    hold: d.hold,
    sell: d.sell,
    strongSell: d.strongSell,
  }))
}

export async function getCompanyNews(symbol: string, fromDate: string, toDate: string): Promise<FinnhubNewsItem[]> {
  const data = await finnhubFetch<Array<{ headline: string; url: string; source: string; summary: string; datetime: number }>>('/company-news', { symbol, from: fromDate, to: toDate })
  return data.map((d) => ({
    headline: d.headline,
    url: d.url,
    source: d.source,
    summary: d.summary,
    datetime: d.datetime,
  }))
}

export interface InsiderTransaction {
  name: string
  change: number
  share: number
  price: number
  transactionDate: string
  filingDate: string
  code: string
  id?: string
}

export interface InsiderSentimentMonth {
  year: number
  month: number
  change: number
  mspr: number
}

export async function getInsiderTransactions(symbol: string): Promise<InsiderTransaction[]> {
  const data = await finnhubFetch<{
    data?: Array<{ name: string; change: number; share: number; transactionPrice: number; transactionDate: string; filingDate: string; transactionCode: string; isDerivative?: boolean; id?: string }>
  }>('/stock/insider-transactions', { symbol, from: '2016-01-01' })
  return (data.data ?? [])
    .filter((t) => !t.isDerivative)
    .map((t) => ({
      name: t.name,
      change: t.change,
      share: t.share,
      price: t.transactionPrice,
      transactionDate: t.transactionDate,
      filingDate: t.filingDate,
      code: t.transactionCode,
      id: t.id,
    }))
}

export async function getInsiderSentiment(symbol: string, from: string): Promise<InsiderSentimentMonth[]> {
  const data = await finnhubFetch<{ data?: InsiderSentimentMonth[] }>('/stock/insider-sentiment', { symbol, from })
  return (data.data ?? []).map((m) => ({ year: m.year, month: m.month, change: m.change, mspr: m.mspr }))
}
