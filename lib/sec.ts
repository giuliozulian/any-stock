// The SEC blocks automated requests that do not declare who is behind them (HTTP 403 "Undeclared Automated Tool").
// The contact address comes from the environment so it never lives in the code.
export const FALLBACK_SEC_UA = 'any-stock/1.0 (personal watchlist app)'

let warned = false

export function resetSecWarning(): void {
  warned = false
}

export function secUserAgent(): string {
  const contact = process.env.SEC_CONTACT_EMAIL?.trim()
  if (contact) return `any-stock/1.0 (contact: ${contact})`
  if (!warned) {
    warned = true
    console.warn('SEC_CONTACT_EMAIL is not set: sec.gov rejects requests without a declared contact (403), so insider data will be empty.')
  }
  return FALLBACK_SEC_UA
}
