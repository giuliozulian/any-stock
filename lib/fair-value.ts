import {
  AAA_YIELD,
  DCF_GROWTH_MAX,
  DISCOUNT_RATE,
  GRAHAM_GROWTH_MAX,
  LYNCH_PE_MAX,
  LYNCH_PE_MIN,
  MIN_BOOK_TO_PRICE,
  RELIABLE_MAX_SPREAD,
  TERMINAL_GROWTH,
} from '@/lib/valuation-config'

export interface FairValueInput {
  price: number
  epsTTM: number | null
  bookValuePerShare: number | null
  epsGrowth5Y: number | null
  dividendYield: number | null
  priceToFcf: number | null
}

export type FairValueKey = 'graham-number' | 'graham-growth' | 'lynch' | 'cash-flow'

export interface FairValueModel {
  key: FairValueKey
  label: string
  value: number
}

export interface ExcludedModel {
  key: FairValueKey
  label: string
  reason: string
}

export type FairValuePosition = 'below' | 'inside' | 'above' | 'unclear'

export interface FairValueSummary {
  low: number
  high: number
  median: number
  spread: number
  reliable: boolean
  position: FairValuePosition
  premiumPct: number | null
}

export interface FairValueResult extends FairValueSummary {
  models: FairValueModel[]
  excluded: ExcludedModel[]
}

const LABELS: Record<FairValueKey, string> = {
  'graham-number': 'Numero di Graham',
  'graham-growth': 'Graham con crescita',
  lynch: 'Peter Lynch',
  'cash-flow': 'Flussi di cassa scontati',
}

const NO_EPS = 'Utile per azione negativo o assente.'
const NO_GROWTH = 'Crescita degli utili non disponibile.'
const INVALID = 'Il calcolo non ha dato un valore valido.'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

// P/E equal to growth plus dividend yield (both in %), kept between sensible bounds. The only Lynch formula of the app.
export function lynchValue(eps: number, growthPct: number, dividendYieldPct: number): number {
  return eps * clamp(growthPct + dividendYieldPct, LYNCH_PE_MIN, LYNCH_PE_MAX)
}

// Ten years of free cash flow per share growing at `growthPct`, plus a terminal value, all discounted.
function cashFlowValue(fcfPerShare: number, growthPct: number): number {
  const g = clamp(growthPct, 0, DCF_GROWTH_MAX) / 100
  let value = 0
  let cf = fcfPerShare
  for (let year = 1; year <= 10; year++) {
    cf *= 1 + g
    value += cf / (1 + DISCOUNT_RATE) ** year
  }
  const terminal = (cf * (1 + TERMINAL_GROWTH)) / (DISCOUNT_RATE - TERMINAL_GROWTH)
  return value + terminal / (1 + DISCOUNT_RATE) ** 10
}

export function buildFairValueInput(
  price: number,
  metrics: { epsTTM: number | null; bookValuePerShare?: number | null; epsGrowth5Y: number | null; dividendYield: number | null; priceToFcf?: number | null },
): FairValueInput {
  return {
    price,
    epsTTM: metrics.epsTTM,
    bookValuePerShare: metrics.bookValuePerShare ?? null,
    epsGrowth5Y: metrics.epsGrowth5Y,
    dividendYield: metrics.dividendYield,
    priceToFcf: metrics.priceToFcf ?? null,
  }
}

// Every model is applied only when its data make sense; a model left out says why.
export function fairValueModels(input: FairValueInput): { models: FairValueModel[]; excluded: ExcludedModel[] } {
  const { price, bookValuePerShare, epsGrowth5Y, dividendYield, priceToFcf } = input
  const eps = isNum(input.epsTTM) && input.epsTTM > 0 ? input.epsTTM : null
  const growth = isNum(epsGrowth5Y) ? epsGrowth5Y : null
  const dividend = isNum(dividendYield) ? dividendYield : 0
  const fcf = isNum(priceToFcf) && priceToFcf > 0 && isNum(price) && price > 0 ? price / priceToFcf : null

  const models: FairValueModel[] = []
  const excluded: ExcludedModel[] = []
  const exclude = (key: FairValueKey, reason: string) => excluded.push({ key, label: LABELS[key], reason })
  const accept = (key: FairValueKey, value: number) => {
    if (Number.isFinite(value) && value > 0) models.push({ key, label: LABELS[key], value })
    else exclude(key, INVALID)
  }

  if (eps === null || !isNum(bookValuePerShare) || bookValuePerShare <= 0) {
    exclude('graham-number', 'Mancano utile o patrimonio per azione positivi.')
  } else if (bookValuePerShare < MIN_BOOK_TO_PRICE * price) {
    exclude('graham-number', 'Patrimonio per azione troppo piccolo rispetto al prezzo: il metodo non vale per aziende con pochi attivi.')
  } else {
    accept('graham-number', Math.sqrt(22.5 * eps * bookValuePerShare))
  }

  if (eps === null) exclude('graham-growth', NO_EPS)
  else if (growth === null) exclude('graham-growth', NO_GROWTH)
  else accept('graham-growth', (eps * (8.5 + 2 * clamp(growth, 0, GRAHAM_GROWTH_MAX)) * 4.4) / AAA_YIELD)

  if (eps === null) exclude('lynch', NO_EPS)
  else if (growth === null || growth <= 0) exclude('lynch', 'Crescita degli utili non disponibile o non positiva.')
  else accept('lynch', lynchValue(eps, growth, dividend))

  if (fcf === null) exclude('cash-flow', 'Flusso di cassa libero non disponibile o negativo.')
  else if (growth === null) exclude('cash-flow', NO_GROWTH)
  else accept('cash-flow', cashFlowValue(fcf, growth))

  return { models, excluded }
}

// Range, median and a verdict on whether the models agree. Needs at least two models.
export function summarizeModels(models: FairValueModel[], price: number): FairValueSummary | null {
  if (models.length < 2 || !(price > 0)) return null
  const values = models.map((model) => model.value).sort((a, b) => a - b)
  const low = values[0]
  const high = values[values.length - 1]
  const middle = values.length >> 1
  const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  const spread = high / low
  const reliable = spread <= RELIABLE_MAX_SPREAD
  const position: FairValuePosition = !reliable ? 'unclear' : price < low ? 'below' : price > high ? 'above' : 'inside'
  return { low, high, median, spread, reliable, position, premiumPct: reliable ? ((price - median) / median) * 100 : null }
}

export function fairValue(input: FairValueInput): FairValueResult | null {
  const { models, excluded } = fairValueModels(input)
  const summary = summarizeModels(models, input.price)
  return summary ? { ...summary, models, excluded } : null
}
