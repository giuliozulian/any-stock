export type NewsTone = 'positive' | 'negative' | 'neutral'

export interface NewsImpact {
  tone: NewsTone
  signals: string[]
  direct: boolean
}

const POSITIVE = [
  'upgrade', 'upgrades', 'upgraded', 'raises price target', 'raises target', 'price target raised', 'beat', 'beats',
  'record', 'records', 'surge', 'surges', 'soar', 'soars', 'jump', 'jumps', 'rally', 'rallies', 'rises', 'gains',
  'growth', 'profit', 'profits', 'approval', 'approved', 'wins', 'contract', 'buyback', 'dividend increase',
  'outperform', 'bullish', 'undervalued', 'partnership', 'breakthrough', 'expands', 'strong demand',
]

const NEGATIVE = [
  'downgrade', 'downgrades', 'downgraded', 'cuts price target', 'lowers target', 'miss', 'misses', 'missed',
  'plunge', 'plunges', 'slump', 'slumps', 'tumble', 'tumbles', 'falls', 'drops', 'sinks', 'lawsuit', 'sued', 'probe',
  'investigation', 'recall', 'recalls', 'warning', 'layoffs', 'loss', 'losses', 'bearish', 'fraud', 'delay',
  'delayed', 'ban', 'tariff', 'tariffs', 'overvalued', 'concern', 'concerns', 'worry', 'risk', 'risks', 'ousted', 'pressure',
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase()
  return terms.filter((t) => new RegExp(`\\b${escapeRegex(t)}\\b`).test(lower))
}

function companyKeyword(name: string): string {
  return name
    .replace(/\b(inc|corp|corporation|co|company|ltd|plc|holdings|group)\b\.?/gi, '')
    .replace(/[,.]/g, ' ')
    .trim()
    .toLowerCase()
}

export function analyzeNewsImpact(
  news: { headline: string; summary: string | null },
  stock: { symbol: string; name: string }
): NewsImpact {
  const body = news.summary ?? ''
  const headlinePos = findTerms(news.headline, POSITIVE)
  const headlineNeg = findTerms(news.headline, NEGATIVE)
  const bodyPos = findTerms(body, POSITIVE).filter((t) => !headlinePos.includes(t))
  const bodyNeg = findTerms(body, NEGATIVE).filter((t) => !headlineNeg.includes(t))

  const score = (headlinePos.length - headlineNeg.length) * 2 + (bodyPos.length - bodyNeg.length)
  const tone: NewsTone = score >= 2 ? 'positive' : score <= -2 ? 'negative' : 'neutral'

  const lowerHeadline = news.headline.toLowerCase()
  const keyword = companyKeyword(stock.name)
  const direct =
    new RegExp(`\\b${escapeRegex(stock.symbol.toLowerCase())}\\b`).test(lowerHeadline) ||
    (keyword.length > 0 && lowerHeadline.includes(keyword))

  const signals = tone === 'positive' ? [...headlinePos, ...bodyPos] : tone === 'negative' ? [...headlineNeg, ...bodyNeg] : []
  const allSignals = signals.length > 0 ? signals : [...headlinePos, ...headlineNeg, ...bodyPos, ...bodyNeg]

  return { tone, signals: allSignals, direct }
}
