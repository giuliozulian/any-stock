import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { DELETE, POST } from '@/app/api/scanner/alerts/[symbol]/route'
import { PUT } from '@/app/api/scanner/alerts/settings/route'

const ctx = (symbol: string) => ({ params: Promise.resolve({ symbol }) })
const req = (method: string, body?: string) => new Request('http://localhost/api/scanner/alerts/x', { method, body })

async function makeRun(rows: Array<{ symbol: string; passedCount: number; status?: string; buy?: boolean }>) {
  const run = await prisma.scanRun.create({ data: { status: 'done', total: rows.length, cursor: rows.length, finishedAt: new Date() } })
  await prisma.scanResult.createMany({
    data: rows.map((r) => ({ runId: run.id, symbol: r.symbol, name: r.symbol, status: r.status ?? 'ok', passedCount: r.passedCount, ...(r.buy ? { price: 102, vcpStatus: 'breakout', pivot: 100, pivotDistancePct: 2, volumeRatio: 1.8 } : {}) })),
  })
  return run
}

describe('scanner alerts API: arm and disarm', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('POST arms a stock found in the last complete scan', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    const res = await POST(req('POST'), ctx('AAA'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ symbol: 'AAA', armed: true })
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).toBeNull()
  })

  it('POST normalises the symbol to upper case', async () => {
    await makeRun([{ symbol: 'BRK.B', passedCount: 7 }])
    expect((await POST(req('POST'), ctx(' brk.b '))).status).toBe(200)
    expect(await prisma.scanAlert.count({ where: { symbol: 'BRK.B' } })).toBe(1)
  })

  it('POST answers 404 for a symbol the last scan does not know, creating nothing', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    expect((await POST(req('POST'), ctx('ZZZ'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST arms a followed stock the last scan did not include yet', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    await prisma.stock.create({ data: { symbol: 'RCEL', name: 'Avita', exchange: 'NASDAQ' } })
    expect((await POST(req('POST'), ctx('RCEL'))).status).toBe(200)
    expect(await prisma.scanAlert.count({ where: { symbol: 'RCEL' } })).toBe(1)
  })

  it('POST answers 404 for a stock the scan could not read', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7, status: 'unread' }])
    expect((await POST(req('POST'), ctx('AAA'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST answers 404 when no scan has been completed yet', async () => {
    expect((await POST(req('POST'), ctx('AAA'))).status).toBe(404)
    expect(await prisma.scanAlert.count()).toBe(0)
  })

  it('POST answers 400 for a malformed symbol', async () => {
    expect((await POST(req('POST'), ctx('bad symbol!'))).status).toBe(400)
    expect((await POST(req('POST'), ctx('A'.repeat(11)))).status).toBe(400)
  })

  it('POST arms again a stock that already sent its email', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA', notifiedAt: new Date() } })
    await POST(req('POST'), ctx('AAA'))
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).toBeNull()
  })

  it('DELETE disarms, and is fine when nothing was armed', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const res = await DELETE(req('DELETE'), ctx('AAA'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ symbol: 'AAA', armed: false })
    expect(await prisma.scanAlert.count()).toBe(0)
    expect((await DELETE(req('DELETE'), ctx('AAA'))).status).toBe(200)
  })

  it('DELETE answers 400 for a malformed symbol', async () => {
    expect((await DELETE(req('DELETE'), ctx('no way'))).status).toBe(400)
  })
})

describe('scanner alerts API: settings', () => {
  beforeEach(async () => {
    await resetDb()
  })

  const put = (body: string) => PUT(new Request('http://localhost/api/scanner/alerts/settings', { method: 'PUT', body }))
  const settings = () => prisma.scannerAlertSettings.findUniqueOrThrow({ where: { userId: 'dev' } })

  it('turning the switch on remembers the stocks that are already ready to buy', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8, buy: true }, { symbol: 'BBB', passedCount: 7 }, { symbol: 'CCC', passedCount: 8, buy: true }, { symbol: 'DDD', passedCount: 8 }])
    const res = await put('{"newEntrants":true}')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ newEntrants: true })
    const s = await settings()
    expect(s.newEntrants).toBe(true)
    expect([...s.knownFull].sort()).toEqual(['AAA', 'CCC'])
  })

  it('turning it on with no scan yet leaves knownFull empty', async () => {
    await put('{"newEntrants":true}')
    expect((await settings()).knownFull).toEqual([])
  })

  it('turning it on twice does not forget the pending new entrants', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    await put('{"newEntrants":true}')
    await prisma.scannerAlertSettings.update({ where: { userId: 'dev' }, data: { knownFull: ['X'] } })
    await put('{"newEntrants":true}')
    expect((await settings()).knownFull).toEqual(['X'])
  })

  it('turning it off keeps what it knew', async () => {
    await makeRun([{ symbol: 'AAA', passedCount: 8, buy: true }])
    await put('{"newEntrants":true}')
    await put('{"newEntrants":false}')
    const s = await settings()
    expect(s.newEntrants).toBe(false)
    expect(s.knownFull).toEqual(['AAA'])
  })

  it('answers 400 for an invalid body and changes nothing', async () => {
    expect((await put('{}')).status).toBe(400)
    expect((await put('{"newEntrants":"yes"}')).status).toBe(400)
    expect((await put('not json')).status).toBe(400)
    expect(await prisma.scannerAlertSettings.count()).toBe(0)
  })
})
