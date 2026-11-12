export interface YearFinancials {
  year: number
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  netIncome: number | null
  eps: number | null
  operatingCashFlow: number | null
  totalAssets: number | null
  totalLiabilities: number | null
  currentAssets: number | null
  currentLiabilities: number | null
  retainedEarnings: number | null
  longTermDebt: number | null
  shares: number | null
}

interface ReportItem {
  concept: string
  value: number
}

interface ReportedFiling {
  year: number
  form: string
  report?: { bs?: ReportItem[]; ic?: ReportItem[]; cf?: ReportItem[] }
}

const TTL_MS = 12 * 60 * 60 * 1000
const cache = new Map<string, { at: number; years: YearFinancials[] }>()

function pick(items: ReportItem[] | undefined, concepts: string[]): number | null {
  if (!items) return null
  for (const concept of concepts) {
    const hit = items.find((i) => i.concept === `us-gaap_${concept}`)
    if (hit && typeof hit.value === 'number' && Number.isFinite(hit.value)) return hit.value
  }
  return null
}

// Annual 10-K filings as reported to the SEC; concept names differ per company, so each figure has fallbacks.
export function parseAnnualFilings(filings: ReportedFiling[]): YearFinancials[] {
  return filings
    .filter((f) => f.report)
    .map((f) => {
      const { bs, ic, cf } = f.report!
      const revenue = pick(ic, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'])
      const cost = pick(ic, ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'])
      const totalAssets = pick(bs, ['Assets'])
      const equity = pick(bs, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'])
      return {
        year: f.year,
        revenue,
        grossProfit: pick(ic, ['GrossProfit']) ?? (revenue !== null && cost !== null ? revenue - cost : null),
        operatingIncome: pick(ic, ['OperatingIncomeLoss']),
        netIncome: pick(ic, ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']),
        eps: pick(ic, ['EarningsPerShareDiluted', 'EarningsPerShareBasic']),
        operatingCashFlow: pick(cf, ['NetCashProvidedByUsedInOperatingActivities']),
        totalAssets,
        totalLiabilities: pick(bs, ['Liabilities']) ?? (totalAssets !== null && equity !== null ? totalAssets - equity : null),
        currentAssets: pick(bs, ['AssetsCurrent']),
        currentLiabilities: pick(bs, ['LiabilitiesCurrent']),
        retainedEarnings: pick(bs, ['RetainedEarningsAccumulatedDeficit']),
        longTermDebt: pick(bs, ['LongTermDebtNoncurrent', 'LongTermDebt', 'ConvertibleNotesPayableNoncurrent']),
        shares: pick(ic, ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic']),
      }
    })
    .sort((a, b) => a.year - b.year)
}

// Returns an empty list when Finnhub is unavailable, so the section can degrade.
export async function getAnnualFinancials(symbol: string): Promise<YearFinancials[]> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.years

  try {
    const token = process.env.FINNHUB_API_KEY
    if (!token) return []
    const res = await fetch(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${encodeURIComponent(key)}&freq=annual&token=${token}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return hit?.years ?? []
    const json = (await res.json()) as { data?: ReportedFiling[] }
    const years = parseAnnualFilings(json.data ?? [])
    if (years.length > 0) cache.set(key, { at: Date.now(), years })
    return years
  } catch {
    return hit?.years ?? []
  }
}
