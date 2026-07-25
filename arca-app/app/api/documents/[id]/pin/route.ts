import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocument } from '@/lib/db'

// Toggles (or sets, when the body provides {pinned: 0|1}) a document's pin.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id?.trim()) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  try {
    // Body is optional: no body (or no valid pinned field) means "toggle".
    let pinned: number | undefined
    try {
      const body = await req.json()
      if (body?.pinned === 0 || body?.pinned === 1) pinned = body.pinned
    } catch { /* empty body → toggle */ }

    if (pinned === undefined) {
      const current = getDocumentById(params.id)
      if (!current) {
        return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })
      }
      pinned = current.pinned ? 0 : 1
    }

    const doc = updateDocument(params.id, { pinned })
    return NextResponse.json(doc)
  } catch (err) {
    console.error('[/api/documents/:id/pin]', err)
    return NextResponse.json({ error: 'No se pudo actualizar el documento' }, { status: 500 })
  }
}
