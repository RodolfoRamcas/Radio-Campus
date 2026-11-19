// Sesiones firmadas con HMAC-SHA256 (Web Crypto: funciona igual en Workers y en Node).

const encoder = new TextEncoder()

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export const sign = async (secret, value) => `${value}.${toBase64Url(await hmac(secret, value))}`

/** Devuelve el valor si la firma es válida; si no, null. */
export async function unsign(secret, signed) {
  if (typeof signed !== 'string') return null
  const dot = signed.lastIndexOf('.')
  if (dot <= 0) return null
  const value = signed.slice(0, dot)
  const expected = await sign(secret, value)
  return equalBytes(encoder.encode(expected), encoder.encode(signed)) ? value : null
}

/** Compara contraseñas en tiempo constante (se comparan sus HMAC, que siempre miden lo mismo). */
export async function passwordMatches(secret, input, expected) {
  if (!expected || typeof input !== 'string') return false
  return equalBytes(await hmac(secret, input), await hmac(secret, expected))
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export async function createSession(secret, now) {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)))
  return sign(secret, `${now + SESSION_TTL_MS}~${nonce}`)
}

export async function verifySession(secret, token, now) {
  const value = await unsign(secret, token)
  if (!value) return false
  return Number(value.split('~')[0]) > now
}

export async function hashIp(secret, ip) {
  if (!ip) return null
  return toBase64Url(await hmac(secret, `ip:${ip}`)).slice(0, 22)
}

export function randomId(bytes = 12) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function parseCookies(header) {
  const out = {}
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function cookie(name, value, { maxAge, secure, sameSite = 'Lax' }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${maxAge}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
