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
  bookValuePerShare?: number | null
  cashFlowPerShare?: number | null
  priceToFcf?: number | null
  // Percent change of the latest quarter over the same quarter a year before (Finnhub sends 12.5 for +12.5%).
  epsGrowthQuarterlyYoy?: number | null
  revenueGrowthQuarterlyYoy?: number | null
}

export interface FinnhubRecommendation {
  period: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

// Companies Finnhub groups with the given one (same industry), the symbol itself first; empty on failure paths is up to the caller.
export async function getPeers(symbol: string): Promise<string[]> {
  const data = await finnhubFetch<string[]>('/stock/peers', { symbol })
  return Array.isArray(data) ? data.filter((s) => typeof s === 'string' && s !== symbol) : []
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
    bookValuePerShare: data.metric.bookValuePerShareAnnual ?? null,
    cashFlowPerShare: data.metric.cashFlowPerShareTTM ?? null,
    priceToFcf: data.metric.pfcfShareTTM ?? null,
    epsGrowthQuarterlyYoy: data.metric.epsGrowthQuarterlyYoy ?? null,
    revenueGrowthQuarterlyYoy: data.metric.revenueGrowthQuarterlyYoy ?? null,
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

export interface EarningsSurprise {
  period: string
  actual: number | null
  estimate: number | null
  surprisePercent: number | null
}

// Ultimi trimestri: EPS reale contro la stima degli analisti (più recente per primo).
export async function getEarningsSurprises(symbol: string): Promise<EarningsSurprise[]> {
  const data = await finnhubFetch<Array<{ period: string; actual: number | null; estimate: number | null; surprisePercent: number | null }>>('/stock/earnings', { symbol, limit: '4' })
  return data
    .map((d) => ({ period: d.period, actual: d.actual ?? null, estimate: d.estimate ?? null, surprisePercent: d.surprisePercent ?? null }))
    .sort((a, b) => b.period.localeCompare(a.period))
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

export interface ReportedEarnings {
  date: string
  hour: string | null
  epsActual: number | null
  epsEstimate: number | null
}

// Results published between two dates (inclusive), with the EPS actually reported next to the analysts' estimate.
export async function getReportedEarnings(symbol: string, from: string, to: string): Promise<ReportedEarnings[]> {
  const data = await finnhubFetch<{
    earningsCalendar?: Array<{ date: string; hour?: string; epsActual?: number | null; epsEstimate?: number | null }>
  }>('/calendar/earnings', { symbol, from, to })
  return (data.earningsCalendar ?? [])
    .filter((e) => e.date >= from && e.date <= to)
    .map((e) => ({ date: e.date, hour: e.hour || null, epsActual: e.epsActual ?? null, epsEstimate: e.epsEstimate ?? null }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export interface EarningsEvent {
  symbol: string
  date: string
  hour: string | null
  epsEstimate: number | null
  revenueEstimate: number | null
  // Only filled once the company has reported.
  epsActual: number | null
  revenueActual: number | null
}

export async function getEarningsCalendar(from: string, to: string): Promise<EarningsEvent[]> {
  const data = await finnhubFetch<{
    earningsCalendar?: Array<{ symbol: string; date: string; hour?: string; epsEstimate?: number | null; revenueEstimate?: number | null; epsActual?: number | null; revenueActual?: number | null }>
  }>('/calendar/earnings', { from, to })
  return (data.earningsCalendar ?? []).map((e) => ({
    symbol: e.symbol,
    date: e.date,
    hour: e.hour || null,
    epsEstimate: e.epsEstimate ?? null,
    revenueEstimate: e.revenueEstimate ?? null,
    epsActual: e.epsActual ?? null,
    revenueActual: e.revenueActual ?? null,
  }))
}

export interface EarningsHistoryRow {
  // Day of the report; null for old quarters the calendar no longer lists.
  date: string | null
  hour: string | null
  // Fiscal period the report refers to, with its closing day.
  quarter: number | null
  year: number | null
  period: string | null
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
}

// Per-quarter history of one company. The EPS series (last quarters, with period) comes from the earnings endpoint; the calendar
// adds report day, hour and the revenue figures, and brings in the quarters still to come. The two are joined on fiscal year and quarter.
export async function getEarningsHistory(symbol: string, from: string, to: string): Promise<EarningsHistoryRow[]> {
  const [past, calendar] = await Promise.all([
    finnhubFetch<Array<{ period: string; year?: number; quarter?: number; actual?: number | null; estimate?: number | null }>>('/stock/earnings', { symbol }).catch(() => []),
    finnhubFetch<{
      earningsCalendar?: Array<{ date: string; hour?: string; quarter?: number; year?: number; epsEstimate?: number | null; revenueEstimate?: number | null; epsActual?: number | null; revenueActual?: number | null }>
    }>('/calendar/earnings', { symbol, from, to }).then((d) => d.earningsCalendar ?? []),
  ])
  const key = (year: number | null | undefined, quarter: number | null | undefined) => (year && quarter ? `${year}-${quarter}` : null)
  const rows = new Map<string, EarningsHistoryRow>()
  const blank = (): EarningsHistoryRow => ({ date: null, hour: null, quarter: null, year: null, period: null, epsEstimate: null, epsActual: null, revenueEstimate: null, revenueActual: null })
  for (const e of Array.isArray(past) ? past : []) {
    const k = key(e.year, e.quarter) ?? `p-${e.period}`
    rows.set(k, { ...blank(), quarter: e.quarter ?? null, year: e.year ?? null, period: e.period, epsActual: e.actual ?? null, epsEstimate: e.estimate ?? null })
  }
  for (const e of calendar) {
    const k = key(e.year, e.quarter) ?? `d-${e.date}`
    const prev = rows.get(k) ?? blank()
    rows.set(k, {
      ...prev,
      date: e.date,
      hour: e.hour || null,
      quarter: e.quarter ?? prev.quarter,
      year: e.year ?? prev.year,
      epsActual: e.epsActual ?? prev.epsActual,
      epsEstimate: e.epsEstimate ?? prev.epsEstimate,
      revenueActual: e.revenueActual ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
    })
  }
  const order = (r: EarningsHistoryRow) => r.date ?? r.period ?? ''
  return [...rows.values()].sort((a, b) => order(b).localeCompare(order(a)))
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
