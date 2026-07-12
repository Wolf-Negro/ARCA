'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Message } from './Message'
import { useChat } from '@/hooks/useChat'
import { useTheme, THEMES, type ThemeName } from '@/hooks/useTheme'

// ── Style constants ───────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  position:        'fixed',
  bottom:          92,
  left:            0,
  right:           0,
  width:           '100%',
  height:          480,
  display:         'flex',
  flexDirection:   'column',
  borderRadius:    20,
  overflow:        'hidden',
  zIndex:          9998,
  background:      'rgba(15,15,20,0.85)',
  backdropFilter:  'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border:          '1px solid rgba(120,80,255,0.3)',
  boxShadow:       '0 25px 60px rgba(0,0,0,0.6), inset 0 0 40px rgba(100,80,255,0.08)',
  WebkitAppRegion: 'no-drag',
}

const HEADER: React.CSSProperties = {
  flexShrink:          0,
  display:             'flex',
  alignItems:          'center',
  gap:                 8,
  padding:             '14px 16px',
  background:          'rgba(83,74,183,0.55)',
  backdropFilter:      'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderBottom:        '1px solid rgba(255,255,255,0.07)',
  WebkitAppRegion:     'drag',
}

const MESSAGES_AREA: React.CSSProperties = {
  flex:           1,
  overflowY:      'auto',
  overflowX:      'hidden',
  padding:        '16px',
  display:        'flex',
  flexDirection:  'column',
  minHeight:      0,
  scrollBehavior: 'smooth',
  width:          '100%',
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(255,255,255,0.1) transparent',
}

const INPUT_AREA_BASE: React.CSSProperties = {
  flexShrink:   0,
  display:      'flex',
  flexDirection: 'column',
  padding:      '10px 14px 12px',
  borderTop:    '1px solid rgba(255,255,255,0.06)',
  borderRadius: '0 0 20px 20px',
  width:        '100%',
  background:   'rgba(255,255,255,0.04)',
}

const INPUT_ROW: React.CSSProperties = {
  display:     'flex',
  alignItems:  'center',
  gap:         8,
  width:       '100%',
}

function inputBoxStyle(focused: boolean): React.CSSProperties {
  return {
    flex:         1,
    background:   'rgba(255,255,255,0.06)',
    border:       focused
      ? '1px solid rgba(120,80,255,0.6)'
      : '1px solid rgba(255,255,255,0.1)',
    boxShadow:    focused ? '0 0 0 3px rgba(120,80,255,0.12)' : 'none',
    borderRadius: 10,
    padding:      '8px 12px',
    display:      'flex',
    alignItems:   'center',
    transition:   'border 150ms ease, box-shadow 150ms ease',
  }
}

const INPUT: React.CSSProperties = {
  flex:       1,
  background: 'transparent',
  border:     'none',
  outline:    'none',
  color:      'white',
  fontSize:   13.5,
  fontFamily: 'inherit',
  lineHeight: 1.5,
  caretColor: '#7850ff',
  WebkitAppRegion: 'no-drag',
  width:      '100%',
}

function iconBtn(active = false, hovered = false): React.CSSProperties {
  return {
    flexShrink:     0,
    width:          32,
    height:         32,
    borderRadius:   '50%',
    border:         'none',
    outline:        'none',
    background:     active
      ? (hovered ? 'rgba(120,80,255,0.9)' : '#534AB7')
      : (hovered ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)'),
    color:          'white',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    cursor:         'pointer',
    padding:        0,
    transition:     'all 150ms ease',
    WebkitAppRegion: 'no-drag',
  }
}

