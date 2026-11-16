import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { POST as start } from '@/app/api/scanner/route'
import { POST as step } from '@/app/api/scanner/step/route'

vi.mock('@/lib/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/history')>()
  const DAY = 86_400_000
  const bars = Array.from({ length: 300 }, (_, i) => {
    const close = 100 + i * 0.5
    return { t: i * DAY, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 }
  })
  return { ...actual, getDailyBars: vi.fn(async () => bars) }
})

const post = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('scanner API', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('POST /api/scanner starts a run sized on the universe', async () => {
    const res = await start()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ cursor: 0, status: 'running', resumed: false })
    expect(body.total).toBeGreaterThan(450)
    expect(await prisma.scanRun.count()).toBe(1)
  })

  it('POST /api/scanner resumes a running scan', async () => {
    const first = await (await start()).json()
    const again = await (await start()).json()
    expect(again.runId).toBe(first.runId)
    expect(again.resumed).toBe(true)
  })

  it('POST /api/scanner answers 429 with the retry time within an hour of a complete scan', async () => {
    const finishedAt = new Date()
    await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt } })
    const res = await start()
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(new Date(body.retryAt).getTime()).toBe(finishedAt.getTime() + 60 * 60 * 1000)
    expect(await prisma.scanRun.count({ where: { status: 'running' } })).toBe(0)
  })

  it('POST /api/scanner/step processes the next block and reports the cursor', async () => {
    const { runId } = await (await start()).json()
    const res = await step(post('/api/scanner/step', { runId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cursor: 25, status: 'running', advanced: true })
    expect(await prisma.scanResult.count({ where: { runId } })).toBe(25)
  })

  it('POST /api/scanner/step rejects a missing runId and invalid JSON with 400', async () => {
    expect((await step(post('/api/scanner/step', {}))).status).toBe(400)
    expect((await step(new Request('http://localhost/api/scanner/step', { method: 'POST', body: '{not json' }))).status).toBe(400)
    expect(await prisma.scanResult.count()).toBe(0)
  })

  it('POST /api/scanner/step answers 404 for an unknown run', async () => {
    expect((await step(post('/api/scanner/step', { runId: 'nope' }))).status).toBe(404)
    expect(await prisma.scanResult.count()).toBe(0)
  })

  it('POST /api/scanner/step answers 409 for a finished run and writes nothing', async () => {
    const run = await prisma.scanRun.create({ data: { status: 'done', total: 5, cursor: 5, finishedAt: new Date() } })
    expect((await step(post('/api/scanner/step', { runId: run.id }))).status).toBe(409)
    expect(await prisma.scanResult.count()).toBe(0)
  })
})
