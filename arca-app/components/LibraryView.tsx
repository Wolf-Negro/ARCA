'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Document } from '@/lib/db'

interface LibraryViewProps {
  isOpen: boolean
  onClose: () => void
  initialClientFilter?: string
  initialDocTypeFilter?: string
}

function getDocEmoji(docType: string): string {
  const t = docType.toLowerCase()
  if (/sheet|dashboard|reporte|looker|métricas|metrica|resultados/.test(t)) return '📊'
  if (/doc|informe|propuesta|contrato|brief/.test(t)) return '📋'
  if (/creativo|imagen|video|slide|presentación/.test(t)) return '🖼️'
  if (/calendario/.test(t)) return '📅'
  if (/presupuesto|factura/.test(t)) return '💰'
  if (/plan de medios|plan/.test(t)) return '📈'
  if (/link/.test(t)) return '🔗'
  return '📄'
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate)
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Inline edit form ──────────────────────────────────────────────────────────

interface EditFormProps {
  doc: Document
  onSave: (updates: Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name'>>) => Promise<void>
  onCancel: () => void
}

function EditForm({ doc, onSave, onCancel }: EditFormProps) {
  const [fileName, setFileName] = useState(doc.file_name)
  const [clientName, setClientName] = useState(doc.client_name ?? '')
  const [docType, setDocType] = useState(doc.doc_type)
  const [description, setDescription] = useState(doc.description)
  const [tagsRaw, setTagsRaw] = useState(doc.tags?.join(', ') ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave({
      file_name: fileName,
      client_name: clientName || null,
      doc_type: docType,
      description,
      tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
    })
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width:        '100%',
    background:   'rgba(255,255,255,0.06)',
    border:       '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding:      '6px 10px',
    fontSize:     12,
    color:        'white',
    outline:      'none',
    fontFamily:   'inherit',
    boxSizing:    'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display:       'block',
    fontSize:      10,
    fontWeight:    500,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.38)',
    marginBottom:  3,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0' }}>
      <div>
        <span style={labelStyle}>Nombre</span>
        <input style={inputStyle} value={fileName} onChange={(e) => setFileName(e.target.value)} />
      </div>
      <div>
        <span style={labelStyle}>Cliente</span>
        <input style={inputStyle} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Sin cliente" />
      </div>
      <div>
        <span style={labelStyle}>Tipo</span>
        <input style={inputStyle} value={docType} onChange={(e) => setDocType(e.target.value)} />
      </div>
      <div>
        <span style={labelStyle}>Descripción</span>
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span style={labelStyle}>Tags (separados por coma)</span>
        <input style={inputStyle} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="tag1, tag2" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding:    '6px 14px',
            background: '#534AB7',
            color:      'white',
            border:     'none',
            borderRadius: 8,
            fontSize:   12,
            fontWeight: 500,
            cursor:     saving ? 'default' : 'pointer',
            fontFamily: 'inherit',
            transition: 'all 150ms ease',
          }}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding:    '6px 14px',
            background: 'transparent',
            color:      'rgba(255,255,255,0.5)',
            border:     '1px solid rgba(255,255,255,0.14)',
            borderRadius: 8,
            fontSize:   12,
            cursor:     'pointer',
            fontFamily: 'inherit',
            transition: 'all 150ms ease',
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Document card ─────────────────────────────────────────────────────────────

interface DocCardProps {
  doc: Document
  onDeleted: (id: string) => void
  onUpdated: (updated: Document) => void
}

