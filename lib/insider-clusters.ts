import { getForm4ClusterSeeds } from './edgar-form4-feed'
import { getInsiderData } from './insider-data'
import { buildCluster, type InsiderCluster } from './insiders'
import { getQuoteInfo } from './quote-info'
import { sharedCache } from './shared-cache'

export interface MarketCluster {
  symbol: string
  name: string
  marketCap: number
  cluster: InsiderCluster
}

export type CapBucket = 'large' | 'mid' | 'small'

const LARGE_FROM = 10_000_000_000
const MID_FROM = 2_000_000_000
// Below this the Form 4 volume is mostly noise from micro-caps, and each symbol costs a round of lookups.
const MIN_CAP = 300_000_000
const MAX_SYMBOLS = 60
const TTL_MS = 60 * 60 * 1000
const cache = sharedCache<{ at: number; data: MarketCluster[] }>('market-clusters')

export function capBucket(marketCap: number): CapBucket {
  return marketCap >= LARGE_FROM ? 'large' : marketCap >= MID_FROM ? 'mid' : 'small'
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
    }),
  )
}

// Every recent insider-buying cluster in the US market: symbols with at least two insiders buying over the last 7 days on EDGAR, then each one's trades (with roles) turned into a cluster. Cached for an hour for everyone.
export async function getMarketClusters(): Promise<MarketCluster[]> {
  const hit = await cache.get('all', TTL_MS)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  const seeds = (await getForm4ClusterSeeds()).slice(0, MAX_SYMBOLS * 2)
  if (seeds.length === 0) return []
  const infos = await getQuoteInfo(seeds.map((s) => s.symbol))
  const candidates = seeds.filter((s) => (infos.get(s.symbol)?.marketCap ?? 0) >= MIN_CAP).slice(0, MAX_SYMBOLS)

  const out: MarketCluster[] = []
  await runWithConcurrency(candidates, 5, async (seed) => {
    const data = await getInsiderData(seed.symbol).catch(() => null)
    const cluster = data ? buildCluster(data.trades) : null
    const info = infos.get(seed.symbol)
    if (cluster && info?.marketCap) out.push({ symbol: seed.symbol, name: info.name || seed.name, marketCap: info.marketCap, cluster })
  })
  out.sort((a, b) => b.cluster.score - a.cluster.score)
  await cache.set('all', { at: Date.now(), data: out })
  return out
}
