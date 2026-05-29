'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import type { DocumentMetadata } from '@/lib/openai'

interface MetadataCardProps {
  metadata:  DocumentMetadata
  onConfirm?: () => void
  onEdit?:    (updated: DocumentMetadata) => void
}

const DOC_TYPES = [
  'Google Doc', 'Google Sheet', 'Google Slides', 'Google Drive',
  'Dashboard / Reporte', 'Looker Studio', 'Propuesta Comercial',
  'Presupuesto', 'Contrato', 'Brief de Campaña', 'Calendario de Contenido',
  'Creativo / Imagen', 'Creativo / Video', 'Factura', 'Presentación',
  'Métricas / Resultados', 'Informe Mensual', 'Plan de Medios',
]

const TYPE_EMOJI: Record<string, string> = {
  'Google Doc': '📄', 'Google Sheet': '📊', 'Google Slides': '📑',
  'Google Drive': '📁', 'Dashboard / Reporte': '📈', 'Looker Studio': '🔍',
  'Propuesta Comercial': '💼', 'Presupuesto': '💰', 'Contrato': '📝',
  'Brief de Campaña': '🎯', 'Calendario de Contenido': '🗓️',
  'Creativo / Imagen': '🖼️', 'Creativo / Video': '🎬',
  'Factura': '🧾', 'Presentación': '🎤', 'Métricas / Resultados': '📊',
  'Informe Mensual': '📋', 'Plan de Medios': '📅',
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background:    'rgba(15,15,20,0.9)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border:        '1px solid rgba(120,80,255,0.25)',
  borderRadius:  12,
  boxShadow:     '0 8px 32px rgba(0,0,0,0.4)',
  overflow:      'hidden',
  width:         '100%',
  maxWidth:      320,
}

const LABEL_STYLE: React.CSSProperties = {
  display:       'block',
  fontSize:      10,
  fontWeight:    500,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color:         'rgba(255,255,255,0.38)',
  marginBottom:  2,
}

const VALUE_STYLE: React.CSSProperties = {
  fontSize:  13,
  color:     'rgba(255,255,255,0.9)',
  lineHeight: 1.4,
}

const INPUT_STYLE: React.CSSProperties = {
  width:        '100%',
  background:   'rgba(255,255,255,0.06)',
  border:       '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding:      '6px 10px',
  fontSize:     12.5,
  color:        'white',
  outline:      'none',
  fontFamily:   'inherit',
  transition:   'border-color 0.15s',
}

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: 'pointer',
  WebkitAppRegion: 'no-drag',
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 0' }} />
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '9px 14px' }}>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={VALUE_STYLE}>{value || '—'}</span>
    </div>
  )
}

// ── Hover-tracked button ──────────────────────────────────────────────────────

function HoverButton({
  onClick,
  style,
  children,
}: {
  onClick?: () => void
  style: React.CSSProperties
  children: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        transition: 'all 150ms ease',
        filter:    hovered ? 'brightness(1.15)' : 'brightness(1)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
      }}
    >
      {children}
    </motion.button>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MetadataCard({ metadata, onConfirm, onEdit }: MetadataCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft]         = useState<DocumentMetadata>(metadata)

  function applyEdit() {
    setIsEditing(false)
    onEdit?.(draft)
  }

  const emoji = TYPE_EMOJI[draft.doc_type] ?? '📄'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={CARD}
    >
      {/* Header label */}
      <div style={{
        padding:      '8px 14px',
        background:   'rgba(83,74,183,0.22)',
        borderBottom: '1px solid rgba(83,74,183,0.2)',
        fontSize:     10,
        fontWeight:   500,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        color:        'rgba(175,169,236,0.8)',
      }}>
        {emoji} Metadatos detectados
      </div>

      {/* Fields */}
      {isEditing ? (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <span style={LABEL_STYLE}>Cliente</span>
            <input
              style={INPUT_STYLE}
              value={draft.client_name ?? ''}
              onChange={(e) => setDraft({ ...draft, client_name: e.target.value || null })}
              placeholder="Nombre del cliente"
            />
          </div>
          <div>
            <span style={LABEL_STYLE}>Tipo</span>
            <select
              style={SELECT_STYLE}
              value={draft.doc_type}
              onChange={(e) => setDraft({ ...draft, doc_type: e.target.value })}
            >
              {DOC_TYPES.map((t) => <option key={t} value={t} style={{ background: '#1A1A24' }}>{t}</option>)}
            </select>
          </div>
          <div>
            <span style={LABEL_STYLE}>Nombre del archivo</span>
            <input
              style={INPUT_STYLE}
              value={draft.file_name}
              onChange={(e) => setDraft({ ...draft, file_name: e.target.value })}
            />
          </div>
          <div>
            <span style={LABEL_STYLE}>Tags (separados por coma)</span>
            <input
              style={INPUT_STYLE}
              value={draft.tags?.join(', ') ?? ''}
              onChange={(e) => setDraft({
                ...draft,
                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
              })}
            />
          </div>
        </div>
      ) : (
        <>
          <FieldRow label="Tipo"        value={`${emoji} ${draft.doc_type}`} />
          <Divider />
          <FieldRow label="Cliente"     value={draft.client_name ?? 'Sin cliente'} />
          <Divider />
          <FieldRow label="Archivo"     value={draft.file_name} />
          <Divider />
          <FieldRow label="Descripción" value={draft.description} />
          {draft.tags?.length > 0 && (
            <>
              <Divider />
              <div style={{ padding: '9px 14px' }}>
                <span style={LABEL_STYLE}>Tags</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {draft.tags.map((tag) => (
                    <span key={tag} style={{
                      background:   'rgba(120,80,255,0.2)',
                      color:        '#AFA9EC',
                      fontSize:     11,
                      padding:      '2px 8px',
                      borderRadius: 999,
                      letterSpacing: '0.02em',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Actions */}
      <div style={{
        padding:   '10px 14px',
        display:   'flex',
        gap:       8,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {isEditing ? (
          <>
            <HoverButton
              onClick={applyEdit}
              style={{
                flex: 1, padding: '8px 0',
                background: '#534AB7', color: 'white',
                border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit',
                WebkitAppRegion: 'no-drag',
              }}
            >
              Aplicar
            </HoverButton>
            <HoverButton
              onClick={() => setIsEditing(false)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 10,
                fontSize: 13, cursor: 'pointer',
                fontFamily: 'inherit',
                WebkitAppRegion: 'no-drag',
              }}
            >
              Cancelar
            </HoverButton>
          </>
        ) : (
          <>
            <HoverButton
              onClick={onConfirm}
              style={{
                flex: 1, padding: '8px 0',
                background: '#1D9E75', color: 'white',
                border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit',
                WebkitAppRegion: 'no-drag',
              }}
            >
              Guardar ✓
            </HoverButton>
            <HoverButton
              onClick={() => setIsEditing(true)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 10,
                fontSize: 13, cursor: 'pointer',
                fontFamily: 'inherit',
                WebkitAppRegion: 'no-drag',
              }}
            >
              Editar
            </HoverButton>
          </>
        )}
      </div>
    </motion.div>
  )
}
