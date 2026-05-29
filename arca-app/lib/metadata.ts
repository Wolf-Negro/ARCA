// Metadata extraction — pure rule-based, no external API.
// Uses URL patterns + OG tags for instant, free, reliable results.

export type { DocumentMetadata } from './types'
import type { DocumentMetadata } from './types'

// ─── Doc-type inference ───────────────────────────────────────────────────────

const MIME_DOCTYPE: Record<string, string> = {
  'application/pdf': 'Presentación',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Google Doc',
  'application/msword': 'Google Doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Presupuesto',
  'application/vnd.ms-excel': 'Presupuesto',
  'image/png':  'Creativo / Imagen',
  'image/jpeg': 'Creativo / Imagen',
  'image/gif':  'Creativo / Imagen',
  'image/webp': 'Creativo / Imagen',
  'video/mp4':  'Creativo / Video',
  'video/quicktime': 'Creativo / Video',
}

function docTypeFromUrl(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    const h = hostname.toLowerCase()
    const p = pathname.toLowerCase()

    if (h.includes('docs.google.com'))                             return 'Google Doc'
    if (h.includes('sheets.google.com'))                          return 'Google Sheet'
    if (h.includes('slides.google.com'))                          return 'Google Slides'
    if (h.includes('drive.google.com'))                           return 'Google Drive'
    if (h.includes('datastudio.google.com') ||
        h.includes('lookerstudio.google.com'))                    return 'Dashboard / Reporte'
    if (h.includes('figma.com'))                                  return 'Creativo / Imagen'
    if (h.includes('miro.com'))                                   return 'Brief de Campaña'
    if (h.includes('notion.so'))                                  return 'Google Doc'
    if (h.includes('trello.com') || h.includes('asana.com') ||
        h.includes('monday.com') || h.includes('airtable.com'))  return 'Brief de Campaña'
    if (h.includes('hubspot.com'))                                return 'Métricas / Resultados'
    if (h.includes('github.com'))                                 return 'Repositorio'
    if (h.includes('gitlab.com'))                                 return 'Repositorio'
    if (h.includes('bitbucket.org'))                              return 'Repositorio'
    if (h.includes('youtube.com') || h.includes('youtu.be'))     return 'Creativo / Video'
    if (h.includes('canva.com'))                                  return 'Creativo / Imagen'
    if (h.includes('dropbox.com'))                                return 'Google Drive'
    if (h.includes('whatsapp.com') || h.includes('wa.me'))       return 'Credenciales'
    if (h.includes('clickup.com') || h.includes('jira'))         return 'Brief de Campaña'
    if (h.includes('mailchimp.com'))                              return 'Email Marketing'
    if (h.includes('hotmart.com') || h.includes('gumroad.com'))  return 'Propuesta Comercial'
    if (/cpanel|whm|plesk|banahost|namecheap|godaddy|siteground|hostinger|cloudflare/.test(h)) return 'Hosting'
    if (/login|signin|credentials|admin|wp-admin/.test(p))       return 'Credenciales'
    if (p.endsWith('.pdf'))                                        return 'Presentación'
    if (p.endsWith('.xlsx') || p.endsWith('.xls'))                return 'Presupuesto'
    if (p.endsWith('.docx') || p.endsWith('.doc'))                return 'Google Doc'
  } catch { /* ignore */ }
  return null
}

// ─── Field builders ───────────────────────────────────────────────────────────

function buildFileName(
  og:       { title?: string } | undefined,
  filename: string | undefined,
  url:      string | undefined,
  docType:  string
): string {
  const ogTitle = og?.title?.trim()
  if (ogTitle) return ogTitle.slice(0, 80)
  if (filename)  return filename.replace(/\.[^.]+$/, '')
  if (url) {
    try {
      const { hostname, pathname } = new URL(url)
      const last = pathname.split('/').filter(Boolean).pop()
      return (last ?? hostname).replace(/[-_]/g, ' ').slice(0, 80)
    } catch { /* ignore */ }
  }
  return docType
}

function buildDescription(
  og:       { description?: string } | undefined,
  docType:  string,
  fileName: string
): string {
  const ogDesc = og?.description?.trim()
  if (ogDesc) {
    return ogDesc.split(/\s+/).slice(0, 20).join(' ')
  }
  return `${docType}: ${fileName}`
}

function buildTags(
  url:        string | undefined,
  docType:    string,
  clientName: string | null
): string[] {
  const tags = new Set<string>([docType])
  if (clientName) tags.add(clientName)
  if (url) {
    try {
      const h = new URL(url).hostname.toLowerCase()
      if (h.includes('google'))                                   tags.add('Google')
      if (h.includes('facebook') || h.includes('meta.com'))      tags.add('Meta')
      if (h.includes('tiktok'))                                   tags.add('TikTok')
      if (h.includes('instagram'))                                tags.add('Instagram')
      if (h.includes('youtube'))                                  tags.add('YouTube')
      if (h.includes('twitter') || h.includes('x.com'))          tags.add('Twitter/X')
      if (h.includes('linkedin'))                                 tags.add('LinkedIn')
      if (h.includes('github') || h.includes('gitlab') ||
          h.includes('bitbucket'))                                tags.add('Dev')
    } catch { /* ignore */ }
  }
  return Array.from(tags)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractDocumentMetadata(
  _content:    string,
  filename?:   string,
  url?:        string,
  clientName?: string,
  og?: { title?: string; description?: string; type?: string; image?: string },
  mimeType?:   string
): Promise<DocumentMetadata> {
  const docType =
    (url      ? docTypeFromUrl(url)          : null) ??
    (mimeType ? (MIME_DOCTYPE[mimeType]      ?? null) : null) ??
    'Presentación'

  const resolvedClient = clientName ?? null
  const fileName       = buildFileName(og, filename, url, docType)
  const description    = buildDescription(og, docType, fileName)
  const tags           = buildTags(url, docType, resolvedClient)

  return { client_name: resolvedClient, doc_type: docType, description, tags, file_name: fileName }
}

export async function extractTextFromImageUrl(_base64: string, _mimeType: string): Promise<string> {
  return ''
}
