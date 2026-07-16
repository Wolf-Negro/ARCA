import Database from 'better-sqlite3'
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, basename, join, resolve, sep } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentMetadata } from './metadata'
import { runBackup } from './backup'
import { DB_PATH, UPLOADS_DIR } from './paths'

// ─── Team mode config (set by /api/init-team) ─────────────────────────────────

let _supabaseUrl: string | null = null
let _supabaseKey: string | null = null // per-agency JWT (falls back to the anon key for old configs)
let _anonKey:     string | null = null
let _teamId:      string | null = null

// Team config only ever lived in RAM before — a Next.js server restart
// (without the Electron renderer re-running its init-team fetch) silently
// dropped back to personal mode. Persisted next to the DB file so getMode()
// can recover it on its own.
const TEAM_CONFIG_PATH = join(dirname(DB_PATH), 'team-config.json')
let _triedLoadTeamConfig = false

function loadPersistedTeamConfig(): void {
  if (_triedLoadTeamConfig) return
  _triedLoadTeamConfig = true
  try {
    const raw = readFileSync(TEAM_CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw) as { supabaseUrl?: string, supabaseKey?: string, anonKey?: string, teamId?: string }
    if (cfg.supabaseUrl && cfg.supabaseKey && cfg.teamId) {
      _supabaseUrl = cfg.supabaseUrl
      _supabaseKey = cfg.supabaseKey
      _anonKey     = cfg.anonKey ?? null
      _teamId      = cfg.teamId
    }
  } catch {
    // No persisted config yet, or unreadable — stay in personal mode.
  }
}

export function setTeamConfig(supabaseUrl: string, supabaseKey: string, teamId: string, anonKey?: string): void {
  _supabaseUrl = supabaseUrl
  _supabaseKey = supabaseKey
  _anonKey     = anonKey ?? null
  _teamId      = teamId
  _triedLoadTeamConfig = true // this call is now the source of truth, no need to load from disk
  try {
    // Same exposure level as arca-config.json (plaintext on disk) — accepted
    // for the pilot; supabaseKey is now a scoped per-agency JWT rather than
    // the shared anon key, so a leak here no longer grants access to every
    // other agency's data.
    writeFileSync(TEAM_CONFIG_PATH, JSON.stringify({ supabaseUrl, supabaseKey, anonKey, teamId }), 'utf-8')
  } catch {
    // Best-effort — team mode still works for the current process even if
    // this write fails, it just won't survive a server restart.
  }
}

export function getMode(): 'personal' | 'team' {
  if (!_supabaseUrl) loadPersistedTeamConfig()
  return (_supabaseUrl && _supabaseKey && _teamId) ? 'team' : 'personal'
}

