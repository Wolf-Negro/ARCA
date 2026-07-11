import crypto from 'crypto'

/**
 * Signed session tokens for arca-panel.
 *
 * A token has the shape `payload.signature` where:
 *  - `payload`   is base64url of JSON `{ exp: <timestamp ms> }`
 *  - `signature` is `HMAC-SHA256(payload, PANEL_SESSION_SECRET)` encoded as base64url
 *
 * This replaces the previous scheme where the "hash" stored in the cookie was
 * just `base64(password)` — a reversible encoding, not a cryptographic
 * signature, that anyone capturing the cookie could decode (or forge, if they
 * knew/guessed the password) without any server secret.
 */

export const SESSION_COOKIE_NAME = 'arca-panel-token'
export const SESSION_MAX_AGE_SECONDS = 86_400
const SESSION_TTL_MS = SESSION_MAX_AGE_SECONDS * 1000

function getSessionSecret(): string {
  const secret = process.env.PANEL_SESSION_SECRET
  if (!secret) {
    throw new Error('PANEL_SESSION_SECRET no está configurada')
  }
  return secret
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
}

/** Constant-time comparison of two strings. Buffers of different length are
 * rejected before reaching `timingSafeEqual`, since that function throws
 * (rather than returning false) when its inputs differ in length. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8')
  const bufB = Buffer.from(b, 'utf-8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function createSessionToken(ttlMs: number = SESSION_TTL_MS): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url')
  const signature = sign(payload)
  return `${payload}.${signature}`
}

export function verifySessionToken(token: string | null | undefined): boolean {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  if (!payload || !signature) return false

  let expectedSignature: string
  try {
    expectedSignature = sign(payload)
  } catch {
    return false
  }

  if (!safeCompare(signature, expectedSignature)) return false

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
    if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) return false
  } catch {
    return false
  }

  return true
}
