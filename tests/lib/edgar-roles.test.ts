import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseRole, getTickerByCik } from '@/lib/edgar-roles'

const rel = (inner: string) => `<reportingOwnerRelationship>${inner}</reportingOwnerRelationship>`

describe('parseRole', () => {
  it('prefers the officer title', () => {
    expect(parseRole(rel('<isDirector>1</isDirector><isOfficer>true</isOfficer><officerTitle>Chief Operations Officer</officerTitle>'))).toBe('Chief Operations Officer')
  })
  it('falls back to director, then 10% owner', () => {
    expect(parseRole(rel('<isDirector>1</isDirector><isOfficer>0</isOfficer>'))).toBe('Director')
    expect(parseRole(rel('<isTenPercentOwner>1</isTenPercentOwner>'))).toBe('10% Owner')
  })
  it('returns null without a relationship block', () => {
    expect(parseRole('<x/>')).toBeNull()
  })
})

describe('getTickerByCik', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
          1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves a ticker from a CIK using the same company_tickers.json cache as getCik', async () => {
    expect(await getTickerByCik(320193)).toBe('AAPL')
    expect(await getTickerByCik(789019)).toBe('MSFT')
  })

  it('returns null for an unmapped CIK', async () => {
    expect(await getTickerByCik(999999999)).toBeNull()
  })

  it('retries once after a 429 instead of failing the whole lookup', async () => {
    vi.resetModules()
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
      return new Response(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }), { status: 200 })
    }) as unknown as typeof fetch
    const fresh = await import('@/lib/edgar-roles')
    expect(await fresh.getTickerByCik(320193)).toBe('AAPL')
    expect(calls).toBe(2)
  })

  it('keeps the first ticker for a CIK with multiple share classes (company_tickers.json ranks the primary class first)', async () => {
    // Fresh module instance: the ticker cache is module-level state shared by the tests above, and its 24h TTL would otherwise serve their stale AAPL/MSFT fixture here.
    vi.resetModules()
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          0: { cik_str: 1067983, ticker: 'BRK.A', title: 'Berkshire Hathaway' },
          1: { cik_str: 1067983, ticker: 'BRK.B', title: 'Berkshire Hathaway' },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    const fresh = await import('@/lib/edgar-roles')
    expect(await fresh.getTickerByCik(1067983)).toBe('BRK.A')
  })
})
