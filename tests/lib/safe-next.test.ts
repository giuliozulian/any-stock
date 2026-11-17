import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/safe-next'

describe('safeNext', () => {
  it('keeps internal paths, with query and hash', () => {
    expect(safeNext('/')).toBe('/')
    expect(safeNext('/scanner')).toBe('/scanner')
    expect(safeNext('/stock/AAPL?tab=minervini#top')).toBe('/stock/AAPL?tab=minervini#top')
  })

  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'http://evil.com/x', '/\\evil.com', '\\\\evil.com', 'javascript:alert(1)']) {
      expect(safeNext(bad)).toBe('/')
    }
  })

  it('refuses a path without a leading slash, empty values and control characters', () => {
    for (const bad of ['scanner', '', null, undefined, '/a\nb', '/a\r\nLocation: x', '/a\u0000b']) {
      expect(safeNext(bad as string | null | undefined)).toBe('/')
    }
  })

  it('never sends the user back to the login page, which would loop', () => {
    for (const bad of ['/login', '/login?next=/x', '/login/', '/LOGIN']) {
      expect(safeNext(bad)).toBe('/')
    }
  })

  it('refuses absurdly long values', () => {
    expect(safeNext('/' + 'a'.repeat(3000))).toBe('/')
  })
})
