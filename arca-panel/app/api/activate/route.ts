import { NextRequest, NextResponse } from 'next/server'
import { findAgencyByCode } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'code es requerido' }, { status: 400 })
    }

    const agency = await findAgencyByCode(code.trim().toUpperCase())
    if (!agency) {
      return NextResponse.json({ error: 'Código inválido o inactivo' }, { status: 404 })
    }

    return NextResponse.json({
      teamId:      agency.team_id,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
