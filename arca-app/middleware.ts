import { NextRequest, NextResponse } from 'next/server'

// Defense against "drive-by localhost" attacks / DNS rebinding: a malicious web
// page loaded in the user's browser could otherwise fetch() this local server
// and mutate documents. Only allow mutating requests whose Origin (when the
// browser sends one) is same-origin with the request itself. Requests without
// an Origin header (same-origin fetches from Electron/file contexts) are left
// untouched.
//
// Deliberately compared against the request's own Host header rather than a
// hardcoded port: arca-desktop probes for a free port at startup (3000, 3001,
// 3002, ...) whenever another local project already owns the default one, so
// a fixed allowlist would end up blocking arca-app's own legitimate requests
// whenever it lands on a non-default port.
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT'])

export function middleware(req: NextRequest) {
  if (MUTATING_METHODS.has(req.method)) {
    const origin = req.headers.get('origin')
    if (origin) {
      const host = req.headers.get('host')
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { originHost = null }
      if (!host || originHost !== host) {
        return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
      }
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
