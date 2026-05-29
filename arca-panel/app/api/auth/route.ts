import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    const adminPassword = process.env.PANEL_ADMIN_PASSWORD

    if (!adminPassword) {
      return NextResponse.json({ error: 'Servidor no configurado' }, { status: 500 })
    }

    if (!password || password !== adminPassword) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }

    const token = Buffer.from(
      JSON.stringify({ exp: Date.now() + 86_400_000, hash: Buffer.from(adminPassword).toString('base64') }),
    ).toString('base64')

    const res = NextResponse.json({ success: true })
    res.cookies.set('arca-panel-token', token, {
      httpOnly: false,
      sameSite: 'lax',
      path:     '/',
      maxAge:   86_400,
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
