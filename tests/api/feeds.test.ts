import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// connection() only works inside a Next request; the routes call it before reading the database.
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), connection: vi.fn(async () => {}) }))

import { prisma } from '@/lib/db'
import { resetDb, watch } from '../helpers/db'
import { GET as widget } from '@/app/api/widget/route'
import { GET as calendar } from '@/app/api/calendar/route'

const get = (path: string) => new Request(`http://localhost${path}`)

describe('widget feed', () => {
  beforeEach(async () => {
    await resetDb()
    vi.stubEnv('WIDGET_TOKEN', 'widget-secret')
    await watch({ data: { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ' } })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers with the watchlist when the token matches', async () => {
    const res = await widget(get('/api/widget?token=widget-secret'))
    expect(res.status).toBe(200)
    expect((await res.json()).stocks).toHaveLength(1)
  })

  it('answers 401 for a missing or wrong token', async () => {
    expect((await widget(get('/api/widget'))).status).toBe(401)
    expect((await widget(get('/api/widget?token=nope'))).status).toBe(401)
    expect((await widget(get('/api/widget?token='))).status).toBe(401)
  })

  it('answers 401, not open access, when WIDGET_TOKEN is not set or empty', async () => {
    vi.stubEnv('WIDGET_TOKEN', '')
    expect((await widget(get('/api/widget'))).status).toBe(401)
    expect((await widget(get('/api/widget?token='))).status).toBe(401)
    expect((await widget(get('/api/widget?token=undefined'))).status).toBe(401)
  })
})

describe('calendar feed', () => {
  beforeEach(async () => {
    await resetDb()
    vi.stubEnv('CALENDAR_TOKEN', 'calendar-secret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('answers with the calendar when the token matches', async () => {
    const res = await calendar(get('/api/calendar?token=calendar-secret'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('BEGIN:VCALENDAR')
  })

  it('answers 401 for a missing or wrong token', async () => {
    expect((await calendar(get('/api/calendar'))).status).toBe(401)
    expect((await calendar(get('/api/calendar?token=nope'))).status).toBe(401)
  })

  it('answers 401, not open access, when CALENDAR_TOKEN is not set or empty', async () => {
    vi.stubEnv('CALENDAR_TOKEN', '')
    expect((await calendar(get('/api/calendar'))).status).toBe(401)
    expect((await calendar(get('/api/calendar?token='))).status).toBe(401)
  })

  it('does not accept the widget token', async () => {
    vi.stubEnv('WIDGET_TOKEN', 'widget-secret')
    expect((await calendar(get('/api/calendar?token=widget-secret'))).status).toBe(401)
  })
})