function supabaseHeaders() {
  return {
    // apikey must be the project's anon/publishable key for PostgREST to
    // accept the request at all; Authorization carries the per-agency JWT
    // that RLS policies actually check (auth.jwt() ->> 'team_id'). Configs
    // saved before the JWT migration have no anonKey — fall back to using
    // supabaseKey for both, same as the old shared-anon-key behavior.
    'apikey':        _anonKey ?? _supabaseKey!,
    'Authorization': `Bearer ${_supabaseKey!}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  }
}

function supabaseUrl(path: string): string {
  return `${_supabaseUrl}/rest/v1/${path}`
}

function rowToDocFromSupabase(row: any): Document {
  return {
    id:          row.id,
    created_at:  row.created_at,
    client_name: row.client_name ?? null,
    doc_type:    row.doc_type,
    description: row.description,
    tags:        Array.isArray(row.tags) ? row.tags : (typeof row.tags === 'string' ? JSON.parse(row.tags) : []),
    file_url:    row.file_url ?? null,
    file_name:   row.file_name,
    mime_type:   row.mime_type ?? null,
    raw_content: row.raw_content ?? null,
    // `mode` is a local-only concept (SQLite distinguishes 'personal' vs
    // 'team' rows) — the real Supabase table has no `mode` column at all
    // (confirmed: sending it in an insert/update payload caused every
    // team-mode save to fail with a PostgREST "unknown column" 400). Any row
    // that came from Supabase is, by definition, a team row.
    mode:        'team',
    team_id:     row.team_id ?? null,
    // Supabase's `pinned` is a real Postgres BOOLEAN; local SQLite stores it
    // as INTEGER 0/1 (see the Document type and the local CREATE TABLE
    // below). `row.pinned ?? 0` would let a Postgres `false` pass through
    // as-is instead of coercing to 0 — `??` only replaces null/undefined,
    // not falsy values — leaving a stray JS boolean in a Document that's
    // otherwise all-numbers, and better-sqlite3 rejects binding a boolean
    // as a bound parameter outright (pullSupabaseChanges' upsert below
    // would throw the first time a pinned=false row synced down).
    pinned:      row.pinned ? 1 : 0,
    synced:      row.synced ?? 1,
  }
}

export interface Document {
  id:          string
  created_at:  string
  client_name: string | null
  doc_type:    string
  description: string
  tags:        string[]
  file_url:    string | null
  file_name:   string
  mime_type:   string | null
  raw_content: string | null
  mode:        string
  team_id:     string | null
  pinned:      number
  synced:      number
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let db: Database.Database | null = null

// Prepared statements (created once in getDb)
let stmtInsert:        Database.Statement
let stmtSelectById:    Database.Statement
let stmtSelectByUrl:   Database.Statement
let stmtDeleteById:    Database.Statement
let stmtUpdate:        Database.Statement
let stmtSelectAll:     Database.Statement

function getDb(): Database.Database {
  if (db) return db

  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      client_name TEXT,
      doc_type    TEXT NOT NULL,
      description TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      file_url    TEXT,
      file_name   TEXT NOT NULL,
      mime_type   TEXT,
      raw_content TEXT,
      mode        TEXT NOT NULL DEFAULT 'personal',
      team_id     TEXT,
      pinned      INTEGER DEFAULT 0,
      synced      INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_client  ON documents(client_name);
    CREATE INDEX IF NOT EXISTS idx_created ON documents(created_at DESC);

    -- Small key/value store for sync bookkeeping (e.g. the incremental-pull
    -- watermark) — doesn't warrant its own module.
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // Safe migrations for existing databases
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN pinned INTEGER DEFAULT 0`)
  } catch (err) {}
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN synced INTEGER DEFAULT 1`)
  } catch (err) {}

  // One-time repair for uploads whose file:// URL points at a path that no
  // longer exists (e.g. arca-desktop moved the uploads dir to survive
  // auto-updates) — if a file with the same name exists in the current
  // UPLOADS_DIR, repoint the row at it instead of leaving a dead link.
  try {
    const rows = db.prepare(`SELECT id, file_url FROM documents WHERE file_url LIKE 'file://%'`).all() as { id: string, file_url: string }[]
    const fixStmt = db.prepare(`UPDATE documents SET file_url = ? WHERE id = ?`)
    for (const row of rows) {
      const currentPath = row.file_url.slice('file://'.length)
      if (existsSync(currentPath)) continue
      const candidate = join(UPLOADS_DIR, basename(currentPath))
      if (existsSync(candidate)) {
        fixStmt.run(`file://${candidate}`, row.id)
      }
    }
  } catch (err) {
    console.error('[db] file_url migration failed', err)
  }

  // Best-effort backup of the DB file, once per process startup. Never
  // allowed to block or crash initialization.
  try {
    runBackup()
  } catch (err) {
    console.error('[backup] runBackup failed', err)
  }

  stmtInsert = db.prepare(`
    INSERT INTO documents
      (id, created_at, client_name, doc_type, description, tags, file_url, file_name, mime_type, raw_content, mode, team_id, pinned, synced)
    VALUES
      (@id, @created_at, @client_name, @doc_type, @description, @tags, @file_url, @file_name, @mime_type, @raw_content, @mode, @team_id, @pinned, @synced)
  `)

  stmtSelectById = db.prepare(`SELECT * FROM documents WHERE id = ?`)

  stmtSelectByUrl = db.prepare(`SELECT * FROM documents WHERE file_url = ?`)

  stmtDeleteById = db.prepare(`DELETE FROM documents WHERE id = ?`)

  stmtUpdate = db.prepare(`
    UPDATE documents
    SET client_name = @client_name,
        doc_type    = @doc_type,
        description = @description,
        tags        = @tags,
        file_name   = @file_name,
        pinned      = @pinned,
        synced      = @synced
    WHERE id = @id
  `)

  stmtSelectAll = db.prepare(`SELECT * FROM documents WHERE synced != -1 ORDER BY pinned DESC, created_at DESC`)

  return db
}

