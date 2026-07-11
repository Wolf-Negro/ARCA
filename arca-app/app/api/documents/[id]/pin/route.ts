import { NextRequest, NextResponse } from 'next/server'
import { updateDocument } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id?.trim()) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  try {
    const { pinned } = await req.json() as { pinned: number }
    const doc = updateDocument(params.id, { pinned })
    return NextResponse.json(doc)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
