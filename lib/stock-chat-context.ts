import type { Evaluation } from '@/lib/evaluate'
import type { InsiderSummary } from '@/lib/insiders'

export const CONTEXT_MAX_CHARS = 6000
const MAX_NEWS = 5

export interface StockChatInput {
  symbol: string
  name: string
  exchange: string
  snapshot: {
    price: number
    changePct: number
    // In millions of dollars, like PriceSnapshot.marketCap.
    marketCap: number | null
    peRatio: number | null
    week52High: number | null
    week52Low: number | null
    dividendYield: number | null
    payoutRatio: number | null
    epsGrowth5Y: number | null
    timestamp: Date
  } | null
  evaluation: Evaluation | null
  minervini: { stage2: boolean; criteria: { label: string; ok: boolean }[] } | null
  earnings: { date: Date | null; hour: string | null; epsEstimate: number | null }
  news: { headline: string; source: string; publishedAt: Date }[]
  insiders: InsiderSummary | null
  congress: { buys: number; sells: number } | null
}

export const SYSTEM_PROMPT = `Sei l'assistente di un'app di analisi azionaria e rispondi a domande su UN solo titolo, indicato nel contesto qui sotto.
- Rispondi sempre in italiano, in modo breve e chiaro.
- Per i dati del titolo (prezzo, fondamentali, valutazione dell'app) usa il contesto fornito. Per notizie ed eventi recenti puoi cercare sul web e citare le fonti.
- Se il contesto e il web discordano, dillo esplicitamente.
- Non dare consigli personalizzati ("compra", "vendi") e non fare previsioni di prezzo: offri analisi, pro e contro, e ricorda che non è consulenza finanziaria.
- Se la domanda non riguarda questo titolo o la finanza, rifiuta con gentilezza.
- Non inventare dati: se non li trovi, dì che non li hai.`

const day = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: number) => v.toFixed(2)

