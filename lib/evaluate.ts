export interface SignalResult {
  label: string
  note: string
}

export interface Evaluation {
  sinceWatching: { pct: number | null; sinceDate: Date | null; note: string }
  shortTerm: SignalResult
  mediumTerm: SignalResult & { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
  longTerm: SignalResult
  targetPrice: { value: number | null; upsidePct: number | null; note: string }
  details: {
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    netMargin: number | null
    dividendYield: number | null
    payoutRatio: number | null
  }
}

export interface EvaluateInput {
  latestSnapshot: {
    price: number
    week52High: number | null
    week52Low: number | null
    relativePerf13W: number | null
    pegRatio: number | null
    roe: number | null
    debtToEquity: number | null
    netMargin: number | null
    dividendYield: number | null
    payoutRatio: number | null
    epsTTM: number | null
    epsGrowth5Y: number | null
  }
  earliestSnapshot: { price: number; timestamp: Date } | null
  recentRecommendations: Array<{
    period: Date
    strongBuy: number
    buy: number
    hold: number
    sell: number
    strongSell: number
  }>
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function evaluateSinceWatching(input: EvaluateInput): Evaluation['sinceWatching'] {
  const { latestSnapshot, earliestSnapshot } = input
  if (!earliestSnapshot) {
    return { pct: null, sinceDate: null, note: 'Appena aggiunto, nessun dato storico ancora.' }
  }
  const pct = ((latestSnapshot.price - earliestSnapshot.price) / earliestSnapshot.price) * 100
  const dateStr = earliestSnapshot.timestamp.toLocaleDateString('it-IT')
  const sign = pct >= 0 ? '+' : ''
  return {
    pct,
    sinceDate: earliestSnapshot.timestamp,
    note: `Da quando segui questo titolo (dal ${dateStr}): ${sign}${pct.toFixed(1)}%.`,
  }
}

function evaluateShortTerm(input: EvaluateInput): SignalResult {
  const { price, week52High, week52Low, relativePerf13W } = input.latestSnapshot
  if (week52High === null || week52Low === null || week52High === week52Low || relativePerf13W === null) {
    return { label: 'Neutro', note: 'Dati di momentum non disponibili per questo titolo.' }
  }
  const position52w = (price - week52Low) / (week52High - week52Low)
  if (position52w > 0.8 && relativePerf13W > 0) {
    return {
      label: 'Positivo',
      note:
        "Il prezzo è vicino al massimo delle ultime 52 settimane e sta andando meglio dell'indice S&P 500 nelle ultime 13 settimane.",
    }
  }
  if (position52w < 0.2 && relativePerf13W < 0) {
    return {
      label: 'Negativo',
      note:
        "Il prezzo è vicino al minimo delle ultime 52 settimane e sta andando peggio dell'indice S&P 500 nelle ultime 13 settimane.",
    }
  }
  return {
    label: 'Neutro',
    note: 'Il prezzo non mostra un momentum chiaro rispetto alle ultime 52 settimane e al mercato.',
  }
}

function recommendationScore(r: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }): number {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell
  if (total === 0) return 0
  return (r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / total
}

function evaluateMediumTerm(input: EvaluateInput): Evaluation['mediumTerm'] {
  const recs = input.recentRecommendations
  if (recs.length === 0) {
    return {
      label: 'Nessun dato disponibile',
      note: 'Nessun dato sul consenso degli analisti disponibile per questo titolo.',
      strongBuy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strongSell: 0,
    }
  }

  const latest = recs[0]
  const latestScore = recommendationScore(latest)
  const buyLeaning = latest.strongBuy + latest.buy
  const sellLeaning = latest.sell + latest.strongSell
  const total = buyLeaning + latest.hold + sellLeaning
  const countsNote = `${buyLeaning} analisti su ${total} raccomandano l'acquisto, ${latest.hold} sono neutrali, ${sellLeaning} raccomandano la vendita.`

  let label: string
  if (recs.length === 1) {
    label = latestScore > 0.5 ? 'Consenso positivo' : latestScore < -0.5 ? 'Consenso negativo' : 'Consenso misto'
  } else {
    const previousScore = recommendationScore(recs[1])
    if (latestScore > 0.5 && latestScore >= previousScore) {
      label = 'Consenso positivo, in miglioramento'
    } else if (latestScore > 0.5) {
      label = 'Consenso positivo, ma in calo'
    } else if (latestScore < -0.5) {
      label = 'Consenso negativo'
    } else {
      label = 'Consenso misto'
    }
  }

  return { label, note: countsNote, strongBuy: latest.strongBuy, buy: latest.buy, hold: latest.hold, sell: latest.sell, strongSell: latest.strongSell }
}

function evaluateLongTerm(input: EvaluateInput): SignalResult {
  const { pegRatio, roe, debtToEquity } = input.latestSnapshot
  const pegMeaningful = pegRatio !== null && pegRatio > 0
  const hasAny = pegMeaningful || roe !== null || debtToEquity !== null

  if (!hasAny) {
    return {
      label: 'Dati fondamentali non disponibili',
      note: 'Non ci sono abbastanza dati fondamentali per valutare questo titolo nel lungo periodo.',
    }
  }

  const pegGood = pegMeaningful && (pegRatio as number) <= 1
  const roeNegative = roe !== null && roe <= 0
  const debtElevated = debtToEquity !== null && debtToEquity >= 2
  const roeSolid = roe !== null && roe > 15
  const debtSano = debtToEquity !== null && debtToEquity < 1

  let label: string
  if (roeNegative || debtElevated) {
    label = 'Fondamentali deboli'
  } else if (pegGood && roeSolid && debtSano) {
    label = 'Fondamentali solidi'
  } else {
    label = 'Fondamentali nella norma'
  }

  const pegNote = pegMeaningful ? `PEG ${(pegRatio as number).toFixed(2)}` : 'PEG non disponibile'
  const roeNote = roe !== null ? `ROE ${roe.toFixed(1)}%` : 'ROE non disponibile'
  const debtNote = debtToEquity !== null ? `debito/capitale ${debtToEquity.toFixed(2)}` : 'debito/capitale non disponibile'

  return { label, note: `${pegNote}, ${roeNote}, ${debtNote}.` }
}

function evaluateTargetPrice(input: EvaluateInput): Evaluation['targetPrice'] {
  const { epsGrowth5Y, epsTTM, price } = input.latestSnapshot
  if (epsGrowth5Y === null || epsTTM === null || epsTTM <= 0) {
    return {
      value: null,
      upsidePct: null,
      note: 'Stima non disponibile: utili o crescita storica non adatti a questo calcolo.',
    }
  }
  const fairPE = clamp(epsGrowth5Y, 5, 40)
  const value = fairPE * epsTTM
  const upsidePct = ((value - price) / price) * 100
  return {
    value,
    upsidePct,
    note:
      "Stima indicativa basata sulla crescita storica degli utili (formula P/E = crescita, stile 'Peter Lynch'). Non è una previsione di mercato né un consiglio di investimento.",
  }
}

export function evaluateStock(input: EvaluateInput): Evaluation {
  return {
    sinceWatching: evaluateSinceWatching(input),
    shortTerm: evaluateShortTerm(input),
    mediumTerm: evaluateMediumTerm(input),
    longTerm: evaluateLongTerm(input),
    targetPrice: evaluateTargetPrice(input),
    details: {
      pegRatio: input.latestSnapshot.pegRatio,
      roe: input.latestSnapshot.roe,
      debtToEquity: input.latestSnapshot.debtToEquity,
      netMargin: input.latestSnapshot.netMargin,
      dividendYield: input.latestSnapshot.dividendYield,
      payoutRatio: input.latestSnapshot.payoutRatio,
    },
  }
}
