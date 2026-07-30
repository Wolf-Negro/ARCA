import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { DocumentMetadata } from './types'

// Point ARCA_DB_PATH at a throwaway temp file *before* lib/db.ts is imported,
// since it resolves the DB path once at module-eval time. This keeps every
// test run isolated from the user's real arca-data/arca.db.
const testDir = mkdtempSync(join(tmpdir(), 'arca-db-test-'))
const testDbPath = join(testDir, 'arca-test.db')
process.env.ARCA_DB_PATH = testDbPath

let dbModule: typeof import('./db')

beforeAll(async () => {
  dbModule = await import('./db')
})

afterAll(() => {
  // On Windows the SQLite file (and its WAL/SHM sidecars) may still be
  // memory-mapped by better-sqlite3 for a moment after the last statement
  // runs, which can make an immediate rmSync fail with EPERM/EBUSY. Retry a
  // few times; if cleanup still fails, leave it for the OS temp reaper —
  // this is just a throwaway directory outside the real arca-data.
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // best-effort cleanup only
  }
})

function metadata(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    client_name: 'Cliente Test',
    doc_type:    'Presupuesto',
    description: 'Documento de prueba',
    tags:        ['test'],
    file_name:   'archivo.pdf',
    ...overrides,
  }
}

describe('lib/db (personal mode, local SQLite)', () => {
  it('starts in personal mode when no team config is set', () => {
    expect(dbModule.getMode()).toBe('personal')
  })

  it('creates a document via saveDocument', () => {
    const doc = dbModule.saveDocument(metadata({ file_name: 'creado.pdf' }), 'file:///tmp/creado.pdf', 'application/pdf')

    expect(doc.id).toBeTruthy()
    expect(doc.file_name).toBe('creado.pdf')
    expect(doc.client_name).toBe('Cliente Test')
    expect(doc.mode).toBe('personal')
    expect(doc.synced).toBe(1)
    expect(doc.pinned).toBe(0)
  })

  it('reads a document back by URL', () => {
    const url = 'https://example.com/some-doc'
    const saved = dbModule.saveDocument(metadata({ file_name: 'leido.pdf' }), url)

    const found = dbModule.findDocumentByUrl(url)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(saved.id)
  })

  it('finds a document by search query', () => {
    dbModule.saveDocument(metadata({ file_name: 'buscar-unico-xyz.pdf', client_name: 'Cliente Buscar' }))

    const results = dbModule.searchDocuments('buscar-unico-xyz')
    expect(results.length).toBe(1)
    expect(results[0].file_name).toBe('buscar-unico-xyz.pdf')
  })

  describe('word-by-word search (Organizador-style)', () => {
    beforeAll(() => {
      dbModule.saveDocument(
        metadata({
          file_name:   'Brief campaña verano',
          client_name: 'Pepe Motors',
          description: 'Lineamientos de la campaña',
          tags:        ['Canva', 'Diseño'],
        }),
        'https://www.canva.com/design/DAF-verano-2026',
      )
      dbModule.saveDocument(
        metadata({
          file_name:   'Presupuesto anual',
          client_name: 'Otra Empresa',
          description: 'Números del año',
          tags:        ['Finanzas'],
        }),
        'https://docs.google.com/spreadsheets/d/abc',
        undefined,
        'contiene la palabra factibilidad dentro del contenido extraído',
      )
    })

    it('matches when the query words live in DIFFERENT fields (url + client)', () => {
      const results = dbModule.searchDocuments('canva pepe')
      expect(results.length).toBe(1)
      expect(results[0].file_name).toBe('Brief campaña verano')
    })

    it('matches by a word inside the URL', () => {
      const results = dbModule.searchDocuments('spreadsheets')
      expect(results.some(d => d.file_name === 'Presupuesto anual')).toBe(true)
    })

    it('matches by tag', () => {
      const results = dbModule.searchDocuments('finanzas')
      expect(results.some(d => d.file_name === 'Presupuesto anual')).toBe(true)
    })

    it('matches by extracted raw content', () => {
      const results = dbModule.searchDocuments('factibilidad')
      expect(results.some(d => d.file_name === 'Presupuesto anual')).toBe(true)
    })

    it('is accent-insensitive in both directions', () => {
      expect(dbModule.searchDocuments('campana').some(d => d.file_name === 'Brief campaña verano')).toBe(true)
      expect(dbModule.searchDocuments('diseño').some(d => d.file_name === 'Brief campaña verano')).toBe(true)
      expect(dbModule.searchDocuments('diseno').some(d => d.file_name === 'Brief campaña verano')).toBe(true)
    })

    it('requires EVERY word to appear somewhere (no partial-query noise)', () => {
      expect(dbModule.searchDocuments('canva inexistentexyz').length).toBe(0)
    })

    it('ignores conversational filler words ("link de arca" case from the field)', () => {
      dbModule.saveDocument(
        metadata({ file_name: 'arca silk.vercel.app', client_name: 'ARCA', tags: ['Presentación'] }),
        'https://arca-silk.vercel.app',
      )
      // The exact queries that failed for the user on 2026-07-28:
      expect(dbModule.searchDocuments('arca').some(d => d.file_name === 'arca silk.vercel.app')).toBe(true)
      expect(dbModule.searchDocuments('link de arca').some(d => d.file_name === 'arca silk.vercel.app')).toBe(true)
      expect(dbModule.searchDocuments('dame el link de arca').some(d => d.file_name === 'arca silk.vercel.app')).toBe(true)
      expect(dbModule.searchDocuments('busca los archivos de arca').some(d => d.file_name === 'arca silk.vercel.app')).toBe(true)
    })

    it('still searches literally when the whole query is stopwords', () => {
      // Nothing contains the word "dame" → no results, but no crash either.
      expect(dbModule.searchDocuments('dame').length).toBe(0)
    })

    it('ranks title/client hits above content-only hits', () => {
      dbModule.saveDocument(
        metadata({ file_name: 'Notas varias', client_name: 'Otra Empresa', tags: [] }),
        undefined,
        undefined,
        'menciona a pepe de pasada en el contenido',
      )
      const results = dbModule.searchDocuments('pepe')
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[0].client_name).toBe('Pepe Motors')
    })
  })

  it('updates a document, including pin/unpin via updateDocument', () => {
    const saved = dbModule.saveDocument(metadata({ file_name: 'actualizar.pdf' }))

    const updated = dbModule.updateDocument(saved.id, { description: 'Descripción actualizada', pinned: 1 })
    expect(updated.description).toBe('Descripción actualizada')
    expect(updated.pinned).toBe(1)

    const unpinned = dbModule.updateDocument(saved.id, { pinned: 0 })
    expect(unpinned.pinned).toBe(0)
  })

  it('throws when updating a document that does not exist', () => {
    expect(() => dbModule.updateDocument('non-existent-id', { description: 'x' })).toThrow()
  })

  it('deletes a document in personal mode', () => {
    const saved = dbModule.saveDocument(metadata({ file_name: 'borrar.pdf' }))

    dbModule.deleteDocument(saved.id)

    const all = dbModule.listAllDocuments(1, 100)
    expect(all.docs.find(d => d.id === saved.id)).toBeUndefined()
  })

  it('orders pinned documents first regardless of creation date', () => {
    // Force distinct created_at timestamps — two real-time saves can land in
    // the same millisecond, which makes the DESC ordering non-deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const older = dbModule.saveDocument(metadata({ file_name: 'orden-viejo.pdf', client_name: 'Cliente Orden' }))
    vi.setSystemTime(new Date('2024-01-01T00:00:10.000Z'))
    const newer = dbModule.saveDocument(metadata({ file_name: 'orden-nuevo.pdf', client_name: 'Cliente Orden' }))
    vi.useRealTimers()

    // Sanity: without pinning, newer comes first (created_at DESC).
    let list = dbModule.listRecentDocuments(10, 'Cliente Orden')
    expect(list[0].id).toBe(newer.id)

    // Pin the older one — it should now come first despite being older.
    dbModule.updateDocument(older.id, { pinned: 1 })
    list = dbModule.listRecentDocuments(10, 'Cliente Orden')
    expect(list[0].id).toBe(older.id)
    expect(list[0].pinned).toBe(1)

    // Same check via listAllDocuments, which also sorts pinned-first.
    const page = dbModule.listAllDocuments(1, 100, undefined, 'Cliente Orden')
    expect(page.docs[0].id).toBe(older.id)
  })
})
