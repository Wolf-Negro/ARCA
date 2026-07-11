import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DocumentMetadata } from './metadata'
import { runBackup } from './backup'

// ─── Team mode config (set by /api/init-team) ─────────────────────────────────

let _supabaseUrl: string | null = null
let _supabaseKey: string | null = null
let _teamId:      string | null = null

export function setTeamConfig(supabaseUrl: string, supabaseKey: string, teamId: string): void {
  _supabaseUrl = supabaseUrl
  _supabaseKey = supabaseKey
  _teamId      = teamId
}

export function getMode(): 'personal' | 'team' {
  return (_supabaseUrl && _supabaseKey && _teamId) ? 'team' : 'personal'
}

function supabaseHeaders() {
  return {
    'apikey':        _supabaseKey!,
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
    mode:        row.mode ?? 'team',
    team_id:     row.team_id ?? null,
    pinned:      row.pinned ?? 0,
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

const DB_PATH = resolve(process.env.ARCA_DB_PATH ?? './arca-data/arca.db')

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
  `)

  // Safe migrations for existing databases
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN pinned INTEGER DEFAULT 0`)
  } catch (err) {}
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN synced INTEGER DEFAULT 1`)
  } catch (err) {}

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
    stmtDeleteById.run(id)
    invalidateCache()
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
    file_url:    fileUrl    ?? null,
    file_name:   metadata.file_name,
    mime_type:   mimeType   ?? null,
    raw_content: rawContent ?? null,
    mode:        'team',
    team_id:     _teamId,
  }
  const res = await fetch(supabaseUrl('documents'), {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(doc),
  })
  if (!res.ok) throw new Error(`Supabase insert failed: ${res.status}`)
  const rows = await res.json()
  return rowToDocFromSupabase(Array.isArray(rows) ? rows[0] : rows)
}

export async function findDocumentByUrlAsync(url: string): Promise<Document | null> {
  const normalized = normalizeUrl(url)
  const candidates = [url, normalized].filter((v, i, a) => a.indexOf(v) === i)
  for (const candidate of candidates) {
    const res = await fetch(
      supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&file_url=eq.${encodeURIComponent(candidate)}&limit=1`),
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
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&order=created_at.desc`
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
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&order=created_at.desc&limit=${limit}`
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
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&created_at=gte.${from.toISOString()}&created_at=lt.${to.toISOString()}&order=created_at.desc`
  if (clientFilter) path += `&client_name=ilike.*${encodeURIComponent(clientFilter)}*`
  const res = await fetch(supabaseUrl(path), { headers: supabaseHeaders() })
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map(rowToDocFromSupabase)
}

export async function countDocumentsAsync(clientFilter?: string): Promise<number> {
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&select=id`
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
  let path = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (clientFilter)  path += `&client_name=eq.${encodeURIComponent(clientFilter)}`
  if (docTypeFilter) path += `&doc_type=ilike.*${encodeURIComponent(docTypeFilter)}*`
  if (search) {
    const q = encodeURIComponent(`*${search}*`)
    path += `&or=(file_name.ilike.${q},description.ilike.${q})`
  }

  // Get total count separately
  let totalPath = `documents?team_id=eq.${encodeURIComponent(_teamId!)}&select=id`
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
  await fetch(supabaseUrl(`documents?id=eq.${id}&team_id=eq.${encodeURIComponent(_teamId!)}`), {
    method: 'DELETE',
    headers: supabaseHeaders(),
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
  const res = await fetch(supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&select=client_name,doc_type`), { headers: supabaseHeaders() })
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
        file_url:    doc.file_url,
        file_name:   doc.file_name,
        mime_type:   doc.mime_type,
        raw_content: doc.raw_content,
        mode:        doc.mode,
        team_id:     doc.team_id,
        pinned:      doc.pinned,
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
      }
    } catch (err) {
      console.error('[sync push error]', err)
      break
    }
  }

  // 2. Push pending deletes (synced = -1)
  const pendingDeletes = getDb().prepare(`SELECT * FROM documents WHERE synced = -1`).all() as any[]
  for (const row of pendingDeletes) {
    try {
      const res = await fetch(supabaseUrl(`documents?id=eq.${row.id}&team_id=eq.${encodeURIComponent(_teamId!)}`), {
        method:  'DELETE',
        headers: supabaseHeaders(),
      })
      if (res.ok || res.status === 404) {
        getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(row.id)
      }
    } catch (err) {
      console.error('[sync delete error]', err)
      break
    }
  }
}

export async function pullSupabaseChanges(): Promise<void> {
  if (getMode() !== 'team') return
  try {
    const res = await fetch(
      supabaseUrl(`documents?team_id=eq.${encodeURIComponent(_teamId!)}&order=created_at.desc&limit=100`),
      { headers: supabaseHeaders() }
    )
    if (!res.ok) return
    const rows = await res.json() as any[]
    
    getDb().transaction(() => {
      for (const row of rows) {
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
    invalidateCache()
  } catch (err) {
    console.error('[pull changes error]', err)
  }
}
