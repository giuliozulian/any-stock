import type { AlertKind } from './alerts'

interface AlertEmail {
  symbol: string
  name: string
  kind: AlertKind
  price: number
  target: number
}

// Sends through the Resend REST API. Returns false (never throws) when not configured or on failure.
export async function sendAlertEmail({ symbol, name, kind, price, target }: AlertEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  if (!apiKey || !to) {
    console.error('Alert email skipped: RESEND_API_KEY or ALERT_EMAIL_TO missing')
    return false
  }

  const isEntry = kind === 'entry'
  const subject = isEntry ? `${symbol}: prezzo di ingresso raggiunto ($${price.toFixed(2)})` : `${symbol}: prezzo di vendita raggiunto ($${price.toFixed(2)})`
  const text = isEntry
    ? `${name} (${symbol}) è sceso a $${price.toFixed(2)}, sotto o uguale al tuo prezzo di ingresso di $${target.toFixed(2)}.`
    : `${name} (${symbol}) è salito a $${price.toFixed(2)}, sopra o uguale al tuo prezzo di vendita di $${target.toFixed(2)}.`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? 'Any Stock <onboarding@resend.dev>', to: [to], subject, text }),
    })
    if (!res.ok) {
      console.error(`Alert email failed for ${symbol}:`, res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error(`Alert email failed for ${symbol}:`, err instanceof Error ? err.message : String(err))
    return false
  }
}
