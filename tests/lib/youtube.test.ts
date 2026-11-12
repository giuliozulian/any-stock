import { describe, expect, it } from 'vitest'
import { parseYoutubeSearch } from '@/lib/youtube'

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
