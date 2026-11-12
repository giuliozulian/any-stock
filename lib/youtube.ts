export interface RecentVideo {
  id: string
  title: string
  channel: string
  publishedAt: string
  thumbnail: string
}

const TTL_MS = 6 * 60 * 60 * 1000
const WINDOW_DAYS = 7
const cache = new Map<string, { at: number; videos: RecentVideo[] }>()

export function isYoutubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY)
}

export function parseYoutubeSearch(json: unknown): RecentVideo[] {
  const items = (json as { items?: unknown[] } | null)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((raw) => {
    const item = raw as {
      id?: { videoId?: string }
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> }
    }
    const id = item.id?.videoId
    const s = item.snippet
    if (!id || !s?.title || !s.publishedAt) return []
    const thumbnail = s.thumbnails?.medium?.url ?? s.thumbnails?.high?.url ?? s.thumbnails?.default?.url
    if (!thumbnail) return []
    return [{ id, title: decodeEntities(s.title), channel: s.channelTitle ?? '', publishedAt: s.publishedAt, thumbnail }]
  })
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// Una ricerca costa 100 unità sulle 10.000 giornaliere gratuite: cache di 6 ore per titolo.
export async function getRecentVideos(symbol: string, name: string): Promise<RecentVideo[]> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return []
  const cacheKey = symbol.toUpperCase()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.videos

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '6',
    order: 'relevance',
    q: `${name} ${symbol} stock`,
    publishedAfter: new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    key,
  })
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return hit?.videos ?? []
    const videos = parseYoutubeSearch(await res.json())
    cache.set(cacheKey, { at: Date.now(), videos })
    return videos
  } catch {
    return hit?.videos ?? []
  }
}
