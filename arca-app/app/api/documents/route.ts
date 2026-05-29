import { NextRequest, NextResponse } from 'next/server'
import { getMode, listAllDocuments, listAllDocumentsAsync } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const rawPage       = parseInt(searchParams.get('page')  ?? '1',  10)
    const rawLimit      = parseInt(searchParams.get('limit') ?? '20', 10)
    const page          = Math.max(1,   isNaN(rawPage)  ? 1  : rawPage)
    const limit         = Math.min(100, Math.max(1, isNaN(rawLimit) ? 20 : rawLimit))
    const search        = searchParams.get('search')        ?? undefined
    const clientFilter  = searchParams.get('clientFilter')  ?? undefined
    const docTypeFilter = searchParams.get('docTypeFilter') ?? undefined

    const result = getMode() === 'team'
      ? await listAllDocumentsAsync(page, limit, search, clientFilter, docTypeFilter)
      : listAllDocuments(page, limit, search, clientFilter, docTypeFilter)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
