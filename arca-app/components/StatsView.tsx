'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface StatsData {
  total: number
  byClient: { client_name: string; count: number }[]
  byType:   { doc_type: string; count: number }[]
}

interface StatsViewProps {
  isOpen: boolean
  onClose: () => void
  onFilterLibrary: (clientFilter?: string, docTypeFilter?: string) => void
}

export function StatsView({ isOpen, onClose, onFilterLibrary }: StatsViewProps) {
  const [stats, setStats]     = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setError(null)
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => {
        // An {error} payload stored as stats would crash the render on
        // stats.byClient.length — validate the shape first.
        if (data && Array.isArray(data.byClient) && Array.isArray(data.byType)) {
          setStats(data as StatsData)
        } else {
          setError(data?.error ?? 'Error cargando estadísticas')
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Error cargando estadísticas'))
      .finally(() => setLoading(false))
  }, [isOpen])

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="stats-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position:            'fixed',
            inset:               0,
            zIndex:              9999,
            background:          'rgba(8,8,14,0.92)',
            backdropFilter:      'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            display:             'flex',
            flexDirection:       'column',
            fontFamily:          'inherit',
          }}
        >
          {/* Inner panel */}
          <motion.div
            key="stats-panel"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              display:             'flex',
              flexDirection:       'column',
              flex:                1,
              background:          'rgba(15,15,22,0.88)',
              backdropFilter:      'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border:              '1px solid rgba(255,255,255,0.08)',
              boxShadow:           '0 25px 60px rgba(0,0,0,0.6)',
              overflow:            'hidden',
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
                  Estadísticas
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Resumen de la biblioteca
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

            {/* Content */}
            <div style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '24px',
              display:       'flex',
              flexDirection: 'column',
              gap:           28,
            }}>
              {loading && (
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 40 }}
                >
                  Cargando estadísticas…
                </motion.div>
              )}

              {error && (
                <p style={{ color: 'rgba(255,100,100,0.8)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  {error}
                </p>
              )}

              {stats && !loading && (
                <>
                  {/* Big number */}
                  <div style={{
                    background:   'rgba(83,74,183,0.15)',
                    border:       '1px solid rgba(83,74,183,0.3)',
                    borderRadius: 16,
                    padding:      '24px',
                    textAlign:    'center',
                  }}>
                    <div style={{ fontSize: 52, fontWeight: 700, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.03em', lineHeight: 1 }}>
                      {stats.total}
                    </div>
                    <div style={{ fontSize: 14, color: 'rgba(175,169,236,0.8)', marginTop: 6 }}>
                      link{stats.total !== 1 ? 's' : ''} guardado{stats.total !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* By client */}
                  {stats.byClient.length > 0 && (
                    <section>
                      <p style={{
                        color:         'rgba(255,255,255,0.4)',
                        fontSize:      10,
                        fontWeight:    600,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                        marginBottom:  10,
                        margin:        '0 0 10px',
                      }}>
                        Por cliente
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {stats.byClient.map((item) => {
                          const rowKey = `client-${item.client_name}`
                          const isHovered = hoveredRow === rowKey
                          return (
                            <motion.button
                              key={item.client_name}
                              onClick={() => onFilterLibrary(item.client_name, undefined)}
                              whileTap={{ scale: 0.98 }}
                              onMouseEnter={() => setHoveredRow(rowKey)}
                              onMouseLeave={() => setHoveredRow(null)}
                              style={{
                                display:        'flex',
                                alignItems:     'center',
                                justifyContent: 'space-between',
                                padding:        '9px 12px',
                                borderRadius:   6,
                                cursor:         'pointer',
                                background:     isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
                                border:         '1px solid rgba(255,255,255,0.06)',
                                transition:     'all 200ms ease',
                                fontFamily:     'inherit',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{
                                  width:      28,
                                  height:     28,
                                  borderRadius: '50%',
                                  background: 'rgba(83,74,183,0.3)',
                                  display:    'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize:   11,
                                  fontWeight: 700,
                                  color:      '#AFA9EC',
                                  flexShrink: 0,
                                }}>
                                  {item.client_name.charAt(0).toUpperCase()}
                                </span>
                                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
                                  {item.client_name}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  fontSize:     13,
                                  fontWeight:   600,
                                  color:        '#AFA9EC',
                                  background:   'rgba(120,80,255,0.25)',
                                  borderRadius: 999,
                                  padding:      '2px 8px',
                                }}>
                                  {item.count}
                                </span>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>↗</span>
                              </div>
                            </motion.button>
                          )
                        })}
                      </div>
                    </section>
                  )}

                  {/* By type */}
                  {stats.byType.length > 0 && (
                    <section>
                      <p style={{
                        color:         'rgba(255,255,255,0.4)',
                        fontSize:      10,
                        fontWeight:    600,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                        margin:        '0 0 10px',
                      }}>
                        Por tipo
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {stats.byType.map((item) => {
                          const rowKey = `type-${item.doc_type}`
                          const isHovered = hoveredRow === rowKey
                          return (
                            <motion.button
                              key={item.doc_type}
                              onClick={() => onFilterLibrary(undefined, item.doc_type)}
                              whileTap={{ scale: 0.98 }}
                              onMouseEnter={() => setHoveredRow(rowKey)}
                              onMouseLeave={() => setHoveredRow(null)}
                              style={{
                                display:        'flex',
                                alignItems:     'center',
                                justifyContent: 'space-between',
                                padding:        '9px 12px',
                                borderRadius:   6,
                                cursor:         'pointer',
                                background:     isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
                                border:         '1px solid rgba(255,255,255,0.06)',
                                transition:     'all 200ms ease',
                                fontFamily:     'inherit',
                              }}
                            >
                              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                                {item.doc_type}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  fontSize:     13,
                                  fontWeight:   600,
                                  color:        '#AFA9EC',
                                  background:   'rgba(120,80,255,0.25)',
                                  borderRadius: 999,
                                  padding:      '2px 8px',
                                }}>
                                  {item.count}
                                </span>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>↗</span>
                              </div>
                            </motion.button>
                          )
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