function formatMarketCap(millions: number): string {
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`
  return `$${millions.toFixed(0)}M`
}

type Key = 'identity' | 'price' | 'evaluation' | 'minervini' | 'dividends' | 'earnings' | 'news' | 'insiders' | 'congress'
interface Block {
  key: Key
  text: string
}

// Dropped in this order when the context is over the cap.
const DROP_ORDER: Key[] = ['news', 'congress', 'insiders']

function priceBlock(s: NonNullable<StockChatInput['snapshot']>): string {
  const lines = [`PREZZO (dati al ${day(s.timestamp)})`, `- Ultimo prezzo: $${num(s.price)} (${s.changePct >= 0 ? '+' : ''}${num(s.changePct)}% sul giorno)`]
  if (s.week52Low !== null && s.week52High !== null) lines.push(`- Intervallo a 52 settimane: $${num(s.week52Low)} - $${num(s.week52High)}`)
  if (s.marketCap !== null) lines.push(`- Capitalizzazione: ${formatMarketCap(s.marketCap)}`)
  if (s.peRatio !== null) lines.push(`- P/E: ${num(s.peRatio)}`)
  return lines.join('\n')
}

function evaluationBlock(e: Evaluation): string {
  const m = e.mediumTerm
  const lines = [
    'VALUTAZIONE DELL’APP',
    `- Breve termine: ${e.shortTerm.label}. ${e.shortTerm.note}`,
    `- Medio termine: ${m.label}. ${m.note} (analisti: ${m.strongBuy} strong buy, ${m.buy} buy, ${m.hold} hold, ${m.sell} sell, ${m.strongSell} strong sell)`,
    `- Lungo termine: ${e.longTerm.label}. ${e.longTerm.note}`,
    `- Valore equo: ${e.fairValue.note}`,
    `- Impatto delle notizie: ${e.newsImpact.note}`,
  ]
  if (e.sinceWatching.pct !== null) lines.push(`- Da quando è seguito: ${e.sinceWatching.pct >= 0 ? '+' : ''}${num(e.sinceWatching.pct)}%`)
  return lines.join('\n')
}

function minerviniBlock(m: NonNullable<StockChatInput['minervini']>): string {
  const passed = m.criteria.filter((c) => c.ok).map((c) => c.label)
  const failed = m.criteria.filter((c) => !c.ok).map((c) => c.label)
  const lines = ['TREND TEMPLATE DI MINERVINI', `- Stage 2: ${m.stage2 ? 'sì' : 'no'}`]
  if (passed.length > 0) lines.push(`- Criteri passati: ${passed.join('; ')}`)
  if (failed.length > 0) lines.push(`- Criteri non passati: ${failed.join('; ')}`)
  return lines.join('\n')
}

function dividendsBlock(s: NonNullable<StockChatInput['snapshot']>): string | null {
  const lines: string[] = []
  if (s.dividendYield !== null) lines.push(`- Rendimento da dividendo: ${num(s.dividendYield)}%`)
  if (s.payoutRatio !== null) lines.push(`- Payout ratio: ${num(s.payoutRatio)}%`)
  if (s.epsGrowth5Y !== null) lines.push(`- Crescita EPS a 5 anni: ${num(s.epsGrowth5Y)}%`)
  return lines.length > 0 ? ['DIVIDENDI E CRESCITA', ...lines].join('\n') : null
}

function earningsBlock(e: StockChatInput['earnings']): string | null {
  if (!e.date) return null
  const lines = ['PROSSIMA TRIMESTRALE', `- Data: ${day(e.date)}${e.hour ? ` (${e.hour})` : ''}`]
  if (e.epsEstimate !== null) lines.push(`- EPS stimato: ${num(e.epsEstimate)}`)
  return lines.join('\n')
}

function newsBlock(news: StockChatInput['news']): string | null {
  if (news.length === 0) return null
  return ['NOTIZIE RECENTI', ...news.slice(0, MAX_NEWS).map((n) => `- ${day(n.publishedAt)} ${n.source}: ${n.headline}`)].join('\n')
}

function insidersBlock(i: InsiderSummary): string {
  return ['INSIDER (ultimi 180 giorni)', `- ${i.buys} acquisti per $${Math.round(i.buyValue)}, ${i.sells} vendite per $${Math.round(i.sellValue)}; saldo ${i.mood === 'buying' ? 'in acquisto' : i.mood === 'selling' ? 'in vendita' : 'neutro'}`].join('\n')
}

export function buildStockContext(input: StockChatInput): string {
  const optional: (Block | null)[] = [
    input.snapshot ? { key: 'price', text: priceBlock(input.snapshot) } : null,
    input.evaluation ? { key: 'evaluation', text: evaluationBlock(input.evaluation) } : null,
    input.minervini ? { key: 'minervini', text: minerviniBlock(input.minervini) } : null,
    input.snapshot ? toBlock('dividends', dividendsBlock(input.snapshot)) : null,
    toBlock('earnings', earningsBlock(input.earnings)),
    toBlock('news', newsBlock(input.news)),
    input.insiders && input.insiders.buys + input.insiders.sells > 0 ? { key: 'insiders', text: insidersBlock(input.insiders) } : null,
    input.congress && input.congress.buys + input.congress.sells > 0
      ? { key: 'congress', text: `CONGRESSO (ultimi 180 giorni)\n- ${input.congress.buys} acquisti e ${input.congress.sells} vendite di membri del Congresso USA` }
      : null,
  ]
  const blocks: Block[] = [{ key: 'identity', text: `TITOLO\n${input.name} (${input.exchange}: ${input.symbol})` }, ...optional.filter((b): b is Block => b !== null)]

  const render = () => blocks.map((b) => b.text).join('\n\n')
  for (const key of DROP_ORDER) {
    if (render().length <= CONTEXT_MAX_CHARS) break
    const at = blocks.findIndex((b) => b.key === key)
    if (at !== -1) blocks.splice(at, 1)
  }
  return render().slice(0, CONTEXT_MAX_CHARS)
}

function toBlock(key: Key, text: string | null): Block | null {
  return text === null ? null : { key, text }
}
