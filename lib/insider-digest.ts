import { prisma } from './db'
import { getInsiderTransactions } from './finnhub'
import { daysAgoISO, summarizeTrades, toTrades, topByActivity, type DigestEntry } from './insiders'
import { sendEmail } from './notify'

const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`)

export function buildDigest(entries: DigestEntry[]): { subject: string; text: string } {
  const blocks = entries.map((e) => {
    const s = summarizeTrades(e.trades)
    const lines = e.trades
      .slice(0, 5)
      .map((t) => `  - ${t.side === 'buy' ? 'ACQUISTO' : 'VENDITA'} ${t.name}: ${t.shares.toLocaleString('en-US')} azioni a $${t.price.toFixed(2)} (${money(t.value)}), operazione del ${t.date}`)
    return `${e.symbol} (${e.name}): ${s.buys} acquisti, ${s.sells} vendite\n${lines.join('\n')}`
  })
  return {
    subject: `Insider: ${entries.map((e) => e.symbol).join(', ')} con più operazioni oggi`,
    text: `Operazioni degli insider depositate oggi sui titoli che segui (solo acquisti e vendite sul mercato):\n\n${blocks.join('\n\n')}\n\nLe vendite sono spesso programmate o servono a pagare le tasse; gli acquisti sul mercato sono il segnale più significativo.`,
  }
}

// End-of-day digest: top 3 watchlist stocks by insider P/S trades filed today. Stateless, sends nothing when there are none.
export async function sendInsiderDigest(now = new Date()): Promise<{ checked: number; reported: number; sent: boolean }> {
  const stocks = await prisma.stock.findMany()
  const today = daysAgoISO(0, now)
  const sinceTransaction = daysAgoISO(30, now)
  const entries: DigestEntry[] = []
  for (const stock of stocks) {
    try {
      const trades = toTrades(await getInsiderTransactions(stock.symbol), sinceTransaction).filter((t) => t.filingDate === today)
      entries.push({ symbol: stock.symbol, name: stock.name, trades })
    } catch (err) {
      console.error(`Insider digest failed for ${stock.symbol}:`, err instanceof Error ? err.message : String(err))
    }
  }
  const top = topByActivity(entries)
  if (top.length === 0) return { checked: stocks.length, reported: 0, sent: false }
  const { subject, text } = buildDigest(top)
  return { checked: stocks.length, reported: top.length, sent: await sendEmail(subject, text) }
}
