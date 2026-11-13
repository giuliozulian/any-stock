export interface RecentVideo {
  id: string
  title: string
  channel: string
  publishedAt: string
  thumbnail: string
}

const TTL_MS = 60 * 60 * 1000
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

const MAX_VIDEOS = 6

async function searchVideos(query: string, key: string, language?: string): Promise<RecentVideo[] | null> {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(MAX_VIDEOS),
    order: 'relevance',
    q: query,
    publishedAfter: new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    key,
  })
  if (language) params.set('relevanceLanguage', language)
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  return parseYoutubeSearch(await res.json())
}

// Due ricerche (italiano, poi generica) costano 200 unità sulle 10.000 giornaliere gratuite: cache di 1 ora per titolo.
// I video in italiano vengono messi per primi; la ricerca generica completa fino a 6 risultati.
export async function getRecentVideos(symbol: string, name: string): Promise<RecentVideo[]> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return []
  const cacheKey = symbol.toUpperCase()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.videos

  try {
    const [italian, general] = await Promise.all([
      searchVideos(`${name} ${symbol} azioni`, key, 'it').catch(() => null),
      searchVideos(`${name} ${symbol} stock`, key).catch(() => null),
    ])
    if (!italian && !general) return hit?.videos ?? []
    const seen = new Set<string>()
    const videos = [...(italian ?? []), ...(general ?? [])]
      .filter((v) => !seen.has(v.id) && seen.add(v.id))
      .slice(0, MAX_VIDEOS)
    cache.set(cacheKey, { at: Date.now(), videos })
    return videos
  } catch {
    return hit?.videos ?? []
  }
}
