import { NextRequest, NextResponse } from 'next/server'
import { extractDocumentMetadata } from '@/lib/metadata'
import {
  getMode,
  saveDocument,
  findDocumentByUrl,
  findDocumentByUrlAsync,
  getStats,
  getStatsAsync,
} from '@/lib/db'
import { extractTextFromFile, fetchUrlContent, UrlValidationError } from '@/lib/fileHandler'
import type { OgMetadata } from '@/lib/fileHandler'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      url,
      file,
      filename,
      mimeType,
      fileUrl,
      clientName,
      confirmed,
      confirmedMetadata,
    } = body

    if (confirmed && confirmedMetadata) {
      const resolvedUrl = fileUrl ?? url ?? null
      if (resolvedUrl) {
        const existing = getMode() === 'team'
          ? await findDocumentByUrlAsync(resolvedUrl)
          : findDocumentByUrl(resolvedUrl)
        if (existing) return NextResponse.json({ duplicate: true, existingDocument: existing })
      }

      // Local-first in BOTH modes: saveDocument already handles team mode
      // (marks synced=0, sets team_id, kicks triggerBackgroundSync). Writing
      // straight to Supabase (saveDocumentAsync) would strip the local
      // file:// link forever (remote rows carry file_url=null) and leave a
      // window where edit/delete can't find the row locally.
      const rawContent = body.rawContent ?? ''
      const doc = saveDocument(confirmedMetadata, resolvedUrl ?? undefined, mimeType, rawContent)
      return NextResponse.json({ saved: true, document: doc })
    }

    let rawContent      = ''
    let resolvedFileUrl = fileUrl ?? url ?? null
    let og: OgMetadata | undefined

    if (file && filename && mimeType) {
      rawContent = await extractTextFromFile(file, mimeType, filename)
    } else if (url) {
      const existing = getMode() === 'team'
        ? await findDocumentByUrlAsync(url)
        : findDocumentByUrl(url)
      if (existing) return NextResponse.json({ duplicate: true, existingDocument: existing })

      const fetched = await fetchUrlContent(url)
      rawContent      = fetched.text
      og              = fetched.og
      resolvedFileUrl = url
    }

    void resolvedFileUrl

    // Known clients let Gemini assign an existing client from the content
    // (it's forbidden from inventing new ones). Best-effort: an empty list
    // just means the user gets asked, as before.
    let knownClients: string[] = []
    try {
      const stats = getMode() === 'team' ? await getStatsAsync() : getStats()
      knownClients = stats.byClient.map((c) => c.client_name)
    } catch { /* ignore */ }

    const metadata = await extractDocumentMetadata(rawContent, filename, url, clientName, og, mimeType, knownClients)

    if (!metadata.client_name && !clientName) {
      return NextResponse.json({ needsClient: true, partialMetadata: metadata, rawContent })
    }
    if (clientName && !metadata.client_name) metadata.client_name = clientName

    return NextResponse.json({ proposedMetadata: metadata, rawContent })
  } catch (err) {
    if (err instanceof UrlValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[/api/save]', err)
    return NextResponse.json({ error: 'Error al procesar el documento. Intenta de nuevo.' }, { status: 500 })
  }
}
