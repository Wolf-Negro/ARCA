// Gemini — optional intelligence layer over the rule-based core.
//
// ARCA stays fully local/offline by default: every function here returns
// null (or '') when there's no API key, no network, or Gemini errors out,
// and callers fall back to the rule-based path silently. The key lives in
// the local SQLite `meta` table (set from the in-app settings screen) or,
// alternatively, in the GEMINI_API_KEY env var.

import { getMeta, setMeta } from './db'
import { DOC_TYPES } from './types'
import type { DocumentMetadata } from './types'

const GEMINI_MODEL = 'gemini-2.5-flash'
const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models'
const META_KEY     = 'gemini_api_key'

// ─── Key management ───────────────────────────────────────────────────────────

export function getGeminiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY?.trim()
  if (envKey) return envKey
  const stored = getMeta(META_KEY)?.trim()
  return stored || null
}

export function getGeminiKeySource(): 'env' | 'local' | null {
  if (process.env.GEMINI_API_KEY?.trim()) return 'env'
  if (getMeta(META_KEY)?.trim())          return 'local'
  return null
}

export function setGeminiKey(key: string): void {
  setMeta(META_KEY, key.trim())
}

// ─── Low-level call ───────────────────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

interface GenerateOpts {
  system?:    string
  json?:      boolean
  timeoutMs?: number
  apiKey?:    string
}

async function geminiRequest(parts: GeminiPart[], key: string, opts: GenerateOpts): Promise<Response> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] }

  return fetch(`${API_BASE}/${GEMINI_MODEL}:generateContent`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(opts.timeoutMs ?? 15000),
  })
}

function extractResponseText(data: unknown): string | null {
  const parts = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts.map((p) => p.text ?? '').join('')
  return text.trim() ? text : null
}

/** Returns the model's text, or null on ANY failure (no key, network, quota…).
 *  Callers must treat null as "use the rule-based fallback". */
export async function geminiGenerate(parts: GeminiPart[], opts: GenerateOpts = {}): Promise<string | null> {
  const key = opts.apiKey ?? getGeminiKey()
  if (!key) return null
  try {
    const res = await geminiRequest(parts, key, opts)
    if (!res.ok) return null
    return extractResponseText(await res.json())
  } catch {
    return null
  }
}

/** Live check used by /api/settings before persisting a key. */
export async function validateGeminiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await geminiRequest([{ text: 'Responde únicamente: ok' }], key, { timeoutMs: 10000 })
    if (res.ok) return { ok: true }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: 'La API key no es válida o no tiene permisos.' }
    }
    if (res.status === 429) {
      return { ok: false, error: 'La key es válida pero está sin cuota disponible (429).' }
    }
    return { ok: false, error: `Gemini respondió con error ${res.status}. Intenta de nuevo.` }
  } catch {
    return { ok: false, error: 'No se pudo contactar a Gemini. ¿Hay conexión a internet?' }
  }
}

function parseGeminiJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  try { return JSON.parse(cleaned) as T } catch { return null }
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

export interface MetadataHints {
  content?:      string
  filename?:     string
  url?:          string
  og?:           { title?: string; description?: string; type?: string }
  mimeType?:     string
  knownClients?: string[]
}

/** Infers document metadata from real content. Returns null when Gemini is
 *  unavailable or its answer is unusable — the rule-based result stands. */
export async function extractMetadataWithGemini(hints: MetadataHints): Promise<Partial<DocumentMetadata> | null> {
  if (!getGeminiKey()) return null

  const context = [
    hints.url                    ? `URL: ${hints.url}`                           : null,
    hints.filename               ? `Nombre de archivo: ${hints.filename}`        : null,
    hints.mimeType               ? `Tipo MIME: ${hints.mimeType}`                : null,
    hints.og?.title              ? `Título (OG): ${hints.og.title}`              : null,
    hints.og?.description        ? `Descripción (OG): ${hints.og.description}`   : null,
    hints.content?.trim()        ? `Contenido extraído:\n${hints.content.slice(0, 4000)}` : null,
  ].filter(Boolean).join('\n')
  if (!context) return null

  const clients = (hints.knownClients ?? []).filter(Boolean)
  const system = `Eres el clasificador de documentos de ARCA, un gestor documental para agencias de marketing.
Analiza el documento y devuelve SOLO un objeto JSON con esta forma exacta:
{"client_name": string|null, "doc_type": string, "description": string, "tags": string[], "file_name": string}

Reglas:
- "doc_type" DEBE ser exactamente uno de: ${DOC_TYPES.join(' | ')}.
- "client_name": ${clients.length
    ? `elige el cliente al que pertenece SOLO si coincide con uno de estos clientes existentes: ${clients.join(', ')}. Si no hay coincidencia clara, usa null.`
    : 'usa null (todavía no hay clientes registrados).'} Nunca inventes clientes.
- "description": una frase en español (máximo 25 palabras) que describa el contenido real del documento.
- "tags": entre 3 y 6 etiquetas cortas en español, útiles para buscar (plataforma, tema, campaña, formato).
- "file_name": un título corto y legible en español (máximo 80 caracteres), sin extensión de archivo.`

  const text = await geminiGenerate([{ text: context }], { system, json: true, timeoutMs: 12000 })
  if (!text) return null

  const parsed = parseGeminiJson<Partial<DocumentMetadata>>(text)
  if (!parsed || typeof parsed !== 'object') return null

  // Sanitize: never let a hallucinated value corrupt the document.
  const out: Partial<DocumentMetadata> = {}

  if (typeof parsed.doc_type === 'string' && (DOC_TYPES as readonly string[]).includes(parsed.doc_type)) {
    out.doc_type = parsed.doc_type
  }
  if (typeof parsed.description === 'string' && parsed.description.trim()) {
    out.description = parsed.description.trim().slice(0, 300)
  }
  if (typeof parsed.file_name === 'string' && parsed.file_name.trim()) {
    out.file_name = parsed.file_name.trim().slice(0, 80)
  }
  if (Array.isArray(parsed.tags)) {
    const tags = parsed.tags
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim().slice(0, 40))
      .slice(0, 8)
    if (tags.length) out.tags = tags
  }
  if (typeof parsed.client_name === 'string' && parsed.client_name.trim()) {
    const match = clients.find((c) => c.toLowerCase() === parsed.client_name!.trim().toLowerCase())
    if (match) out.client_name = match // canonical casing from the DB
  }

  return Object.keys(out).length ? out : null
}

