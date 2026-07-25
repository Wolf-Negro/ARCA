import { NextRequest, NextResponse } from 'next/server'
import { toggleAgency, deleteAgency } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { active } = await req.json()
    if (typeof active !== 'boolean') {
      return NextResponse.json({ error: 'active (boolean) es requerido' }, { status: 400 })
    }
    const agency = await toggleAgency(id, active)
    return NextResponse.json(agency)
  } catch (err) {
    console.error('[/api/agencies/:id PATCH]', err)
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await deleteAgency(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[/api/agencies/:id DELETE]', err)
    return NextResponse.json({ error: 'Error interno. Intenta de nuevo.' }, { status: 500 })
  }
}
