'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface ClipboardToastProps {
  url: string | null
  onSave: () => void
  onDismiss: () => void
}

export function ClipboardToast({ url, onSave, onDismiss }: ClipboardToastProps) {
  // Shorten URL for display
  const displayUrl = url
    ? url.length > 48
      ? url.slice(0, 46) + '…'
      : url
    : ''

  // Get favicon favicon domain
  const faviconDomain = url
    ? (() => { try { return new URL(url).hostname } catch { return '' } })()
    : ''

  return (
    <AnimatePresence>
      {url && (
        <motion.div
          key="clipboard-toast"
          initial={{ opacity: 0, y: 20, scale: 0.92 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{    opacity: 0, y: 20, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            width: 340,
            background: 'rgba(10, 10, 16, 0.9)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(0, 210, 255, 0.25)',
            borderRadius: 14,
            boxShadow: '0 20px 40px rgba(0,0,0,0.6), 0 0 20px rgba(0,210,255,0.1)',
            padding: '14px 16px',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            pointerEvents: 'auto',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'rgba(0,210,255,0.12)',
                border: '1px solid rgba(0,210,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              🔗
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,210,255,0.9)', marginBottom: 2 }}>
                Link detectado
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.45)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {faviconDomain}
              </div>
            </div>
            <button
              onClick={onDismiss}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '2px 4px',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* URL Preview */}
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 6,
              padding: '6px 10px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: 'Consolas, Menlo, monospace',
            }}
          >
            {displayUrl}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSave}
              style={{
                flex: 1,
                background: 'rgba(0,210,255,0.15)',
                border: '1px solid rgba(0,210,255,0.3)',
                borderRadius: 8,
                color: 'rgba(0,210,255,0.95)',
                fontSize: 12,
                fontWeight: 600,
                padding: '8px 0',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = 'rgba(0,210,255,0.25)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = 'rgba(0,210,255,0.15)'
              }}
            >
              Guardar en ARCA
            </button>
            <button
              onClick={onDismiss}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12,
                padding: '8px 0',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = 'rgba(255,255,255,0.09)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.background = 'rgba(255,255,255,0.05)'
              }}
            >
              Ignorar
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
