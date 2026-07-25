import { NextRequest, NextResponse } from 'next/server'
// deleteDocument/updateDocument handle team mode internally (they mark the
// row synced=-1/0 and trigger the background sync) — no Async variant needed.
import { deleteDocument, updateDocument } from '@/lib/db'
import type { Document } from '@/lib/db'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id?.trim()) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  try {
    deleteDocument(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[/api/documents/:id DELETE]', err)
    return NextResponse.json({ error: 'No se pudo eliminar el documento' }, { status: 500 })
  }
}

type Updates = Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name' | 'pinned'>>

// Whitelist + type-check each field: a raw body passed straight to
// better-sqlite3 turns wrong-typed values into binding TypeErrors (500) or,
// worse, silently corrupts tags (a string survives JSON round-trip).
function sanitizeUpdates(body: unknown): Updates | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const out: Updates = {}

  if (typeof b.client_name === 'string' || b.client_name === null) out.client_name = b.client_name as string | null
  if (typeof b.doc_type    === 'string' && b.doc_type.trim())      out.doc_type    = b.doc_type
  if (typeof b.description === 'string')                           out.description = b.description
  if (typeof b.file_name   === 'string' && b.file_name.trim())     out.file_name   = b.file_name
  if (b.pinned === 0 || b.pinned === 1)                            out.pinned      = b.pinned
  if (Array.isArray(b.tags) && b.tags.every((t) => typeof t === 'string')) out.tags = b.tags as string[]

  return Object.keys(out).length ? out : null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id?.trim()) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  try {
    const updates = sanitizeUpdates(await req.json().catch(() => null))
    if (!updates) {
      return NextResponse.json({ error: 'Sin campos válidos para actualizar' }, { status: 400 })
    }
    const updated = updateDocument(params.id, updates)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[/api/documents/:id PATCH]', err)
    return NextResponse.json({ error: 'No se pudo actualizar el documento' }, { status: 500 })
  }
}
