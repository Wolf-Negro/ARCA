'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import type { ChatMessage } from '@/hooks/useChat'
import { MetadataCard } from './MetadataCard'

// ── Bubble styles ─────────────────────────────────────────────────────────────

const BOT_BUBBLE: React.CSSProperties = {
  maxWidth:   '85%',
  alignSelf:  'flex-start',
  background: 'rgba(255,255,255,0.06)',
  border:     '1px solid rgba(255,255,255,0.06)',
  borderRadius: '4px 16px 16px 16px',
  padding:    '10px 14px',
  fontSize:   13.5,
  lineHeight: 1.6,
  color:      'rgba(255,255,255,0.9)',
}

const USER_BUBBLE: React.CSSProperties = {
  maxWidth:   '75%',
  alignSelf:  'flex-end',
  background: '#534AB7',
  border:     'none',
  borderRadius: '16px 4px 16px 16px',
  padding:    '10px 14px',
  fontSize:   13.5,
  lineHeight: 1.6,
  color:      'white',
}

const TIMESTAMP: React.CSSProperties = {
  fontSize:      10,
  color:         'rgba(255,255,255,0.25)',
  marginTop:     4,
  display:       'block',
  letterSpacing: '0.02em',
}

// ── Loading dots ──────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <span style={{ display: 'flex', gap: 5, alignItems: 'center', height: 20 }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'rgba(255,255,255,0.4)',
            display:    'block',
          }}
          animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ type: 'spring', stiffness: 280, damping: 12, repeat: Infinity, delay: i * 0.13 }}
        />
      ))}
    </span>
  )
}

// ── Result card ───────────────────────────────────────────────────────────────

interface Doc {
  id:          string
  doc_type:    string
  client_name?: string | null
  description?: string
  file_name?:  string
  file_url?:   string | null
  tags?:       string[]
}

const TYPE_EMOJI: Record<string, string> = {
  'Google Doc':           '📄',
  'Google Sheet':         '📊',
  'Google Slides':        '📑',
  'Google Drive':         '📁',
  'Dashboard / Reporte':  '📈',
  'Looker Studio':        '🔍',
  'Propuesta Comercial':  '💼',
  'Presupuesto':          '💰',
  'Contrato':             '📝',
  'Brief de Campaña':     '🎯',
  'Calendario de Contenido': '🗓️',
  'Creativo / Imagen':    '🖼️',
  'Creativo / Video':     '🎬',
  'Factura':              '🧾',
  'Presentación':         '🎤',
  'Métricas / Resultados':'📊',
  'Informe Mensual':      '📋',
  'Plan de Medios':       '📅',
}

// Badge colour per doc type family
function typeBadgeColor(docType: string): string {
  if (/Dashboard|Reporte|Looker|Métricas|Informe/i.test(docType)) return 'rgba(0,148,255,0.22)'
  if (/Propuesta|Presupuesto/i.test(docType)) return 'rgba(29,158,117,0.22)'
  if (/Contrato|Factura/i.test(docType)) return 'rgba(240,192,96,0.22)'
  if (/Creativo|Brief|Calendario|Plan/i.test(docType)) return 'rgba(123,116,224,0.22)'
  if (/Google/i.test(docType)) return 'rgba(66,133,244,0.22)'
  return 'rgba(255,255,255,0.12)'
}

function isSafeUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

async function openUrl(url: string) {
  if (!isSafeUrl(url)) return
  const api = (window as Window & { electronAPI?: { openExternal?: (u: string) => Promise<void> } }).electronAPI
  if (api?.openExternal) await api.openExternal(url)
  else window.open(url, '_blank')
}

async function copyToClipboard(text: string) {
  const api = (window as Window & { electronAPI?: { copyToClipboard?: (t: string) => Promise<void> } }).electronAPI
  if (api?.copyToClipboard) await api.copyToClipboard(text)
  else await navigator.clipboard.writeText(text)
}

