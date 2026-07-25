import dns from 'dns'
import { extractTextFromImageUrl } from './metadata'

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

export interface OgMetadata {
  title?:       string
  description?: string
  image?:       string
  type?:        string
}

export interface FetchedUrlResult {
  text: string
  og:   OgMetadata
}

export async function extractTextFromFile(
  base64: string,
  mimeType: string,
  filename: string
): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')

  if (mimeType === 'application/pdf') {
    return extractFromPdf(buffer)
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return extractFromDocx(buffer)
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return extractFromXlsx(buffer)
  }

  if (mimeType.startsWith('image/')) {
    return extractTextFromImageUrl(base64, mimeType)
  }

  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8')
  }

  return `Archivo: ${filename} (tipo: ${mimeType})`
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(buffer)
    return data.text.slice(0, 6000)
  } catch {
    return ''
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value.slice(0, 6000)
  } catch {
    return ''
  }
}

async function extractFromXlsx(buffer: Buffer): Promise<string> {
  try {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const lines: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      lines.push(`Hoja: ${sheetName}\n${csv}`)
    }
    return lines.join('\n\n').slice(0, 6000)
  } catch {
    return ''
  }
}

function parseMetaContent(html: string, property: string): string | undefined {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re1 = new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${esc}["']`, 'i')
  return (html.match(re1) ?? html.match(re2))?.[1]
}

function extractOg(html: string): OgMetadata {
  const og: OgMetadata = {}

  const title = parseMetaContent(html, 'og:title')
  if (title) og.title = title

  if (!og.title) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleTag?.[1]) og.title = titleTag[1].trim()
  }

  const description = parseMetaContent(html, 'og:description')
  if (description) og.description = description

  const image = parseMetaContent(html, 'og:image')
  if (image) og.image = image

  const type = parseMetaContent(html, 'og:type')
  if (type) og.type = type

  return og
}

// Domains that always require auth or return no useful text content.
// Skip the full fetch for these — the URL alone is enough for metadata.
const AUTH_ONLY_PATTERNS = [
  /docs\.google\.com/i,
  /sheets\.google\.com/i,
  /slides\.google\.com/i,
  /drive\.google\.com/i,
  /datastudio\.google\.com/i,
  /lookerstudio\.google\.com/i,
  /notion\.so/i,
  /app\.hubspot\.com/i,
  /app\.asana\.com/i,
  /trello\.com/i,
  /monday\.com/i,
  /figma\.com/i,
  /miro\.com/i,
  /airtable\.com/i,
]

function isAuthOnlyUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return AUTH_ONLY_PATTERNS.some((re) => re.test(hostname))
  } catch {
    return false
  }
}

// Private / cloud-metadata IP ranges that must never be fetched (SSRF prevention)
const BLOCKED_HOSTNAME = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,           // link-local + AWS/GCP/Azure metadata
  /^::1$/,
  /^(0+:){7}0*1$/,         // uncompressed IPv6 loopback (0:0:0:0:0:0:0:1)
  /^::$/,                  // unspecified
  /^::ffff:/i,             // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.)
  /^f[cd][0-9a-f]{2}:/i,   // unique-local fc00::/7 (fcXX: and the common fdXX:)
  /^fe80:/i,
  /\.internal$/i,
  /\.local$/i,
]

function isBlockedAddress(value: string): boolean {
  // URL.hostname wraps IPv6 literals in brackets — strip before matching.
  const bare = value.replace(/^\[|\]$/g, '')
  return BLOCKED_HOSTNAME.some(r => r.test(bare))
}

// Validates that a URL is safe to fetch server-side: rejects hostnames that are
// literally private/internal, AND resolves DNS to reject public-looking domains
// that point at a private/loopback/link-local IP (DNS rebinding protection).
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new UrlValidationError('URL inválida') }
  const h = parsed.hostname.toLowerCase()
  if (isBlockedAddress(h)) {
    throw new UrlValidationError('URL apunta a una dirección privada o interna')
  }

  let addresses: { address: string }[]
  try {
    addresses = await dns.promises.lookup(h, { all: true })
  } catch {
    throw new UrlValidationError('No se pudo resolver el dominio')
  }

  if (addresses.length === 0 || addresses.some(a => isBlockedAddress(a.address))) {
    throw new UrlValidationError('URL apunta a una dirección privada o interna')
  }
}

export async function fetchUrlContent(url: string): Promise<FetchedUrlResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new UrlValidationError('URL inválida: debe comenzar con http:// o https://')
  }

  await assertSafeUrl(url)

  // Fast-path: services that require login return no useful HTML content.
  // Skip the expensive HEAD + GET and let the URL pattern drive metadata extraction.
  if (isAuthOnlyUrl(url)) {
    return { text: '', og: {} }
  }

  // Single GET — handles 404, auth redirects, and timeouts in one round-trip.
  // Redirects are followed MANUALLY so every hop goes through assertSafeUrl:
  // with redirect:'follow', a public URL answering "302 → http://127.0.0.1/…"
  // or "302 → http://169.254.169.254/…" would bypass the SSRF check entirely.
  try {
    let currentUrl = url
    let res: Response
    for (let hop = 0; ; hop++) {
      res = await fetch(currentUrl, {
        headers:  { 'User-Agent': 'Mozilla/5.0 ARCA-Bot/1.0' },
        redirect: 'manual',
        signal:   AbortSignal.timeout(4000),
      })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) break
      if (hop >= 5) return { text: '', og: {} }
      currentUrl = new URL(location, currentUrl).toString()
      if (!/^https?:$/.test(new URL(currentUrl).protocol)) return { text: '', og: {} }
      await assertSafeUrl(currentUrl)
    }

    if (res.status === 404) throw new UrlValidationError('La URL no existe (404)')

    // 401/403 or redirect to login → private URL, save without content
    const redirectedToLogin =
      currentUrl !== url &&
      /\/(login|signin)/i.test(new URL(currentUrl).pathname)
    if (res.status === 401 || res.status === 403 || redirectedToLogin) {
      return { text: '', og: {} }
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!/text\/(html|plain)|application\/(xhtml\+xml)/.test(contentType)) {
      return { text: '', og: {} }
    }

    const html = await res.text()
    const og   = extractOg(html)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000)
    return { text, og }
  } catch (err) {
    if (err instanceof UrlValidationError) throw err
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new UrlValidationError('La URL no respondió a tiempo')
    }
    return { text: '', og: {} }
  }
}
