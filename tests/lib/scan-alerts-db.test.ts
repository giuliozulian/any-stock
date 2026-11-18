import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ sendEmail: vi.fn(), emailConfigured: vi.fn() }))

import { prisma } from '@/lib/db'
import type { Bar } from '@/lib/history'
import { sendEmail } from '@/lib/notify'
import { getAlertState, notifyScanAlerts } from '@/lib/scan-alerts-db'
import { startRun, stepRun } from '@/lib/scanner-run'
import { resetDb } from '../helpers/db'

const send = vi.mocked(sendEmail)
const DAY = 86_400_000
const CRITERIA = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, label: `c${i + 1}`, ok: true, value: '', margin: null }))

async function makeRun(rows: Array<{ symbol: string; passedCount: number; rs?: number; name?: string; vcpStatus?: string; pivotDistancePct?: number; volumeRatio?: number }>, startedAt = new Date('2026-11-16T22:00:00Z')) {
  const run = await prisma.scanRun.create({
    data: { status: 'done', total: rows.length, cursor: rows.length, startedAt, finishedAt: new Date(startedAt.getTime() + 120_000) },
  })
  await prisma.scanResult.createMany({
    data: rows.map((r) => ({
      runId: run.id, symbol: r.symbol, name: r.name ?? `${r.symbol} Inc`, sector: 'Tech', status: 'ok', price: 102, weightedReturn: 0.5,
      criteria: CRITERIA, rs: r.rs ?? 90, passedCount: r.passedCount, vcpStatus: r.vcpStatus ?? 'breakout', pivot: 100, pivotDistancePct: r.pivotDistancePct ?? 2, volumeRatio: r.volumeRatio ?? 1.8,
    })),
  })
  return run
}

describe('notifyScanAlerts', () => {
  beforeEach(async () => {
    await resetDb()
    send.mockReset()
    send.mockResolvedValue(true)
  })

  it('sends one email for an armed stock that reached 8 of 8, then marks it as notified', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 7 }])

    expect(await notifyScanAlerts(run.id)).toBe('sent')

    expect(send).toHaveBeenCalledTimes(1)
    const [subject, text, html] = send.mock.calls[0]
    expect(subject).toContain('AAA')
    expect(subject).not.toContain('BBB')
    expect(text).toContain('Lo seguivi')
    expect(html).toContain('<html')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).not.toBeNull()
  })

  it('stays silent for an armed stock that is still at 7 of 8', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'BBB' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 7 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'BBB' } } })).notifiedAt).toBeNull()
  })

  it('does not notify a stock twice', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA', notifiedAt: new Date() } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('marks nothing and retries on the next scan when the email fails', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: true, knownFull: [] } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    send.mockResolvedValueOnce(false)

    expect(await notifyScanAlerts(run.id)).toBe('failed')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).toBeNull()
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { userId: 'dev' } })).knownFull).toEqual([])

    expect(await notifyScanAlerts(run.id)).toBe('sent')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).not.toBeNull()
  })

  it('never throws, even when sending throws', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    send.mockRejectedValueOnce(new Error('boom'))

    expect(await notifyScanAlerts(run.id)).toBe('failed')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'dev', symbol: 'AAA' } } })).notifiedAt).toBeNull()
  })

  it('does nothing for an unknown run or one still running', async () => {
    expect(await notifyScanAlerts('nope')).toBe('nothing')
    const running = await prisma.scanRun.create({ data: { status: 'running', total: 1 } })
    expect(await notifyScanAlerts(running.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('with the switch on, lists only the 8-of-8 stocks it had not seen and remembers all of them', async () => {
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: true, knownFull: ['OLD'] } })
    const run = await makeRun([{ symbol: 'OLD', passedCount: 8 }, { symbol: 'NEW', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('sent')

    const [subject, text] = send.mock.calls[0]
    expect(subject).toContain('NEW')
    expect(subject).not.toContain('OLD')
    expect(text).toContain('Nuovo da comprare')
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { userId: 'dev' } })).knownFull.sort()).toEqual(['NEW', 'OLD'])
  })

  it('with the switch off, new 8-of-8 stocks do not trigger anything and knownFull is left alone', async () => {
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: false, knownFull: [] } })
    const run = await makeRun([{ symbol: 'NEW', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { userId: 'dev' } })).knownFull).toEqual([])
  })

  it('puts watched and new stocks in one single email', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: true, knownFull: [] } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8, rs: 99 }, { symbol: 'BBB', passedCount: 8, rs: 80 }])

    await notifyScanAlerts(run.id)

    expect(send).toHaveBeenCalledTimes(1)
    const text = send.mock.calls[0][1]
    expect(text).toContain('Lo seguivi')
    expect(text).toContain('Nuovo da comprare')
  })

  it('stays silent when the scan ran with the US market open: a partial-volume breakout is not a buy', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }], new Date('2026-11-16T15:00:00Z'))

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('stays silent for an 8-of-8 stock that is still below its pivot', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8, vcpStatus: 'ready', pivotDistancePct: -2, volumeRatio: 0.8 }])

    expect(await notifyScanAlerts(run.id)).toBe('nothing')
    expect(send).not.toHaveBeenCalled()
  })

  it('a stock that drops out of the buy list and comes back is news again', async () => {
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: true, knownFull: ['AAA'] } })
    const quiet = await makeRun([{ symbol: 'AAA', passedCount: 7 }])
    expect(await notifyScanAlerts(quiet.id)).toBe('nothing')
    expect((await prisma.scannerAlertSettings.findUniqueOrThrow({ where: { userId: 'dev' } })).knownFull).toEqual([])

    const back = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    expect(await notifyScanAlerts(back.id)).toBe('sent')
  })

  it('links to the stock page when APP_URL is set', async () => {
    vi.stubEnv('APP_URL', 'https://app.example.com')
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'AAA' } })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])

    await notifyScanAlerts(run.id)

    expect(send.mock.calls[0][1]).toContain('https://app.example.com/stock/AAA')
    vi.unstubAllEnvs()
  })
})