function ResultCard({ doc }: { doc: Doc }) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 26 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        border:       '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding:      '10px 12px',
        marginBottom: 6,
        transition:   'all 200ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>
          {TYPE_EMOJI[doc.doc_type] ?? '📄'}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Type badge + client */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{
              background:   typeBadgeColor(doc.doc_type),
              color:        'rgba(255,255,255,0.80)',
              fontSize:     11,
              fontWeight:   500,
              padding:      '2px 8px',
              borderRadius: 999,
              letterSpacing: '0.02em',
            }}>
              {doc.doc_type}
            </span>
            {doc.client_name && (
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, letterSpacing: '0.02em' }}>
                {doc.client_name}
              </span>
            )}
          </div>

          {/* File name */}
          <p style={{
            color:      'rgba(255,255,255,0.88)',
            fontSize:   12.5,
            fontWeight: 500,
            margin:     '0 0 2px',
            lineHeight: 1.35,
            overflow:   'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}>
            {doc.file_name}
          </p>

          {/* Description */}
          {doc.description && (
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, margin: '0 0 5px', lineHeight: 1.4 }}>
              {doc.description}
            </p>
          )}

          {/* Tags */}
          {doc.tags && doc.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {doc.tags.slice(0, 3).map((tag) => (
                <span key={tag} style={{
                  background:    'rgba(120,80,255,0.25)',
                  color:         '#AFA9EC',
                  fontSize:      11,
                  padding:       '2px 8px',
                  borderRadius:  999,
                  letterSpacing: '0.02em',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          {doc.file_url && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => openUrl(doc.file_url!)}
                style={{
                  flex:         1,
                  background:   'rgba(83,74,183,0.30)',
                  border:       '1px solid rgba(83,74,183,0.45)',
                  borderRadius: 8,
                  color:        'rgba(255,255,255,0.88)',
                  fontSize:     11,
                  fontWeight:   500,
                  padding:      '5px 0',
                  cursor:       'pointer',
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                  gap:          4,
                }}
              >
                <span>↗</span> Abrir
              </button>

              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  const btn = e.currentTarget
                  await copyToClipboard(doc.file_url!)
                  if (!btn) return
                  const orig = btn.textContent
                  btn.textContent = '✓ Copiado'
                  setTimeout(() => { btn.textContent = orig ?? '' }, 1800)
                }}
                style={{
                  flex:         1,
                  background:   'rgba(255,255,255,0.07)',
                  border:       '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  color:        'rgba(255,255,255,0.75)',
                  fontSize:     11,
                  fontWeight:   500,
                  padding:      '5px 0',
                  cursor:       'pointer',
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                  gap:          4,
                }}
              >
                ⧉ Copiar link
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Message ───────────────────────────────────────────────────────────────────

interface MessageProps {
  message:        ChatMessage
  onConfirmSave?: () => void
}

export function Message({ message, onConfirmSave }: MessageProps) {
  const isBot     = message.role === 'bot'
  const isLoading = message.type === 'loading'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{
        display:        'flex',
        width:          '100%',
        marginBottom:   8,
        justifyContent: isBot ? 'flex-start' : 'flex-end',
      }}
    >
      {isBot ? (
        <div style={{ maxWidth: '90%' }}>
          {isLoading ? (
            <div style={BOT_BUBBLE}><LoadingDots /></div>
          ) : message.type === 'metadata_card' && message.metadata ? (
            <MetadataCard metadata={message.metadata} onConfirm={onConfirmSave} />
          ) : message.type === 'result_card' && message.results ? (
            <div>
              {message.content && (
                <p style={{ ...TIMESTAMP, color: 'rgba(255,255,255,0.38)', fontSize: 11, marginBottom: 6 }}>
                  {message.content}
                </p>
              )}
              {message.results.map((doc) => <ResultCard key={doc.id} doc={doc} />)}
            </div>
          ) : (
            <div style={BOT_BUBBLE}>
              <span
                style={{ display: 'block' }}
                dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
              />
              <span style={TIMESTAMP}>{fmtTime(message.timestamp)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={USER_BUBBLE}>
          <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{message.content}</span>
          <span style={{ ...TIMESTAMP, textAlign: 'right', color: 'rgba(255,255,255,0.35)' }}>
            {fmtTime(message.timestamp)}
          </span>
        </div>
      )}
    </motion.div>
  )
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatMarkdown(text: string) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(255,255,255,0.95)">$1</strong>')
    .replace(/\n/g, '<br/>')
}
