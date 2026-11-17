const MAX_LENGTH = 2000

// Where to send the user after login: only paths inside this site. Anything else (another host, a scheme, a protocol-relative
// "//host", backslashes that browsers read as slashes, control characters) falls back to the home page. /login itself is refused too:
// it would send a signed-in user back to the login page forever.
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  if (/^\/login(?:[/?#]|$)/i.test(value)) return '/'
  return value
}
