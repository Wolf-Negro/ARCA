import { NextRequest, NextResponse } from 'next/server'

// Defense against "drive-by localhost" attacks / DNS rebinding: a malicious web
// page loaded in the user's browser could otherwise fetch() this local server
// and read or mutate documents. Two independent checks:
//
// 1. Host allowlist (every method, GET included): the server only ever runs on
//    loopback, so a Host header pointing anywhere else can only come from DNS
//    rebinding (evil.com resolving to 127.0.0.1) — reject it outright. This is
//    what actually kills rebinding: comparing Origin against the request's own
//    Host would pass, because under rebinding both carry evil.com.
// 2. Origin allowlist for mutating requests: browsers always attach Origin to
//    cross-site POSTs, so anything not from a local origin is a foreign page.
//    Requests without an Origin header (same-origin fetches from Electron)
//    pass through.
//
// Hostnames are allowlisted but ports deliberately are not: arca-desktop
// probes for a free port at startup (3000, 3001, ...) whenever another local
// project owns the default one, so pinning the port would block arca-app's
// own requests on fallback ports. Port-only variance is safe here — any
// attacker who can bind a local port can read the DB file directly anyway.
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT'])
const LOCAL_HOSTNAMES  = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLocalHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false
  try {
    // URL does the host:port parsing (including bracketed IPv6) for us.
    return LOCAL_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname)
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  if (!isLocalHost(req.headers.get('host'))) {
    return NextResponse.json({ error: 'Host no permitido' }, { status: 403 })
  }

  if (MUTATING_METHODS.has(req.method)) {
    const origin = req.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try { originHost = new URL(origin).hostname } catch { originHost = null }
      if (!originHost || !LOCAL_HOSTNAMES.has(originHost)) {
        return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
      }
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
