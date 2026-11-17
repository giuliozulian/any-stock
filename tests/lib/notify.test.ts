import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

import { emailConfigured, sendEmail } from '@/lib/notify'

describe('sendEmail', () => {
  beforeEach(() => {
    sendMail.mockClear()
    vi.stubEnv('ALERT_EMAIL_TO', 'me@example.com')
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('RESEND_API_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends the html next to the plain text over SMTP', async () => {
    expect(await sendEmail('Oggetto', 'testo', '<p>html</p>')).toBe(true)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@example.com', subject: 'Oggetto', text: 'testo', html: '<p>html</p>' }))
  })

  it('sends no html key when none is given, as before', async () => {
    await sendEmail('Oggetto', 'testo')
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('html')
  })

  it('sends the html through Resend too', async () => {
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'key')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendEmail('Oggetto', 'testo', '<p>html</p>')).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ subject: 'Oggetto', text: 'testo', html: '<p>html</p>', to: ['me@example.com'] })
  })

  it('leaves html out of the Resend body when none is given', async () => {
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('RESEND_API_KEY', 'key')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await sendEmail('Oggetto', 'testo')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('html')
  })

  it('returns false instead of throwing when the transport fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('boom'))
    expect(await sendEmail('Oggetto', 'testo', '<p>x</p>')).toBe(false)
  })

  it('returns false when no recipient or provider is configured', async () => {
    vi.stubEnv('ALERT_EMAIL_TO', '')
    expect(await sendEmail('Oggetto', 'testo')).toBe(false)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('emailConfigured', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('needs a recipient and a provider', () => {
    vi.stubEnv('ALERT_EMAIL_TO', 'me@example.com')
    vi.stubEnv('SMTP_HOST', 'smtp.example.com')
    vi.stubEnv('RESEND_API_KEY', '')
    expect(emailConfigured()).toBe(true)
    vi.stubEnv('SMTP_HOST', '')
    expect(emailConfigured()).toBe(false)
    vi.stubEnv('RESEND_API_KEY', 'key')
    expect(emailConfigured()).toBe(true)
    vi.stubEnv('ALERT_EMAIL_TO', '')
    expect(emailConfigured()).toBe(false)
  })
})