function DocCard({ doc, onDeleted, onUpdated }: DocCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing]             = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [copied, setCopied]               = useState(false)
  const [hovered, setHovered]             = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      onDeleted(doc.id)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleEdit(updates: Partial<Pick<Document, 'client_name' | 'doc_type' | 'description' | 'tags' | 'file_name'>>) {
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const updated = await res.json() as Document
    onUpdated(updated)
    setEditing(false)
  }

  async function handleCopy() {
    if (!doc.file_url) return
    try {
      const api = (window as Window & { electronAPI?: { copyToClipboard?: (t: string) => Promise<void> } }).electronAPI
      if (api?.copyToClipboard) {
        await api.copyToClipboard(doc.file_url)
      } else {
        await navigator.clipboard.writeText(doc.file_url)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  function handleOpen() {
    if (!doc.file_url) return
    const api = (window as Window & { electronAPI?: { openExternal?: (u: string) => Promise<void> } }).electronAPI
    if (api?.openExternal) {
      api.openExternal(doc.file_url)
    } else {
      window.open(doc.file_url, '_blank')
    }
  }

  const emoji = getDocEmoji(doc.doc_type)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        border:       '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding:      '12px 14px',
        display:      'flex',
        flexDirection: 'column',
        gap:          6,
        transition:   'all 200ms ease',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.92)', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {doc.file_name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {doc.client_name && (
              <span style={{
                background:   'rgba(60,160,255,0.2)',
                color:        '#AFA9EC',
                fontSize:     11,
                padding:      '2px 8px',
                borderRadius: 999,
                fontWeight:   500,
              }}>
                {doc.client_name}
              </span>
            )}
            <span style={{
              background:   'rgba(120,80,255,0.2)',
              color:        'rgba(255,255,255,0.55)',
              fontSize:     11,
              padding:      '2px 8px',
              borderRadius: 999,
            }}>
              {doc.doc_type}
            </span>
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {formatDate(doc.created_at)}
        </span>
      </div>

      {/* Description */}
      {doc.description && (
        <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.5 }}>
          {doc.description}
        </p>
      )}

      {/* Tags */}
      {doc.tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {doc.tags.map((tag) => (
            <span key={tag} style={{
              background:   'rgba(120,80,255,0.2)',
              color:        'rgba(175,169,236,0.9)',
              fontSize:     11,
              padding:      '2px 8px',
              borderRadius: 999,
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <EditForm
          doc={doc}
          onSave={handleEdit}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Action buttons */}
      {!editing && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {doc.file_url && (
            <button onClick={handleOpen} style={actionBtnStyle('#534AB7', 'white')}>
              Abrir ↗
            </button>
          )}
          {doc.file_url && (
            <button onClick={handleCopy} style={actionBtnStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.7)')}>
              {copied ? '✓ Copiado' : 'Copiar link'}
            </button>
          )}
          <button onClick={() => setEditing(true)} style={actionBtnStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.7)')}>
            Editar
          </button>

          {confirmDelete ? (
            <>
              <span style={{ fontSize: 11, color: 'rgba(255,100,100,0.9)', alignSelf: 'center' }}>¿Eliminar?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={actionBtnStyle('rgba(200,50,50,0.3)', 'rgba(255,120,120,0.9)')}
              >
                {deleting ? '…' : 'Sí'}
              </button>
              <button onClick={() => setConfirmDelete(false)} style={actionBtnStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.7)')}>
                No
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={actionBtnStyle('rgba(200,50,50,0.2)', 'rgba(255,100,100,0.8)')}>
              Eliminar
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

function actionBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding:    '4px 10px',
    background: bg,
    color,
    border:     'none',
    borderRadius: 7,
    fontSize:   11,
    fontWeight: 500,
    cursor:     'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  }
}

// ── LibraryView ───────────────────────────────────────────────────────────────

export function LibraryView({ isOpen, onClose, initialClientFilter, initialDocTypeFilter }: LibraryViewProps) {
  const [docs, setDocs]           = useState<Document[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)

  const [search, setSearch]             = useState('')
  const [clientFilter, setClientFilter] = useState(initialClientFilter ?? '')
  const [docTypeFilter, setDocTypeFilter] = useState(initialDocTypeFilter ?? '')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const page  = 1
  const limit = 50

  // Unique values for dropdowns
  const allClients = Array.from(new Set(docs.map((d) => d.client_name).filter(Boolean) as string[]))
  const allTypes   = Array.from(new Set(docs.map((d) => d.doc_type).filter(Boolean)))

  const fetchDocs = useCallback(async (s: string, cf: string, dt: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (s) params.set('search', s)
      if (cf) params.set('clientFilter', cf)
      if (dt) params.set('docTypeFilter', dt)

      const res  = await fetch(`/api/documents?${params.toString()}`)
      const data = await res.json() as { docs?: Document[]; total?: number; error?: string }
      if (data.error) throw new Error(data.error)
      setDocs(data.docs ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando documentos')
    } finally {
      setLoading(false)
    }
  }, [page, limit])

  // Reset filters when initial props change
  useEffect(() => {
    setClientFilter(initialClientFilter ?? '')
    setDocTypeFilter(initialDocTypeFilter ?? '')
  }, [initialClientFilter, initialDocTypeFilter])

  // Fetch on open or when filters change (debounce search)
  useEffect(() => {
    if (!isOpen) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchDocs(search, clientFilter, docTypeFilter)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isOpen, search, clientFilter, docTypeFilter, fetchDocs])

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function clearFilters() {
    setSearch('')
    setClientFilter('')
    setDocTypeFilter('')
  }

  function handleDeleted(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id))
    setTotal((prev) => prev - 1)
  }

  function handleUpdated(updated: Document) {
    setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d))
  }

  const hasFilters = search || clientFilter || docTypeFilter

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="library-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position:        'fixed',
            inset:           0,
            zIndex:          9999,
            background:      'rgba(8,8,14,0.92)',
            backdropFilter:  'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            display:         'flex',
            flexDirection:   'column',
            fontFamily:      'inherit',
          }}
        >
          {/* Inner panel */}
          <motion.div
            key="library-panel"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{
              display:        'flex',
              flexDirection:  'column',
              flex:           1,
              background:     'rgba(15,15,22,0.88)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border:         '1px solid rgba(255,255,255,0.08)',
              boxShadow:      '0 25px 60px rgba(0,0,0,0.6)',
              overflow:       'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              flexShrink:   0,
              padding:      '20px 24px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background:   'rgba(83,74,183,0.12)',
              display:      'flex',
              alignItems:   'center',
              gap:          12,
            }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.02em' }}>
                  Links guardados
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {loading ? 'Cargando…' : `${total} link${total !== 1 ? 's' : ''} guardado${total !== 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={onClose}
                style={{
                  width:      32,
                  height:     32,
                  borderRadius: '50%',
                  border:     'none',
                  background: 'rgba(255,255,255,0.08)',
                  color:      'rgba(255,255,255,0.7)',
                  fontSize:   16,
                  cursor:     'pointer',
                  display:    'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontFamily: 'inherit',
                }}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* Filters */}
            <div style={{
              flexShrink:   0,
              padding:      '12px 24px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display:      'flex',
              gap:          8,
              flexWrap:     'wrap',
              alignItems:   'center',
            }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Buscar…"
                style={{
                  flex:         '1 1 180px',
                  background:   'rgba(255,255,255,0.06)',
                  border:       searchFocused
                    ? '1px solid rgba(120,80,255,0.6)'
                    : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding:      '7px 12px',
                  fontSize:     12.5,
                  color:        'rgba(255,255,255,0.9)',
                  outline:      'none',
                  fontFamily:   'inherit',
                  boxShadow:    searchFocused
                    ? '0 0 0 3px rgba(120,80,255,0.15)'
                    : 'none',
                  transition:   'border 150ms ease, box-shadow 150ms ease',
                }}
              />
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                style={{
                  flex:         '1 1 140px',
                  background:   'rgba(255,255,255,0.07)',
                  border:       '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding:      '7px 10px',
                  fontSize:     12.5,
                  color:        clientFilter ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                  outline:      'none',
                  fontFamily:   'inherit',
                  cursor:       'pointer',
                }}
              >
                <option value="">Todos los clientes</option>
                {allClients.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                style={{
                  flex:         '1 1 140px',
                  background:   'rgba(255,255,255,0.07)',
                  border:       '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  padding:      '7px 10px',
                  fontSize:     12.5,
                  color:        docTypeFilter ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                  outline:      'none',
                  fontFamily:   'inherit',
                  cursor:       'pointer',
                }}
              >
                <option value="">Todos los tipos</option>
                {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  style={{
                    padding:    '7px 12px',
                    background: 'rgba(255,255,255,0.06)',
                    color:      'rgba(255,255,255,0.55)',
                    border:     '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize:   12,
                    cursor:     'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* Content */}
            <div style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '16px 24px',
              display:       'flex',
              flexDirection: 'column',
              gap:           8,
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            }}>
              {error && (
                <p style={{ color: 'rgba(255,100,100,0.8)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  {error}
                </p>
              )}

              {loading && docs.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 40 }}>
                  <motion.div
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}
                  >
                    Cargando…
                  </motion.div>
                </div>
              )}

              {!loading && !error && docs.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 60 }}>
                  <p style={{ fontSize: 32, margin: '0 0 12px' }}>📭</p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
                    {hasFilters ? 'Sin resultados para ese filtro' : 'No hay links guardados aún'}
                  </p>
                </div>
              )}

              <AnimatePresence>
                {docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    onDeleted={handleDeleted}
                    onUpdated={handleUpdated}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
