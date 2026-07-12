// In-memory rate limiter, keyed by caller-supplied string (e.g. `login:<ip>`).
// On Vercel serverless this Map only lives for the lifetime of a single
// function instance — protection is per-instance, not global — but that's
// still enough to blunt casual brute-forcing for the pilot.

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

interface Entry {
  count:   number
  resetAt: number
}

const hits = new Map<string, Entry>()

/** Returns true if the call is allowed, false if `key` has exceeded `max`
 *  attempts within the current 15-minute window. */
export function checkRateLimit(key: string, max: number): boolean {
  const now   = Date.now()
  const entry = hits.get(key)

  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }

  if (entry.count >= max) return false

  entry.count++
  return true
}
