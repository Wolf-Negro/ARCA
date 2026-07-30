import { NextRequest, NextResponse } from 'next/server'
import {
  getMode,
  searchDocuments,
  searchDocumentsAsync,
  listRecentDocuments,
  listRecentDocumentsAsync,
  listDocumentsByDate,
  listDocumentsByDateAsync,
  countDocuments,
  countDocumentsAsync,
} from '@/lib/db'
import type { Document } from '@/lib/db'

function normalizeAccents(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, clientFilter, docTypeFilter, listAll, listToday, listYesterday, countOnly } = body

    const applyDocTypeFilter = (docs: Document[]): Document[] => {
      if (!docTypeFilter) return docs
      const f = (docTypeFilter as string).toLowerCase()
      return docs.filter(d => d.doc_type.toLowerCase().includes(f))
    }

    if (countOnly) {
      const count = getMode() === 'team'
        ? await countDocumentsAsync(clientFilter)
        : countDocuments(clientFilter)
      return NextResponse.json({ count })
    }

    if (listToday) {
      const raw = getMode() === 'team'
        ? await listDocumentsByDateAsync('today', clientFilter)
        : listDocumentsByDate('today', clientFilter)
      const results = applyDocTypeFilter(raw)
      return NextResponse.json({ results })
    }

    if (listYesterday) {
      const raw = getMode() === 'team'
        ? await listDocumentsByDateAsync('yesterday', clientFilter)
        : listDocumentsByDate('yesterday', clientFilter)
      const results = applyDocTypeFilter(raw)
      return NextResponse.json({ results })
    }

    if (listAll) {
      const raw = getMode() === 'team'
        ? await listRecentDocumentsAsync(10, clientFilter)
        : listRecentDocuments(10, clientFilter)
      const results = applyDocTypeFilter(raw)
      return NextResponse.json({ results })
    }

    if (!query?.trim()) {
      const raw = getMode() === 'team'
        ? await listRecentDocumentsAsync(5, clientFilter)
        : listRecentDocuments(5, clientFilter)
      const results = applyDocTypeFilter(raw)
      return NextResponse.json({ results })
    }

    // Normalize accents in the query before searching
    const normalizedQuery = normalizeAccents(query.toLowerCase())

    let results = applyDocTypeFilter(
      getMode() === 'team'
        ? await searchDocumentsAsync(normalizedQuery, clientFilter, docTypeFilter)
        : searchDocuments(normalizedQuery, clientFilter, docTypeFilter)
    )

    const seen = new Set<string>()
    results = results.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true })

    const seenUrls = new Set<string>()
    results = results.filter(d => {
      if (!d.file_url) return true
      if (seenUrls.has(d.file_url)) return false
      seenUrls.add(d.file_url)
      return true
    })

    return NextResponse.json({ results: results.slice(0, 8) })
  } catch (err) {
    console.error('[/api/search]', err)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: `Error al buscar: ${message}` }, { status: 500 })
  }
}
