import { NextRequest, NextResponse } from 'next/server'
import { listAgencies, createAgency } from '@/lib/db'

export async function GET() {
  try {
    const agencies = await listAgencies()
    return NextResponse.json(agencies)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name es requerido' }, { status: 400 })
    }
    const agency = await createAgency(name.trim())
    return NextResponse.json(agency)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('ya existe')) return NextResponse.json({ error: msg }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
