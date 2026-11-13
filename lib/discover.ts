const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v)

export interface ScoreInput {
  price: number
  week52High: number | null
  week52Low: number | null
  changePct: number
  pegRatio: number | null
  roe: number | null
  debtToEquity: number | null
  congressSignalScore: number | null
  insiderBuyerCount: number
  market: 'US' | 'IT'
}

export interface CandidateScore {
  momentumScore: number
  fundamentalsScore: number
  insiderScore: number
  score: number
  reason: string
}

function momentumScoreOf(input: ScoreInput): number {
  const movePoints = clamp(Math.abs(input.changePct) / 30 * 100, 0, 100)
  if (input.week52High === null || input.week52Low === null || input.week52High <= input.week52Low) {
    return round(movePoints)
  }
  const rangePoints = clamp((input.price - input.week52Low) / (input.week52High - input.week52Low), 0, 1) * 100
  return round((rangePoints + movePoints) / 2)
}

function fundamentalsScoreOf(input: ScoreInput): number {
  const pegPoints = input.pegRatio === null || input.pegRatio <= 0 ? 0 : input.pegRatio <= 1 ? 40 : input.pegRatio <= 2 ? 20 : 0
  const roePoints = input.roe === null ? 0 : input.roe > 15 ? 40 : input.roe > 0 ? 20 : 0
  const debtPoints = input.debtToEquity === null ? 0 : input.debtToEquity < 1 ? 20 : input.debtToEquity < 2 ? 10 : 0
  return pegPoints + roePoints + debtPoints
}

function insiderScoreOf(input: ScoreInput): number {
  if (input.market === 'IT') return 0
  const congressPoints = input.congressSignalScore === null ? 0 : clamp(input.congressSignalScore / 12 * 100, 0, 100)
  const insiderPoints = clamp(input.insiderBuyerCount * 25, 0, 100)
  return round(Math.max(congressPoints, insiderPoints))
}

function buildReason(input: ScoreInput, s: { momentumScore: number; fundamentalsScore: number; insiderScore: number }): string {
  const parts: string[] = []
  if (s.momentumScore >= 60) {
    const sign = input.changePct >= 0 ? '+' : ''
    parts.push(`movimento forte (${sign}${input.changePct.toFixed(1)}%)`)
  }
  if (s.fundamentalsScore >= 60) {
    parts.push(`fondamentali solidi (PEG ${input.pegRatio?.toFixed(1) ?? '—'}, ROE ${input.roe?.toFixed(0) ?? '—'}%)`)
  }
  if (input.market === 'US' && s.insiderScore >= 50) {
    parts.push(input.congressSignalScore !== null ? 'acquisto recente di membri del Congresso' : 'acquisti insider recenti')
  }
  if (parts.length === 0) {
    parts.push('segnale debole su tutti i fronti, incluso solo perché tra i candidati del giorno')
  }
  let reason = parts.join(', ')
  reason = reason.charAt(0).toUpperCase() + reason.slice(1) + '.'
  if (input.market === 'IT') {
    reason += ' Mercato italiano: nessun segnale insider/congress disponibile per questo titolo — solo momentum e fondamentali.'
  }
  return reason
}

export function scoreCandidate(input: ScoreInput): CandidateScore {
  const momentumScore = momentumScoreOf(input)
  const fundamentalsScore = fundamentalsScoreOf(input)
  const insiderScore = insiderScoreOf(input)
  const score = round(
    input.market === 'IT'
      ? (momentumScore + fundamentalsScore) / 2
      : (momentumScore + fundamentalsScore + insiderScore) / 3
  )
  const reason = buildReason(input, { momentumScore, fundamentalsScore, insiderScore })
  return { momentumScore, fundamentalsScore, insiderScore, score, reason }
}
