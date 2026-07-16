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
  getStats,
  getStatsAsync,
} from '@/lib/db'
import type { Document } from '@/lib/db'
import { getGeminiKey, interpretChatWithGemini } from '@/lib/gemini'
import type { AssistantContext } from '@/lib/gemini'

// Natural-language chat backend. Interprets the user's message with Gemini
// and executes the resulting action server-side, so useChat only has to
// render the response. `{ handled: false }` tells the client to fall back to
// its regex/substring pipeline — that's also the answer whenever Gemini is
// unconfigured or unreachable.

interface AssistantResponse {
  handled:        boolean
  message?:       string
  results?:       Document[]
  ui?:            'stats' | 'library' | 'help'
  openUrl?:       string
  clientFilter?:  string
  docTypeFilter?: string
}

function normalizeAccents(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

async function search(query?: string, clientFilter?: string, docTypeFilter?: string): Promise<Document[]> {
  const q = query ? normalizeAccents(query.toLowerCase()) : ''
  const raw = q
    ? (getMode() === 'team'
        ? await searchDocumentsAsync(q, clientFilter, docTypeFilter)
        : searchDocuments(q, clientFilter, docTypeFilter))
    : (getMode() === 'team'
        ? await listRecentDocumentsAsync(10, clientFilter)
        : listRecentDocuments(10, clientFilter))
  const results = docTypeFilter
    ? raw.filter((d) => d.doc_type.toLowerCase().includes(docTypeFilter.toLowerCase()))
    : raw
  const seen = new Set<string>()
  return results.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true))).slice(0, 5)
}

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()
    if (typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ handled: false } satisfies AssistantResponse)
    }
    if (!getGeminiKey()) {
      return NextResponse.json({ handled: false } satisfies AssistantResponse)
    }

    // ── Build compact context: stats + recent docs + best matches ──────────
    const team = getMode() === 'team'
    const stats = team ? await getStatsAsync() : getStats()

    const recent  = team ? await listRecentDocumentsAsync(15) : listRecentDocuments(15)
    let matches: Document[] = []
    try {
      const q = normalizeAccents(query.toLowerCase())
      matches = team ? await searchDocumentsAsync(q) : searchDocuments(q)
    } catch { /* best-effort */ }

    const byId = new Map<string, Document>()
    for (const d of [...matches.slice(0, 10), ...recent]) byId.set(d.id, d)
    const contextDocs = Array.from(byId.values()).slice(0, 25)

    const ctx: AssistantContext = {
      clients:  stats.byClient.map((c) => ({ name: c.client_name, count: c.count })),
      docTypes: stats.byType.map((t) => ({ name: t.doc_type, count: t.count })),
      docs: contextDocs.map((d) => ({
        id:          d.id,
        file_name:   d.file_name,
        client_name: d.client_name,
        doc_type:    d.doc_type,
        description: d.description,
        tags:        d.tags,
        created_at:  d.created_at,
        has_url:     !!d.file_url,
      })),
      today: new Date().toISOString().slice(0, 10),
    }

    const action = await interpretChatWithGemini(query.trim(), ctx)
    if (!action) {
      return NextResponse.json({ handled: false } satisfies AssistantResponse)
    }

    // ── Execute the action server-side ──────────────────────────────────────
    switch (action.action) {
      case 'help':
        return NextResponse.json({ handled: true, ui: 'help' } satisfies AssistantResponse)

      case 'stats':
        return NextResponse.json({ handled: true, ui: 'stats', message: 'Abriendo...' } satisfies AssistantResponse)

      case 'library':
        return NextResponse.json({
          handled: true,
          ui: 'library',
          message: 'Abriendo...',
          clientFilter:  action.clientFilter,
          docTypeFilter: action.docTypeFilter,
        } satisfies AssistantResponse)

      case 'count': {
        const count = team
          ? await countDocumentsAsync(action.clientFilter)
          : countDocuments(action.clientFilter)
        const message = action.clientFilter
          ? `${count} archivo${count !== 1 ? 's' : ''} de ${action.clientFilter}.`
          : `Tienen ${count} archivo${count !== 1 ? 's' : ''} guardados en ARCA.`
        return NextResponse.json({ handled: true, message } satisfies AssistantResponse)
      }

      case 'list_today':
      case 'list_yesterday': {
        const day = action.action === 'list_today' ? 'today' : 'yesterday'
        const results = team
          ? await listDocumentsByDateAsync(day, action.clientFilter)
          : listDocumentsByDate(day, action.clientFilter)
        const label = day === 'today' ? 'Hoy' : 'Ayer'
        const message = results.length
          ? `${label} guardamos ${results.length} archivo${results.length > 1 ? 's' : ''}:`
          : `${label === 'Hoy' ? 'Hoy no guardamos nada todavía.' : 'Ayer no guardamos nada.'}`
        return NextResponse.json({ handled: true, message, results } satisfies AssistantResponse)
      }

      case 'list_all': {
        const results = team
          ? await listRecentDocumentsAsync(10, action.clientFilter)
          : listRecentDocuments(10, action.clientFilter)
        const message = results.length
          ? `Aquí tienes los últimos ${results.length} links:`
          : 'No hay nada guardado aún.'
        return NextResponse.json({ handled: true, message, results } satisfies AssistantResponse)
      }

      case 'search': {
        const results = await search(action.query ?? query, action.clientFilter, action.docTypeFilter)
        const message = results.length
          ? `Aquí tienes ${results.length} link${results.length > 1 ? 's' : ''}:`
          : `No encontré nada de '${action.query ?? query}'. ¿Probás con otro término?`
        return NextResponse.json({ handled: true, message, results } satisfies AssistantResponse)
      }

      case 'open': {
        let doc: Document | undefined
        if (action.docId) doc = byId.get(action.docId)
        let candidates: Document[] = []
        if (!doc && (action.query || query)) {
          candidates = await search(action.query ?? query)
          if (candidates.length === 1) doc = candidates[0]
        }
        if (doc?.file_url) {
          return NextResponse.json({
            handled: true,
            message: `Abriendo "${doc.file_name}" ↗`,
            openUrl: doc.file_url,
          } satisfies AssistantResponse)
        }
        if (candidates.length > 1) {
          return NextResponse.json({
            handled: true,
            message: 'Encontré varios. ¿Cuál querés abrir?',
            results: candidates,
          } satisfies AssistantResponse)
        }
        return NextResponse.json({
          handled: true,
          message: 'No encontré ese archivo. ¿Me das más pistas?',
        } satisfies AssistantResponse)
      }

      case 'answer': {
        if (!action.answer?.trim()) {
          return NextResponse.json({ handled: false } satisfies AssistantResponse)
        }
        const results = (action.docIds ?? [])
          .map((id) => byId.get(id))
          .filter((d): d is Document => !!d)
          .slice(0, 5)
        return NextResponse.json({
          handled: true,
          message: action.answer.trim(),
          ...(results.length ? { results } : {}),
        } satisfies AssistantResponse)
      }

      default:
        return NextResponse.json({ handled: false } satisfies AssistantResponse)
    }
  } catch (err) {
    console.error('[/api/assistant]', err)
    // Any failure here must degrade to the local pipeline, never to an error.
    return NextResponse.json({ handled: false } satisfies AssistantResponse)
  }
}