function sendBtnStyle(hovered: boolean, isSuccess: boolean): React.CSSProperties {
  if (isSuccess) {
    return {
      ...iconBtn(true, false),
      background: 'rgba(80,220,120,0.3)',
      boxShadow:  '0 0 0 3px rgba(80,220,120,0.4)',
      transition: 'all 150ms ease',
    }
  }
  return {
    ...iconBtn(true, hovered),
    transition: 'all 150ms ease',
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function AttachIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme()
  const [docCount, setDocCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countOnly: true }),
    })
      .then((r) => r.json())
      .then((d) => setDocCount(d.count ?? 0))
      .catch(() => {})
  }, [])

  const themeOrder: ThemeName[] = ['purple', 'matrix', 'cyber', 'ember']

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{    opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '16px',
        display:    'flex',
        flexDirection: 'column',
        gap:        20,
        minHeight:  0,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 500 }}>
          Configuración
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.6)',
            fontSize: 12,
            padding: '3px 10px',
            cursor: 'pointer',
          }}
        >
          ← Volver
        </button>
      </div>

      {/* Theme selector */}
      <section>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Tema de color
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {themeOrder.map((name) => {
            const t       = THEMES[name]
            const active  = theme.name === name
            return (
              <motion.button
                key={name}
                onClick={() => setTheme(name)}
                whileTap={{ scale: 0.96 }}
                style={{
                  background:   active ? `rgba(${t.color.join(',')},0.2)` : 'rgba(255,255,255,0.05)',
                  border:       `1px solid ${active ? t.hex : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 10,
                  padding:      '10px 12px',
                  cursor:       'pointer',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          8,
                  transition:   'border-color 0.2s, background 0.2s',
                }}
              >
                <span style={{
                  width:  14,
                  height: 14,
                  borderRadius: '50%',
                  background:  t.hex,
                  flexShrink:  0,
                  boxShadow:   active ? `0 0 8px ${t.hex}` : 'none',
                }} />
                <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
                  {t.label}
                </span>
              </motion.button>
            )
          })}
        </div>
      </section>

      {/* Shortcuts */}
      <section>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Atajos de teclado
        </p>
        {[
          ['Ctrl+Space', 'Mostrar / Ocultar'],
        ].map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{label}</span>
            <code style={{
              background:   'rgba(255,255,255,0.08)',
              border:       '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              padding:      '2px 8px',
              fontSize:     11,
              color:        'rgba(255,255,255,0.7)',
              fontFamily:   'monospace',
            }}>
              {key}
            </code>
          </div>
        ))}
      </section>

      {/* Info */}
      <section>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
          Información
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row label="Versión" value="1.0.0" />
          <Row label="Documentos guardados" value={docCount !== null ? String(docCount) : '...'} />
        </div>
      </section>
    </motion.div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

// ── ChatPanel component ────────────────────────────────────────────────────────

interface ChatPanelProps {
  isOpen:              boolean
  pendingDropFile?:    File | null
  onDropFileConsumed?: () => void
  onDocSaved?:         () => void
  onProcessingChange?: (isProcessing: boolean) => void
  onShowLibrary?:      (clientFilter?: string, docTypeFilter?: string) => void
  onShowStats?:        () => void
  onClose?:            () => void
}

export function ChatPanel({
  isOpen,
  pendingDropFile,
  onDropFileConsumed,
  onDocSaved,
  onProcessingChange,
  onShowLibrary,
  onShowStats,
  onClose,
}: ChatPanelProps) {
  const [inputValue,    setInputValue]    = useState('')
  const [showSettings,  setShowSettings]  = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [sendHovered,   setSendHovered]   = useState(false)
  const [attachHovered, setAttachHovered] = useState(false)
  const [isSaveSuccess, setIsSaveSuccess] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)

  const placeholders = ['Guarda un link...', '¿Qué buscamos?', 'Pega un link o escribe...']

  // Use a ref so useChat can call the latest version without stale closure
  const docSavedRef = useRef<() => void>()
  docSavedRef.current = () => {
    onDocSaved?.()
    setIsSaveSuccess(true)
    setInputValue('')
    setTimeout(() => setIsSaveSuccess(false), 800)
  }

  const { messages, isProcessing, sendMessage, handleFile, confirmSave, navigateHistory } = useChat({
    onDocSaved:        () => docSavedRef.current?.(),
    onProcessingChange,
    onShowLibrary,
    onShowStats,
  })

  // Notify parent whenever isProcessing changes (drives orb state)
  useEffect(() => {
    onProcessingChange?.(isProcessing)
  }, [isProcessing]) // eslint-disable-line

  // Auto-scroll. Also depends on `isOpen`: the messages list below is
  // unmounted while the panel is closed (see the `{isOpen && (...)}` guard
  // further down), so every reopen mounts a fresh scroll container starting
  // at the top — without `isOpen` here, this effect only re-fires when
  // `messages` itself changes, which it doesn't just from reopening.
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  // Focus on open (60ms delay as specified)
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 60)
  }, [isOpen])

  // Re-focus after processing completes
  useEffect(() => {
    if (!isProcessing) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isProcessing])

  // Escape key closes panel
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Handle dropped file
  useEffect(() => {
    if (pendingDropFile && isOpen) {
      handleFile(pendingDropFile)
      onDropFileConsumed?.()
    }
  }, [pendingDropFile, isOpen]) // eslint-disable-line

  // Placeholder cycling
  useEffect(() => {
    if (inputValue || isInputFocused) return
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % placeholders.length), 4000)
    return () => clearInterval(id)
  }, [inputValue, isInputFocused]) // eslint-disable-line

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const text = inputValue.trim()
    if (!text || isProcessing) return
    setInputValue('')
    sendMessage(text)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault()
      const msg = navigateHistory('up')
      setInputValue(msg)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const msg = navigateHistory('down')
      setInputValue(msg)
      return
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const hasText = inputValue.trim().length > 0

  // URL inline preview
  const urlMatch = /^https?:\/\/([^/\s]+)/i.exec(inputValue.trim())
  const urlDomain = urlMatch ? urlMatch[1] : null

  const currentPlaceholder = (inputValue || isInputFocused)
    ? 'Escribe o pega un link...'
    : placeholders[placeholderIdx]

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="chat-panel"
          style={{ ...PANEL, transformOrigin: 'bottom center' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{    opacity: 0, y: 8, transition: { duration: 0.12, ease: 'easeIn' } }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div style={HEADER}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(255,255,255,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </div>

            <span style={{ color: 'white', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>
              ARCA
            </span>

            <motion.span
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ width: 6, height: 6, borderRadius: '50%', background: '#1D9E75', marginLeft: 2 }}
            />

            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginLeft: 'auto' }}>
              {isProcessing ? 'procesando…' : ''}
            </span>

            {/* Settings button */}
            <motion.button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              whileTap={{ scale: 0.88 }}
              style={{
                ...iconBtn(showSettings),
                width:  26,
                height: 26,
                WebkitAppRegion: 'no-drag',
              }}
              aria-label="Configuración"
            >
              <GearIcon />
            </motion.button>
          </div>

          {/* ── Body: messages or settings ──────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {showSettings ? (
              <SettingsPanel key="settings" onClose={() => setShowSettings(false)} />
            ) : (
              <motion.div
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{    opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={MESSAGES_AREA}
              >
                {messages.map((msg) => (
                  <Message key={msg.id} message={msg} onConfirmSave={confirmSave} />
                ))}
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Input area ──────────────────────────────────────────────────── */}
          {!showSettings && (
            <form onSubmit={submit} style={INPUT_AREA_BASE}>
              {/* URL preview bar */}
              {urlDomain && (
                <div style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  background:   'rgba(120,80,255,0.15)',
                  border:       '1px solid rgba(120,80,255,0.3)',
                  borderRadius: 6,
                  padding:      '4px 10px',
                  fontSize:     12,
                  color:        'rgba(255,255,255,0.7)',
                  marginBottom: 6,
                }}>
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${urlDomain}&sz=16`}
                    width={16}
                    height={16}
                    alt=""
                    style={{ borderRadius: 2 }}
                  />
                  <span>{urlDomain}</span>
                  <span style={{ color: 'rgba(120,80,255,0.8)', marginLeft: 2 }}>· Link detectado</span>
                </div>
              )}

              <div style={INPUT_ROW}>
                <label
                  style={iconBtn(false, attachHovered)}
                  onMouseEnter={() => setAttachHovered(true)}
                  onMouseLeave={() => setAttachHovered(false)}
                >
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={onFileInput}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                  />
                  <AttachIcon />
                </label>

                <div style={inputBoxStyle(isInputFocused)}>
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={onKey}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    placeholder={currentPlaceholder}
                    style={INPUT}
                    disabled={isProcessing}
                  />
                </div>

                <AnimatePresence>
                  {hasText && (
                    <motion.button
                      key="send"
                      type="submit"
                      disabled={isProcessing}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1,   opacity: 1 }}
                      exit={{    scale: 0.7, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      style={sendBtnStyle(sendHovered, isSaveSuccess)}
                      onMouseEnter={() => setSendHovered(true)}
                      onMouseLeave={() => setSendHovered(false)}
                      whileTap={{ scale: 0.88 }}
                    >
                      {isSaveSuccess ? '✓' : <SendIcon />}
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </form>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
