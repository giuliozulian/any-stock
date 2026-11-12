import nodemailer from 'nodemailer'
import type { AlertKind } from './alerts'

interface AlertEmail {
  symbol: string
  name: string
  kind: AlertKind
  price: number
  target: number
}

function buildMessage({ symbol, name, kind, price, target }: AlertEmail): { subject: string; text: string } {
  const isEntry = kind === 'entry'
  return {
    subject: isEntry ? `${symbol}: prezzo di ingresso raggiunto ($${price.toFixed(2)})` : `${symbol}: prezzo di vendita raggiunto ($${price.toFixed(2)})`,
    text: isEntry
      ? `${name} (${symbol}) è sceso a $${price.toFixed(2)}, sotto o uguale al tuo prezzo di ingresso di $${target.toFixed(2)}.`
      : `${name} (${symbol}) è salito a $${price.toFixed(2)}, sopra o uguale al tuo prezzo di vendita di $${target.toFixed(2)}.`,
  }
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<void> {
  const port = Number(process.env.SMTP_PORT ?? 587)
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  await transport.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER, to, subject, text })
}

async function sendViaResend(apiKey: string, to: string, subject: string, text: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? 'Any Stock <onboarding@resend.dev>', to: [to], subject, text }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

// Uses SMTP when SMTP_HOST is set, otherwise Resend. Returns false (never throws) when not configured or on failure.
export async function sendAlertEmail(alert: AlertEmail): Promise<boolean> {
  const to = process.env.ALERT_EMAIL_TO
  const resendKey = process.env.RESEND_API_KEY
  if (!to || (!process.env.SMTP_HOST && !resendKey)) {
    console.error('Alert email skipped: set ALERT_EMAIL_TO and either SMTP_HOST or RESEND_API_KEY')
    return false
  }

  const { subject, text } = buildMessage(alert)
  try {
    if (process.env.SMTP_HOST) await sendViaSmtp(to, subject, text)
    else await sendViaResend(resendKey!, to, subject, text)
    return true
  } catch (err) {
    console.error(`Alert email failed for ${alert.symbol}:`, err instanceof Error ? err.message : String(err))
    return false
  }
}
