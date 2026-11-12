import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRecentVideos, parseYoutubeSearch } from '@/lib/youtube'

describe('parseYoutubeSearch', () => {
  it('estrae i video e decodifica le entità HTML', () => {
    const videos = parseYoutubeSearch({
      items: [
        {
          id: { videoId: 'abc' },
          snippet: {
            title: 'NVDA &amp; AMD: &quot;update&quot;',
            channelTitle: 'CNBC',
            publishedAt: '2026-11-12T04:09:55Z',
            thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' } },
          },
        },
        { id: {}, snippet: { title: 'senza id' } },
      ],
    })
    expect(videos).toEqual([
      { id: 'abc', title: 'NVDA & AMD: "update"', channel: 'CNBC', publishedAt: '2026-11-12T04:09:55Z', thumbnail: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' },
    ])
  })

  it('restituisce una lista vuota con risposta non valida', () => {
    expect(parseYoutubeSearch(null)).toEqual([])
    expect(parseYoutubeSearch({ error: {} })).toEqual([])
  })
})

describe('getRecentVideos', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const item = (id: string) => ({
    id: { videoId: id },
    snippet: { title: id, channelTitle: 'c', publishedAt: '2026-11-12T04:09:55Z', thumbnails: { medium: { url: `https://t/${id}` } } },
  })

  it('mette per primi i video della ricerca in italiano, senza duplicati', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', 'k')
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ items: url.includes('relevanceLanguage=it') ? [item('it1'), item('both')] : [item('en1'), item('both')] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const videos = await getRecentVideos('ITV', 'Italia Test')
    expect(videos.map((v) => v.id)).toEqual(['it1', 'both', 'en1'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