// ─── Image OCR / description ──────────────────────────────────────────────────

/** OCR + short description for uploaded images. '' when unavailable. */
export async function extractTextFromImageWithGemini(base64: string, mimeType: string): Promise<string> {
  const text = await geminiGenerate(
    [
      { text: 'Extrae todo el texto visible de esta imagen (OCR). Si tiene poco o ningún texto, describe brevemente en español qué muestra (máximo 60 palabras). Devuelve solo el texto extraído o la descripción, sin comentarios adicionales.' },
      { inlineData: { mimeType, data: base64 } },
    ],
    { timeoutMs: 20000 }
  )
  return (text ?? '').slice(0, 6000)
}

// ─── Chat assistant (natural-language intent) ─────────────────────────────────

export interface AssistantAction {
  action:         'search' | 'list_all' | 'list_today' | 'list_yesterday' | 'count'
                | 'stats' | 'library' | 'open' | 'answer' | 'help'
  query?:         string
  clientFilter?:  string
  docTypeFilter?: string
  docId?:         string
  answer?:        string
  docIds?:        string[]
}

export interface AssistantContext {
  clients:  { name: string; count: number }[]
  docTypes: { name: string; count: number }[]
  docs:     {
    id:          string
    file_name:   string
    client_name: string | null
    doc_type:    string
    description: string
    tags:        string[]
    created_at:  string
    has_url:     boolean
  }[]
  today: string
}

/** Interprets a free-form Spanish message as an ARCA action. Null → the
 *  regex/substring fallback in useChat handles the message as before. */
export async function interpretChatWithGemini(query: string, ctx: AssistantContext): Promise<AssistantAction | null> {
  if (!getGeminiKey()) return null

  const system = `Eres el asistente de ARCA, un gestor documental para agencias de marketing. El usuario escribe en lenguaje natural (español). Tu trabajo es interpretar su mensaje y devolver SOLO un objeto JSON con la acción a ejecutar:

{"action": "search" | "list_all" | "list_today" | "list_yesterday" | "count" | "stats" | "library" | "open" | "answer" | "help", "query"?: string, "clientFilter"?: string, "docTypeFilter"?: string, "docId"?: string, "answer"?: string, "docIds"?: string[]}

Acciones:
- "search": buscar documentos. Usa "query" (términos clave, sin palabras de relleno) y opcionalmente "clientFilter"/"docTypeFilter".
- "list_all": listar los documentos recientes (admite "clientFilter").
- "list_today" / "list_yesterday": documentos guardados hoy / ayer.
- "count": cuántos documentos hay (admite "clientFilter").
- "stats": abrir el panel de estadísticas.
- "library": abrir la biblioteca completa (admite "clientFilter" y "docTypeFilter").
- "open": abrir un documento concreto. Si identificas cuál en la lista de documentos, pon su id en "docId"; si no, pon términos de búsqueda en "query".
- "answer": responder directamente una pregunta usando la información de los documentos listados abajo. Pon la respuesta en español en "answer" (breve, tono cercano) y en "docIds" los ids de los documentos que mencionas.
- "help": el usuario pregunta qué sabes hacer.

Reglas:
- "clientFilter" solo puede ser uno de los clientes existentes listados abajo.
- "docTypeFilter" solo puede ser uno de: ${DOC_TYPES.join(' | ')}.
- Si el mensaje es un saludo, charla casual o una pregunta sobre los documentos, usa "answer".
- Nunca inventes documentos ni clientes que no estén en el contexto.

Contexto:
Fecha de hoy: ${ctx.today}
Clientes existentes: ${ctx.clients.length ? ctx.clients.map((c) => `${c.name} (${c.count})`).join(', ') : '(ninguno todavía)'}
Tipos con documentos: ${ctx.docTypes.length ? ctx.docTypes.map((t) => `${t.name} (${t.count})`).join(', ') : '(ninguno todavía)'}
Documentos (los más recientes y los más relevantes al mensaje):
${ctx.docs.length ? JSON.stringify(ctx.docs) : '(no hay documentos guardados)'}`

  const text = await geminiGenerate([{ text: query }], { system, json: true, timeoutMs: 12000 })
  if (!text) return null

  const parsed = parseGeminiJson<AssistantAction>(text)
  if (!parsed || typeof parsed !== 'object') return null

  const VALID = ['search', 'list_all', 'list_today', 'list_yesterday', 'count', 'stats', 'library', 'open', 'answer', 'help']
  if (!VALID.includes(parsed.action)) return null
  return parsed
}