describe('alerts are per user', () => {
  beforeEach(async () => {
    await resetDb()
    send.mockReset()
    send.mockResolvedValue(true)
  })

  it('emails each user only about their own armed stocks, at their own address', async () => {
    await prisma.scanAlert.createMany({
      data: [
        { userId: 'u1', userEmail: 'one@example.com', symbol: 'AAA' },
        { userId: 'u2', userEmail: 'two@example.com', symbol: 'BBB' },
      ],
    })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }, { symbol: 'BBB', passedCount: 8 }])

    expect(await notifyScanAlerts(run.id)).toBe('sent')

    expect(send).toHaveBeenCalledTimes(2)
    const byRecipient = new Map(send.mock.calls.map((c) => [c[3], c[0]]))
    expect(byRecipient.get('one@example.com')).toContain('AAA')
    expect(byRecipient.get('one@example.com')).not.toContain('BBB')
    expect(byRecipient.get('two@example.com')).toContain('BBB')
    expect(byRecipient.get('two@example.com')).not.toContain('AAA')
  })

  it('keeps one user\'s switch and armed stocks out of another user\'s state', async () => {
    await prisma.scanAlert.create({ data: { userId: 'u1', symbol: 'AAA' } })
    await prisma.scannerAlertSettings.create({ data: { userId: 'u1', newEntrants: true, knownFull: [] } })
    expect(await getAlertState('u1')).toEqual({ armed: ['AAA'], newEntrants: true })
    expect(await getAlertState('u2')).toEqual({ armed: [], newEntrants: false })
  })

  it('marks as sent only the user whose email went out, and retries the other', async () => {
    await prisma.scanAlert.createMany({
      data: [
        { userId: 'u1', userEmail: 'one@example.com', symbol: 'AAA' },
        { userId: 'u2', userEmail: 'two@example.com', symbol: 'AAA' },
      ],
    })
    const run = await makeRun([{ symbol: 'AAA', passedCount: 8 }])
    send.mockImplementation(async (_s, _t, _h, to) => to === 'one@example.com')

    expect(await notifyScanAlerts(run.id)).toBe('failed')
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'u1', symbol: 'AAA' } } })).notifiedAt).not.toBeNull()
    expect((await prisma.scanAlert.findUniqueOrThrow({ where: { userId_symbol: { userId: 'u2', symbol: 'AAA' } } })).notifiedAt).toBeNull()
  })
})

describe('closing a scan sends the alerts', () => {
  beforeEach(async () => {
    await resetDb()
    send.mockReset()
    send.mockResolvedValue(true)
  })

  const uptrend = (slope: number): Bar[] =>
    Array.from({ length: 300 }, (_, i) => {
      const close = 100 + i * slope
      return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
    })
  const universe = Array.from({ length: 8 }, (_, i) => ({ symbol: `S${i}`, name: `Stock ${i}`, sector: 'Tech' }))
  const fetchBars = async (symbol: string) => uptrend(0.1 + Number(symbol.slice(1)) * 0.1)

  it('sends one email when a real scan closes with an armed stock at 8 of 8', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'S7' } })
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    await stepRun(started.run.id, { universe, fetchBars })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toContain('S7')
  })

  it('sends one email, not two, when two steps race on the last block', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'S7' } })
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    await Promise.all([stepRun(started.run.id, { universe, fetchBars }), stepRun(started.run.id, { universe, fetchBars })])

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('still closes the scan when the email cannot be sent', async () => {
    await prisma.scanAlert.create({ data: { userId: 'dev', symbol: 'S7' } })
    send.mockRejectedValue(new Error('smtp down'))
    const started = await startRun(universe)
    if (started.kind === 'too-soon') throw new Error('unexpected')

    const step = await stepRun(started.run.id, { universe, fetchBars })

    expect(step).toMatchObject({ kind: 'advanced', run: { status: 'done' } })
  })
})

describe('getAlertState', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('lists only the armed stocks that have not notified yet, and the switch', async () => {
    await prisma.scanAlert.createMany({ data: [{ userId: 'dev', symbol: 'AAA' }, { userId: 'dev', symbol: 'BBB', notifiedAt: new Date() }] })
    expect(await getAlertState('dev')).toEqual({ armed: ['AAA'], newEntrants: false })
    await prisma.scannerAlertSettings.create({ data: { userId: 'dev', newEntrants: true, knownFull: [] } })
    expect(await getAlertState('dev')).toEqual({ armed: ['AAA'], newEntrants: true })
  })
})
