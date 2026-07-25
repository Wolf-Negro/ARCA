import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { findAgencyByCode } from '@/lib/db'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(`activate:${ip}`, 20)) {
    return NextResponse.json({ error: 'Demasiados intentos. Probá de nuevo más tarde.' }, { status: 429 })
  }

  try {
    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code es requerido' }, { status: 400 })
    }

    const agency = await findAgencyByCode(code.trim().toUpperCase())
    if (!agency) {
      return NextResponse.json({ error: 'Código inválido o inactivo' }, { status: 404 })
    }

    if (!process.env.SUPABASE_JWT_SECRET) {
      console.error('[/api/activate] SUPABASE_JWT_SECRET no está configurado')
      return NextResponse.json({ error: 'Servidor no configurado' }, { status: 500 })
    }

    // A JWT scoped to this agency's team_id replaces handing out the shared
    // anon key to every agency — Postgres RLS then checks
    // auth.jwt() ->> 'team_id' instead of trusting app-level filtering.
    const token = jwt.sign(
      { role: 'authenticated', team_id: agency.team_id },
      process.env.SUPABASE_JWT_SECRET,
      { expiresIn: '180d' },
    )

    return NextResponse.json({
      teamId:      agency.team_id,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: token,                          // JWT por agencia — reemplaza a la anon key
      anonKey:     process.env.SUPABASE_ANON_KEY,   // solo para el header apikey
    })
  } catch (err) {
    // Never echo internals (env var names, PostgREST bodies) on this
    // PUBLIC route — log server-side, answer generic.
    console.error('[/api/activate]', err)
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}
