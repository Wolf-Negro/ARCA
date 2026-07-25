import { NextRequest, NextResponse } from 'next/server'
import { listAgencies, createAgency } from '@/lib/db'

export async function GET() {
  try {
    const agencies = await listAgencies()
    return NextResponse.json(agencies)
  } catch (err) {
    console.error('[/api/agencies GET]', err)
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      return NextResponse.json({ error: 'name es requerido (máx. 80 caracteres)' }, { status: 400 })
    }
    // team_id derives from the name keeping only [a-z0-9-]; a name made of
    // symbols/emoji would produce team_id '' and a JWT scoped to nothing.
    if (!name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')) {
      return NextResponse.json({ error: 'El nombre debe contener al menos una letra o número' }, { status: 400 })
    }
    const agency = await createAgency(name.trim())
    return NextResponse.json(agency)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('ya existe')) return NextResponse.json({ error: 'Una agencia con ese nombre ya existe' }, { status: 409 })
    console.error('[/api/agencies POST]', err)
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}
