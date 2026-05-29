import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/activate', '/api/auth']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get('arca-panel-token')?.value
  if (!token) return NextResponse.redirect(new URL('/login', req.url))

  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'))
    const adminPassword = process.env.PANEL_ADMIN_PASSWORD ?? ''
    const expectedHash  = Buffer.from(adminPassword).toString('base64')

    if (decoded.exp < Date.now() || decoded.hash !== expectedHash) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
