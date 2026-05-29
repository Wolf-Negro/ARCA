import { NextRequest, NextResponse } from 'next/server'
import { extractDocumentMetadata } from '@/lib/metadata'
import {
  getMode,
  saveDocument,
  saveDocumentAsync,
  findDocumentByUrl,
  findDocumentByUrlAsync,
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

      const rawContent = body.rawContent ?? ''
      const doc = getMode() === 'team'
        ? await saveDocumentAsync(confirmedMetadata, resolvedUrl ?? undefined, mimeType, rawContent)
        : saveDocument(confirmedMetadata, resolvedUrl ?? undefined, mimeType, rawContent)
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

    const metadata = await extractDocumentMetadata(rawContent, filename, url, clientName, og, mimeType)

    if (!metadata.client_name && !clientName) {
      return NextResponse.json({ needsClient: true, partialMetadata: metadata })
    }
    if (clientName && !metadata.client_name) metadata.client_name = clientName

    return NextResponse.json({ proposedMetadata: metadata, rawContent })
  } catch (err) {
    if (err instanceof UrlValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[/api/save]', err)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: `Error al procesar: ${message}` }, { status: 500 })
  }
}
