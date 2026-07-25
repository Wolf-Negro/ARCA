'use client'

import React, { useState, useEffect, useRef } from 'react'
import type { Document } from '@/lib/db'

interface SpotlightSearchProps {
  isOpen: boolean
  onClose: () => void
}

export function SpotlightSearch({ isOpen, onClose }: SpotlightSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Document[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [isOpen])

  // Search query effect
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      // Clearing the query cancels the pending debounce below — reset the
      // spinner too or it spins forever after a type-then-erase.
      setLoading(false)
      return
    }
    setLoading(true)
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        })
        const data = await res.json()
        setResults(data.results || [])
        setSelectedIndex(0)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => clearTimeout(delayDebounce)
  }, [query])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (results[selectedIndex]) {
          openLink(results[selectedIndex])
        }
      } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (results[selectedIndex]) {
          copyLink(results[selectedIndex])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, results, selectedIndex, onClose])

  async function openLink(doc: Document) {
    if (!doc.file_url) return
    const api = window.electronAPI
    if (api?.openExternal) {
      await api.openExternal(doc.file_url)
    } else {
      window.open(doc.file_url, '_blank')
    }
    onClose()
  }

  async function copyLink(doc: Document) {
    if (!doc.file_url) return
    const api = window.electronAPI
    if (api?.copyToClipboard) {
      await api.copyToClipboard(doc.file_url)
    } else {
      await navigator.clipboard.writeText(doc.file_url)
    }
    // Show a quick visual confirmation inside the item or just close
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '20px',
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: '580px',
          background: 'rgba(15, 15, 20, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(83, 74, 183, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            gap: '12px',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255, 255, 255, 0.4)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar enlaces en ARCA... (Alt+Space para cerrar)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '16px',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {loading && (
            <div
              className="spinner"
              style={{
                width: '16px',
                height: '16px',
                border: '2px solid rgba(255,255,255,0.1)',
                borderTopColor: '#534AB7',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          )}
        </div>

        {/* Results List */}
        {results.length > 0 && (
          <div
            style={{
              maxHeight: '280px',
              overflowY: 'auto',
              padding: '8px 0',
            }}
          >
            {results.map((doc, index) => {
              const isSelected = index === selectedIndex
              return (
                <div
                  key={doc.id}
                  onClick={() => openLink(doc)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px 20px',
                    background: isSelected ? 'rgba(83, 74, 183, 0.25)' : 'transparent',
                    borderLeft: `3px solid ${isSelected ? '#c8bfff' : 'transparent'}`,
                    cursor: 'pointer',
                    gap: '14px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Doc Type Indicator */}
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      color: isSelected ? '#c8bfff' : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    {doc.pinned ? '📌' : '🔗'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '14px',
                          color: isSelected ? '#fff' : 'rgba(255,255,255,0.9)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {doc.file_name}
                      </span>
                      {doc.client_name && (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: '4px',
                            color: 'rgba(255,255,255,0.5)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {doc.client_name}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.4)',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {doc.description || doc.file_url}
                    </div>
                  </div>

                  {/* Actions Hint */}
                  {isSelected && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '10px',
                        color: 'rgba(255,255,255,0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <span>⏎ Abrir</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                      <span>⌘C Copiar</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer Hint */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.35)',
            background: 'rgba(0, 0, 0, 0.1)',
          }}
        >
          <span>Navegar con ↑↓ y Enter</span>
          <span>Esc para salir</span>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
