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
  industry?: string
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
    finnhubIndustry?: string
  }>('/stock/profile2', { symbol })
  return {
    name: data.name,
    exchange: data.exchange,
    currency: data.currency,
    marketCapitalization: data.marketCapitalization,
    industry: data.finnhubIndustry || undefined,
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

export interface NextEarnings {
  date: string
  hour: string | null
  epsEstimate: number | null
}

export async function getNextEarnings(symbol: string, today: Date = new Date()): Promise<NextEarnings | null> {
  const from = today.toISOString().slice(0, 10)
  const to = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const data = await finnhubFetch<{
    earningsCalendar?: Array<{ date: string; hour?: string; epsEstimate?: number | null }>
  }>('/calendar/earnings', { symbol, from, to })
  const upcoming = (data.earningsCalendar ?? [])
    .filter((e) => e.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  if (!upcoming) return null
  return { date: upcoming.date, hour: upcoming.hour || null, epsEstimate: upcoming.epsEstimate ?? null }
}

export interface IpoEvent {
  date: string
  name: string
  symbol: string | null
  exchange: string | null
  price: string | null
  shares: number | null
  totalValue: number | null
  status: string | null
}

export async function getIpoCalendar(from: string, to: string): Promise<IpoEvent[]> {
  const data = await finnhubFetch<{
    ipoCalendar?: Array<{ date: string; name: string; symbol?: string; exchange?: string; price?: string; numberOfShares?: number; totalSharesValue?: number; status?: string }>
  }>('/calendar/ipo', { from, to })
  return (data.ipoCalendar ?? [])
    .map((e) => ({
      date: e.date,
      name: e.name,
      symbol: e.symbol || null,
      exchange: e.exchange || null,
      price: e.price || null,
      shares: e.numberOfShares ?? null,
      totalValue: e.totalSharesValue ?? null,
      status: e.status || null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (b.totalValue ?? 0) - (a.totalValue ?? 0))
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
