import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, safeCompare, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/session'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(`login:${ip}`, 10)) {
    return NextResponse.json({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }, { status: 429 })
  }

  try {
    const { password } = await req.json()
    const adminPassword = process.env.PANEL_ADMIN_PASSWORD

    if (!adminPassword || !process.env.PANEL_SESSION_SECRET) {
      return NextResponse.json({ error: 'Servidor no configurado' }, { status: 500 })
    }

    if (!password || typeof password !== 'string' || !safeCompare(password, adminPassword)) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }

    const token = createSessionToken()

    const res = NextResponse.json({ success: true })
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   SESSION_MAX_AGE_SECONDS,
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
