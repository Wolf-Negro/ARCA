import { NextRequest, NextResponse } from 'next/server'
import { getMode, deleteDocument, deleteDocumentAsync, updateDocument, updateDocumentAsync } from '@/lib/db'
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
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!params.id?.trim()) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  try {
    const body = await req.json() as Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name' | 'pinned'>>
    const updated = updateDocument(params.id, body)
    return NextResponse.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
