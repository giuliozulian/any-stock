import { describe, it, expect } from 'vitest'
import { buildStockContext, CONTEXT_MAX_CHARS, SYSTEM_PROMPT, type StockChatInput } from '@/lib/stock-chat-context'
import type { Evaluation } from '@/lib/evaluate'

function evaluation(bigNote = 'ok'): Evaluation {
  return {
    sinceWatching: { pct: 4.2, sinceDate: new Date('2026-09-01T00:00:00Z'), note: 'ok' },
    shortTerm: { label: 'Neutrale', note: bigNote },
    mediumTerm: { label: 'Positivo', note: 'ok', strongBuy: 10, buy: 12, hold: 8, sell: 1, strongSell: 0 },
    longTerm: { label: 'Solido', note: bigNote },
    fairValue: { position: 'inside', reliable: true, low: 150, high: 210, median: 180, note: 'ok' },
    newsImpact: { counted: 2, positive: 1, negative: 0, net: 1, adjustment: 0, note: 'ok' },
    details: { pegRatio: 1.8, roe: 150, debtToEquity: 1.5, netMargin: 25, dividendYield: 0.5, payoutRatio: 15 },
  }
}

const full: StockChatInput = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  exchange: 'NASDAQ',
  snapshot: { price: 189.5, changePct: -1.25, marketCap: 2_900_000, peRatio: 29.1, week52High: 199.6, week52Low: 124.2, dividendYield: 0.5, payoutRatio: 15, epsGrowth5Y: 12.3, timestamp: new Date('2026-11-17T21:05:00Z') },
  evaluation: evaluation(),
  minervini: { stage2: true, criteria: [{ label: 'Prezzo sopra la SMA 200', ok: true }, { label: 'RS sopra 70', ok: false }] },
  earnings: { date: new Date('2026-12-02T00:00:00Z'), hour: 'amc', epsEstimate: 1.62 },
  news: Array.from({ length: 7 }, (_, i) => ({ headline: `Notizia ${i + 1}`, source: 'Reuters', publishedAt: new Date(`2026-11-1${i}T10:00:00Z`) })),
  insiders: { buys: 1, sells: 4, netShares: -9000, buyValue: 10_000, sellValue: 900_000, mood: 'selling' },
  congress: { buys: 2, sells: 0 },
}

const empty: StockChatInput = { ...full, snapshot: null, evaluation: null, minervini: null, earnings: { date: null, hour: null, epsEstimate: null }, news: [], insiders: null, congress: null }

describe('buildStockContext', () => {
  it('describes identity and price with the date of the data', () => {
    const text = buildStockContext(full)
    expect(text).toContain('Apple Inc. (NASDAQ: AAPL)')
    expect(text).toContain('189.50')
    expect(text).toContain('2026-11-17')
    expect(text).toContain('124.20')
  })

  it('includes evaluation, Minervini, earnings, insiders and congress', () => {
    const text = buildStockContext(full)
    expect(text).toContain('VALUTAZIONE DELL’APP')
    expect(text).toContain('Neutrale')
    expect(text).toContain('Prezzo sopra la SMA 200')
    expect(text).toContain('2026-12-02')
    expect(text).toContain('INSIDER')
    expect(text).toContain('CONGRESSO')
  })

  it('omits blocks with no data instead of writing placeholders', () => {
    const text = buildStockContext(empty)
    expect(text).toContain('Apple Inc. (NASDAQ: AAPL)')
    for (const word of ['PREZZO', 'VALUTAZIONE', 'MINERVINI', 'DIVIDENDI', 'TRIMESTRALE', 'NOTIZIE', 'INSIDER', 'CONGRESSO']) {
      expect(text).not.toContain(word)
    }
    expect(text).not.toMatch(/n\/d|null|undefined|NaN/i)
  })

  it('keeps only the five most recent news', () => {
    const text = buildStockContext(full)
    expect(text).toContain('Notizia 1')
    expect(text).toContain('Notizia 5')
    expect(text).not.toContain('Notizia 6')
  })

  it('drops news first when the context is too long', () => {
    const long = { ...full, evaluation: evaluation('x'.repeat(2200)), news: full.news.map((n) => ({ ...n, headline: 'h'.repeat(400) })) }
    const text = buildStockContext(long)
    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS)
    expect(text).not.toContain('NOTIZIE')
    expect(text).toContain('INSIDER')
  })

  it('never exceeds the cap, even when no droppable block is left', () => {
    const text = buildStockContext({ ...full, evaluation: evaluation('x'.repeat(4000)) })
    expect(text.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS)
  })
})

describe('SYSTEM_PROMPT', () => {
  it('states the rules the spec requires', () => {
    expect(SYSTEM_PROMPT).toMatch(/italiano/i)
    expect(SYSTEM_PROMPT).toMatch(/consigli personalizzati/i)
    expect(SYSTEM_PROMPT).toMatch(/previsioni di prezzo/i)
    expect(SYSTEM_PROMPT).toMatch(/web/i)
  })
})