// ─── Sync bookkeeping (meta table) ────────────────────────────────────────────

export function getMeta(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  getDb().prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
}

// ─── Local file deletion ──────────────────────────────────────────────────────

/** Best-effort removal of an uploaded file when its document is deleted.
 *  Only ever touches paths that resolve inside UPLOADS_DIR — never anything
 *  else on disk, even if file_url were somehow malformed. */
function deleteLocalFileIfOwned(fileUrl: string | null): void {
  if (!fileUrl || !fileUrl.startsWith('file://')) return
  try {
    const target = resolve(fileUrl.slice('file://'.length))
    const uploadsRoot = resolve(UPLOADS_DIR)
    if (target !== uploadsRoot && !target.startsWith(uploadsRoot + sep)) return
    if (existsSync(target)) unlinkSync(target)
  } catch {
    // Best-effort — a stale/already-gone file should never block a delete.
  }
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: Map<string, Document> | null = null

function loadCache(): Map<string, Document> {
  if (cache) return cache
  getDb()
  const rows = stmtSelectAll.all() as any[]
  cache = new Map(rows.map(r => [r.id, rowToDoc(r)]))
  return cache
}

function invalidateCache(): void {
  cache = null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToDoc(row: any): Document {
  return {
    id:          row.id,
    created_at:  row.created_at,
    client_name: row.client_name ?? null,
    doc_type:    row.doc_type,
    description: row.description,
    tags:        JSON.parse(row.tags ?? '[]'),
    file_url:    row.file_url ?? null,
    file_name:   row.file_name,
    mime_type:   row.mime_type ?? null,
    raw_content: row.raw_content ?? null,
    mode:        row.mode ?? 'personal',
    team_id:     row.team_id ?? null,
    pinned:      row.pinned ?? 0,
    synced:      row.synced ?? 1,
  }
}

function normalizeUrl(url: string): string {
  try {
    const p = new URL(url)
    p.protocol = 'https:'
    if (p.pathname.length > 1 && p.pathname.endsWith('/')) p.pathname = p.pathname.replace(/\/+$/, '')
    p.search = ''
    p.hash   = ''
    return p.toString()
  } catch {
    return url.replace(/\/+$/, '')
  }
}

function textMatches(doc: Document, q: string): boolean {
  return [doc.file_name, doc.client_name, doc.description, doc.file_url, ...doc.tags]
    .some(f => f?.toLowerCase().includes(q))
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function saveDocument(
  metadata:    DocumentMetadata,
  fileUrl?:    string,
  mimeType?:   string,
  rawContent?: string
): Document {
  getDb()
  const mode = getMode()
  const doc: Document = {
    id:          uuidv4(),
    created_at:  new Date().toISOString(),
    client_name: metadata.client_name,
    doc_type:    metadata.doc_type,
    description: metadata.description,
    tags:        metadata.tags,
    file_url:    fileUrl    ?? null,
    file_name:   metadata.file_name,
    mime_type:   mimeType   ?? null,
    raw_content: rawContent ?? null,
    mode:        mode,
    team_id:     mode === 'team' ? _teamId : null,
    pinned:      0,
    synced:      mode === 'team' ? 0 : 1,
  }
  stmtInsert.run({
    id:          doc.id,
    created_at:  doc.created_at,
    client_name: doc.client_name,
    doc_type:    doc.doc_type,
    description: doc.description,
    tags:        JSON.stringify(doc.tags),
    file_url:    doc.file_url,
    file_name:   doc.file_name,
    mime_type:   doc.mime_type,
    raw_content: doc.raw_content,
    mode:        doc.mode,
    team_id:     doc.team_id,
    pinned:      doc.pinned,
    synced:      doc.synced,
  })
  invalidateCache()

  if (mode === 'team') {
    triggerBackgroundSync().catch(() => {})
  }

  return doc
}

export function findDocumentByUrl(url: string): Document | null {
  const candidates = new Set([url, normalizeUrl(url)])
  const docs = Array.from(loadCache().values())
  return docs.find(d => d.file_url && (candidates.has(d.file_url) || candidates.has(normalizeUrl(d.file_url)))) ?? null
}

export function searchDocuments(
  query:          string,
  clientFilter?:  string,
  docTypeFilter?: string
): Document[] {
  const q = query.toLowerCase().trim()
  let docs = Array.from(loadCache().values())
  if (clientFilter)  docs = docs.filter(d => d.client_name?.toLowerCase().includes(clientFilter.toLowerCase()))
  if (docTypeFilter) { const f = docTypeFilter.toLowerCase(); docs = docs.filter(d => d.doc_type.toLowerCase().includes(f)) }
  if (q)             docs = docs.filter(d => textMatches(d, q))
  return docs.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function listRecentDocuments(limit: number, clientFilter?: string): Document[] {
  let docs = Array.from(loadCache().values())
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  if (clientFilter) docs = docs.filter(d => d.client_name?.toLowerCase().includes(clientFilter.toLowerCase()))
  return docs.slice(0, limit)
}

export function listDocumentsByDate(date: 'today' | 'yesterday', clientFilter?: string): Document[] {
  const dayMs      = 86_400_000
  const now        = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = date === 'today' ? todayStart               : new Date(todayStart.getTime() - dayMs)
  const to   = date === 'today' ? new Date(todayStart.getTime() + dayMs) : todayStart

  let docs = Array.from(loadCache().values()).filter(d => {
    const t = new Date(d.created_at).getTime()
    return !isNaN(t) && t >= from.getTime() && t < to.getTime()
  })
  if (clientFilter) docs = docs.filter(d => d.client_name?.toLowerCase().includes(clientFilter.toLowerCase()))
  return docs.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function countDocuments(clientFilter?: string): number {
  let docs = Array.from(loadCache().values())
  if (clientFilter) docs = docs.filter(d => d.client_name?.toLowerCase().includes(clientFilter.toLowerCase()))
  return docs.length
}

export function listAllDocuments(
  page:           number,
  limit:          number,
  search?:        string,
  clientFilter?:  string,
  docTypeFilter?: string
): { docs: Document[]; total: number } {
  let docs = Array.from(loadCache().values())
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  if (search)        { const q = search.toLowerCase();       docs = docs.filter(d => textMatches(d, q)) }
  if (clientFilter)  { docs = docs.filter(d => d.client_name === clientFilter) }
  if (docTypeFilter) { const f = docTypeFilter.toLowerCase(); docs = docs.filter(d => d.doc_type.toLowerCase().includes(f)) }
  const total = docs.length
  const from  = Math.max(0, (page - 1) * limit)
  return { docs: docs.slice(from, from + limit), total }
}

export function deleteDocument(id: string): void {
  getDb()
  const mode = getMode()
  if (mode === 'team') {
    getDb().prepare(`UPDATE documents SET synced = -1 WHERE id = ?`).run(id)
    invalidateCache()
    triggerBackgroundSync().catch(() => {})
  } else {
    const row = stmtSelectById.get(id) as { file_url: string | null } | undefined
    stmtDeleteById.run(id)
    invalidateCache()
    if (row) deleteLocalFileIfOwned(row.file_url)
  }
}

export function updateDocument(
  id:      string,
  updates: Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name' | 'pinned'>>
): Document {
  const c   = loadCache()
  const doc = c.get(id)
  if (!doc) throw new Error('Documento no encontrado')

  const merged = { ...doc, ...updates }
  const mode = getMode()
  const synced = mode === 'team' ? 0 : 1

  stmtUpdate.run({
    id:          id,
    client_name: merged.client_name,
    doc_type:    merged.doc_type,
    description: merged.description,
    tags:        JSON.stringify(merged.tags),
    file_name:   merged.file_name,
    pinned:      merged.pinned ?? doc.pinned,
    synced:      synced,
  })
  invalidateCache()

  if (mode === 'team') {
    triggerBackgroundSync().catch(() => {})
  }

  // Reload from DB to return authoritative state
  const row = stmtSelectById.get(id) as any
  if (!row) throw new Error('Documento no encontrado tras actualizar')
  return rowToDoc(row)
}

export function getStats(): {
  total:    number
  byClient: { client_name: string; count: number }[]
  byType:   { doc_type: string; count: number }[]
} {
  const docs = Array.from(loadCache().values())
  const clientMap = new Map<string, number>()
  const typeMap   = new Map<string, number>()
  for (const d of docs) {
    if (d.client_name) clientMap.set(d.client_name, (clientMap.get(d.client_name) ?? 0) + 1)
    if (d.doc_type)    typeMap.set(d.doc_type,       (typeMap.get(d.doc_type)       ?? 0) + 1)
  }
  return {
    total:    docs.length,
    byClient: Array.from(clientMap.entries()).map(([client_name, count]) => ({ client_name, count })).sort((a, b) => b.count - a.count),
    byType:   Array.from(typeMap.entries()).map(([doc_type, count]) => ({ doc_type, count })).sort((a, b) => b.count - a.count),
  }
}

// ─── Async Supabase functions (team mode) ────────────────────────────────────

export async function saveDocumentAsync(
  metadata:    DocumentMetadata,
  fileUrl?:    string,
  mimeType?:   string,
  rawContent?: string
): Promise<Document> {
  const doc = {
    id:          uuidv4(),
    created_at:  new Date().toISOString(),
    client_name: metadata.client_name,
    doc_type:    metadata.doc_type,
    description: metadata.description,
    tags:        metadata.tags,
    // A file:// URL only means anything on the machine that saved it — share
    // the metadata with the rest of the team, but not a dead local path.
    file_url:    fileUrl?.startsWith('file://') ? null : (fileUrl ?? null),
    file_name:   metadata.file_name,
    mime_type:   mimeType   ?? null,
    raw_content: rawContent ?? null,
    // No `mode` field here — the real Supabase table has no `mode` column;
    // sending it made PostgREST reject every team-mode insert with a 400
    // ("unknown column"). `mode` is purely a local SQLite concept.
    team_id:     _teamId,
  }
  const res = await fetch(supabaseUrl('documents'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(doc),
  })
  if (!res.ok) {
    // PostgREST's response body (code/message/details/hint) is the only way
    // to actually diagnose a failed insert — a bare status code doesn't say
    // whether it's an unknown column, a NOT NULL violation, a type mismatch,
    // etc. Never discard it.
    const errorBody = await res.text().catch(() => '<no se pudo leer el cuerpo de la respuesta>')
    console.error('[saveDocumentAsync] Supabase insert failed', {
      status:  res.status,
      body:    errorBody,
      payload: { ...doc, raw_content: doc.raw_content ? `<${doc.raw_content.length} chars omitidos>` : null },
    })
    throw new Error(`Supabase insert failed: ${res.status} — ${errorBody}`)
  }
  const rows = await res.json()
  return rowToDocFromSupabase(Array.isArray(rows) ? rows[0] : rows)
}

export async function findDocumentByUrlAsync(url: string): Promise<Document | null> {
  const normalized = normalizeUrl(url)
  const candidates = [url, normalized].filter((v, i, a) => a.indexOf(v) === i)
  for (const candidate of candidates) {
    const res = await fetch(
      supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&file_url=eq.${encodeURIComponent(candidate)}&limit=1`),
      { headers: supabaseHeaders() }
    )
    if (res.ok) {
      const rows = await res.json()
      if (rows.length > 0) return rowToDocFromSupabase(rows[0])
    }
  }
  return null
}

export async function searchDocumentsAsync(
  query:          string,
  clientFilter?:  string,
  docTypeFilter?: string
): Promise<Document[]> {
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&order=created_at.desc`
  if (clientFilter)  path += `&client_name=ilike.*${encodeURIComponent(clientFilter)}*`
  if (docTypeFilter) path += `&doc_type=ilike.*${encodeURIComponent(docTypeFilter)}*`
  if (query) {
    const q = encodeURIComponent(`*${query}*`)
    path += `&or=(file_name.ilike.${q},description.ilike.${q},client_name.ilike.${q})`
  }
  const res = await fetch(supabaseUrl(path), { headers: supabaseHeaders() })
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map(rowToDocFromSupabase)
}

export async function listRecentDocumentsAsync(limit: number, clientFilter?: string): Promise<Document[]> {
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&order=created_at.desc&limit=${limit}`
  if (clientFilter) path += `&client_name=ilike.*${encodeURIComponent(clientFilter)}*`
  const res = await fetch(supabaseUrl(path), { headers: supabaseHeaders() })
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map(rowToDocFromSupabase)
}

export async function listDocumentsByDateAsync(date: 'today' | 'yesterday', clientFilter?: string): Promise<Document[]> {
  const dayMs      = 86_400_000
  const now        = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = date === 'today' ? todayStart               : new Date(todayStart.getTime() - dayMs)
  const to   = date === 'today' ? new Date(todayStart.getTime() + dayMs) : todayStart
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&created_at=gte.${from.toISOString()}&created_at=lt.${to.toISOString()}&order=created_at.desc`
  if (clientFilter) path += `&client_name=ilike.*${encodeURIComponent(clientFilter)}*`
  const res = await fetch(supabaseUrl(path), { headers: supabaseHeaders() })
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map(rowToDocFromSupabase)
}

export async function countDocumentsAsync(clientFilter?: string): Promise<number> {
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&select=id`
  if (clientFilter) path += `&client_name=ilike.*${encodeURIComponent(clientFilter)}*`
  const res = await fetch(supabaseUrl(path), {
    headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' },
  })
  if (!res.ok) return 0
  const countHeader = res.headers.get('content-range')
  if (countHeader) {
    const parts = countHeader.split('/')
    const total = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(total)) return total
  }
  const rows = await res.json()
  return Array.isArray(rows) ? rows.length : 0
}

export async function listAllDocumentsAsync(
  page:           number,
  limit:          number,
  search?:        string,
  clientFilter?:  string,
  docTypeFilter?: string
): Promise<{ docs: Document[]; total: number }> {
  const offset = Math.max(0, (page - 1) * limit)
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (clientFilter)  path += `&client_name=eq.${encodeURIComponent(clientFilter)}`
  if (docTypeFilter) path += `&doc_type=ilike.*${encodeURIComponent(docTypeFilter)}*`
  if (search) {
    const q = encodeURIComponent(`*${search}*`)
    path += `&or=(file_name.ilike.${q},description.ilike.${q})`
  }

  // Get total count separately
  let totalPath = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&select=id`
  if (clientFilter)  totalPath += `&client_name=eq.${encodeURIComponent(clientFilter)}`
  if (docTypeFilter) totalPath += `&doc_type=ilike.*${encodeURIComponent(docTypeFilter)}*`
  if (search) {
    const q = encodeURIComponent(`*${search}*`)
    totalPath += `&or=(file_name.ilike.${q},description.ilike.${q})`
  }

  const [docsRes, countRes] = await Promise.all([
    fetch(supabaseUrl(path), { headers: supabaseHeaders() }),
    fetch(supabaseUrl(totalPath), { headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' } }),
  ])

  const docs  = docsRes.ok  ? (await docsRes.json()).map(rowToDocFromSupabase) : []
  let   total = 0
  if (countRes.ok) {
    const cr = countRes.headers.get('content-range')
    if (cr) { const p = cr.split('/'); total = parseInt(p[p.length - 1], 10) || 0 }
    else    { const rows = await countRes.json(); total = Array.isArray(rows) ? rows.length : 0 }
  }
  return { docs, total }
}

export async function deleteDocumentAsync(id: string): Promise<void> {
  // Soft-delete (tombstone), not a hard DELETE: other team members'
  // incremental pull only asks PostgREST for rows changed since its last
  // watermark, so a real DELETE would just vanish from that query — nobody
  // else would ever be told to remove their local copy.
  await fetch(supabaseUrl(`documents?id=eq.${id}&team_id=eq.${encodeURIComponent(_teamId!)}`), {
    method:  'PATCH',
    headers: supabaseHeaders(),
    body:    JSON.stringify({ deleted: true }),
  })
}

export async function updateDocumentAsync(
  id:      string,
  updates: Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name'>>
): Promise<Document> {
  const res = await fetch(supabaseUrl(`documents?id=eq.${id}&team_id=eq.${encodeURIComponent(_teamId!)}`), {
    method:  'PATCH',
    headers: supabaseHeaders(),
    body:    JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Documento no encontrado')
  const rows = await res.json()
  return rowToDocFromSupabase(Array.isArray(rows) ? rows[0] : rows)
}

export async function getStatsAsync(): Promise<{
  total:    number
  byClient: { client_name: string; count: number }[]
  byType:   { doc_type: string; count: number }[]
}> {
  const res = await fetch(supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&deleted=eq.false&select=client_name,doc_type`), { headers: supabaseHeaders() })
  if (!res.ok) return { total: 0, byClient: [], byType: [] }
  const rows = await res.json()
  const clientMap = new Map<string, number>()
  const typeMap   = new Map<string, number>()
  for (const r of rows) {
    if (r.client_name) clientMap.set(r.client_name, (clientMap.get(r.client_name) ?? 0) + 1)
    if (r.doc_type)    typeMap.set(r.doc_type,       (typeMap.get(r.doc_type)       ?? 0) + 1)
  }
  return {
    total:    rows.length,
    byClient: Array.from(clientMap.entries()).map(([client_name, count]) => ({ client_name, count })).sort((a,b) => b.count - a.count),
    byType:   Array.from(typeMap.entries()).map(([doc_type, count]) => ({ doc_type, count })).sort((a,b) => b.count - a.count),
  }
}

export async function triggerBackgroundSync(): Promise<void> {
  if (getMode() !== 'team') return

  let pushedSomething = false

  // 1. Push pending creations/updates (synced = 0)
  const pendingUpdates = getDb().prepare(`SELECT * FROM documents WHERE synced = 0`).all() as any[]
  for (const row of pendingUpdates) {
    const doc = rowToDoc(row)
    try {
      // Check if exists in Supabase
      const checkRes = await fetch(supabaseUrl(`documents?id=eq.${doc.id}`), {
        headers: supabaseHeaders(),
      })
      const exists = checkRes.ok && (await checkRes.json()).length > 0

      const payload = {
        id:          doc.id,
        created_at:  doc.created_at,
        client_name: doc.client_name,
        doc_type:    doc.doc_type,
        description: doc.description,
        tags:        doc.tags,
        // A file:// URL only means anything on this machine — share the
        // metadata with the team, not a dead local path (see the matching
        // note in saveDocumentAsync, and the ON CONFLICT exclusion of
        // file_url in pullSupabaseChanges' upsert below).
        file_url:    doc.file_url?.startsWith('file://') ? null : doc.file_url,
        file_name:   doc.file_name,
        mime_type:   doc.mime_type,
        raw_content: doc.raw_content,
        // No `mode` field — see the matching note in saveDocumentAsync: the
        // real Supabase table has no `mode` column, `mode` is local-only.
        team_id:     doc.team_id,
        // doc.pinned is local SQLite's INTEGER 0/1; Supabase's `pinned` is a
        // real BOOLEAN column — send an actual JS boolean (same idea as
        // `deleted: true` elsewhere) rather than relying on Postgres/
        // PostgREST to coerce a bare JSON number into a boolean.
        pinned:      !!doc.pinned,
      }

      const res = await fetch(
        exists ? supabaseUrl(`documents?id=eq.${doc.id}`) : supabaseUrl('documents'),
        {
          method:  exists ? 'PATCH' : 'POST',
          headers: supabaseHeaders(),
          body:    JSON.stringify(payload),
        }
      )

      if (res.ok) {
        getDb().prepare(`UPDATE documents SET synced = 1 WHERE id = ?`).run(doc.id)
        pushedSomething = true
      } else {
        // Previously silent: a failing push just left synced=0 forever,
        // retried every cycle with no clue why. Same reasoning as
        // saveDocumentAsync — the PostgREST response body is the only way
        // to tell an unknown-column error from a NOT NULL violation, etc.
        const errorBody = await res.text().catch(() => '<no se pudo leer el cuerpo de la respuesta>')
        console.error('[sync push error] Supabase rechazó el push', {
          status:  res.status,
          body:    errorBody,
          payload: { ...payload, raw_content: payload.raw_content ? `<${payload.raw_content.length} chars omitidos>` : null },
        })
      }
    } catch (err) {
      console.error('[sync push error]', err)
      break
    }
  }

  // 2. Push pending deletes (synced = -1) as tombstones, not a hard DELETE —
  // see the comment on deleteDocumentAsync for why.
  const pendingDeletes = getDb().prepare(`SELECT * FROM documents WHERE synced = -1`).all() as any[]
  for (const row of pendingDeletes) {
    try {
      const res = await fetch(supabaseUrl(`documents?id=eq.${row.id}&team_id=eq.${encodeURIComponent(_teamId!)}`), {
        method:  'PATCH',
        headers: supabaseHeaders(),
        body:    JSON.stringify({ deleted: true }),
      })
      if (res.ok || res.status === 404) {
        getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(row.id)
        deleteLocalFileIfOwned(row.file_url ?? null)
        pushedSomething = true
      } else {
        const errorBody = await res.text().catch(() => '<no se pudo leer el cuerpo de la respuesta>')
        console.error('[sync delete error] Supabase rechazó el tombstone', { status: res.status, body: errorBody, id: row.id })
      }
    } catch (err) {
      console.error('[sync delete error]', err)
      break
    }
  }

  if (pushedSomething) invalidateCache()
}

const LAST_PULL_KEY  = 'last_pull'
const EPOCH          = '1970-01-01T00:00:00Z'
const PULL_PAGE_SIZE = 200
const PULL_MAX_PAGES = 25 // safety cap so a huge first sync can't loop forever

/**
 * Incremental pull keyed off `updated_at`, not a flat "last 100 rows" — the
 * old version meant a team with more than 100 documents could never see
 * anything older than that. First run (no watermark yet) walks every row,
 * paginated; later runs only ask for what changed since the last one.
 *
 * Remote tombstones (`deleted = true`) delete the local row outright, even
 * if it has unsynced local edits (synced = 0/-1) — simple last-writer-wins
 * rule for deletes: the remote delete always wins. Non-deleted rows still
 * only overwrite a local copy that has nothing pending of its own
 * (`!local || local.synced === 1`), same as before.
 */
export async function pullSupabaseChanges(): Promise<void> {
  if (getMode() !== 'team') return
  try {
    const lastPull = getMeta(LAST_PULL_KEY) ?? EPOCH
    let maxUpdatedAt = lastPull
    let offset  = 0
    let page    = 0
    let sawRows = false

    while (page < PULL_MAX_PAGES) {
      const res = await fetch(
        supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&updated_at=gte.${encodeURIComponent(lastPull)}&order=updated_at.asc&limit=${PULL_PAGE_SIZE}&offset=${offset}`),
        { headers: supabaseHeaders() }
      )
      // Bail without touching the watermark — next run just retries the
      // same range instead of silently skipping whatever this page held.
      if (!res.ok) return

      const rows = await res.json() as any[]
      if (rows.length === 0) break
      sawRows = true

      getDb().transaction(() => {
        for (const row of rows) {
          if (typeof row.updated_at === 'string' && row.updated_at > maxUpdatedAt) {
            maxUpdatedAt = row.updated_at
          }

          if (row.deleted === true) {
            getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(row.id)
            continue
          }

          const local = getDb().prepare(`SELECT synced FROM documents WHERE id = ?`).get(row.id) as { synced: number } | undefined
          if (!local || local.synced === 1) {
            const doc = rowToDocFromSupabase(row)

            getDb().prepare(`
              INSERT INTO documents
                (id, created_at, client_name, doc_type, description, tags, file_url, file_name, mime_type, raw_content, mode, team_id, pinned, synced)
              VALUES
                (@id, @created_at, @client_name, @doc_type, @description, @tags, @file_url, @file_name, @mime_type, @raw_content, @mode, @team_id, @pinned, 1)
              ON CONFLICT(id) DO UPDATE SET
                client_name = excluded.client_name,
                doc_type    = excluded.doc_type,
                description = excluded.description,
                tags        = excluded.tags,
                file_name   = excluded.file_name,
                pinned      = excluded.pinned,
                synced      = 1
                -- file_url is deliberately NOT updated here: remote rows
                -- always carry file_url = null (see saveDocumentAsync /
                -- triggerBackgroundSync), so overwriting it would wipe out a
                -- local file:// link that only this machine's disk has.
            `).run({
              id:          doc.id,
              created_at:  doc.created_at,
              client_name: doc.client_name,
              doc_type:    doc.doc_type,
              description: doc.description,
              tags:        JSON.stringify(doc.tags),
              file_url:    doc.file_url,
              file_name:   doc.file_name,
              mime_type:   doc.mime_type,
              raw_content: doc.raw_content,
              mode:        doc.mode,
              team_id:     doc.team_id,
              pinned:      doc.pinned,
            })
          }
        }
      })()

      if (rows.length < PULL_PAGE_SIZE) break
      offset += PULL_PAGE_SIZE
      page++
    }

    if (sawRows) {
      setMeta(LAST_PULL_KEY, maxUpdatedAt)
      invalidateCache()
    }
  } catch (err) {
    console.error('[pull changes error]', err)
  }
}
