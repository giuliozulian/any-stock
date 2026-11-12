import { prisma } from './db'
import { analyzeNewsWithLlm, isLlmConfigured } from './llm-news'

const MAX_PER_REFRESH = 10

// Analizza solo le notizie senza analisi salvata, così ogni notizia costa una sola chiamata.
// Un errore su una notizia (rate limit, timeout) non blocca le altre né il refresh.
export async function analyzePendingNews(stockId: string): Promise<{ analyzed: number; failed: number }> {
  if (!isLlmConfigured()) return { analyzed: 0, failed: 0 }

  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
  })
  if (!stock) return { analyzed: 0, failed: 0 }

  const pending = await prisma.newsItem.findMany({
    where: { stockId, analysis: null },
    orderBy: { publishedAt: 'desc' },
    take: MAX_PER_REFRESH,
  })

  const snap = stock.snapshots[0]
  const market = snap
    ? { price: snap.price, changePct: snap.changePct, week52Low: snap.week52Low, week52High: snap.week52High, pe: snap.peRatio }
    : undefined

  let analyzed = 0
  let failed = 0
  const CONCURRENCY = 5
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const result = await analyzeNewsWithLlm({
          stock: { symbol: stock.symbol, name: stock.name },
          news: { headline: item.headline, summary: item.summary, source: item.source, publishedAt: item.publishedAt },
          market,
        })
        if (!result) throw new Error('empty')
        await prisma.newsAnalysis.create({ data: { newsItemId: item.id, ...result } })
      }),
    )
    let errored = false
    for (const r of results) {
      if (r.status === 'fulfilled') analyzed++
      else {
        failed++
        if (r.reason instanceof Error && r.reason.message !== 'empty') {
          errored = true
          console.error(`News analysis failed for ${stock.symbol}:`, r.reason.message)
        }
      }
    }
    if (errored) break // errore di rete/rate limit: inutile insistere sulle altre notizie
  }
  return { analyzed, failed }
}
