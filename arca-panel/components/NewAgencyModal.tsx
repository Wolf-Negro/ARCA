'use client'

import { useState, useEffect, useRef } from 'react'

interface Props {
  onClose:   () => void
  onCreate:  (agency: { id: string; name: string; code: string; team_id: string; active: boolean; created_at: string }) => void
}

function previewCode(name: string): string {
  const teamId = name.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!teamId) return 'ARCA-...-XXXXXX'
  return `ARCA-${teamId.toUpperCase()}-XXXXXX`
}

export function NewAgencyModal({ onClose, onCreate }: Props) {
  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/agencies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: name.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Error al crear agencia')
        return
      }

      const agency = await res.json()
      onCreate(agency)
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          zIndex:     100,
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding:    '24px',
        }}
      >
        {/* Card */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background:    'rgba(20,20,30,0.98)',
            border:        '1px solid rgba(255,255,255,0.1)',
            borderRadius:  '16px',
            padding:       '32px',
            width:         '100%',
            maxWidth:      '420px',
            display:       'flex',
            flexDirection: 'column',
            gap:           '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>Nueva Agencia</div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border:     'none',
                color:      'rgba(255,255,255,0.4)',
                fontSize:   '20px',
                cursor:     'pointer',
                lineHeight: 1,
                padding:    '4px',
              }}
            >×</button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>
                Nombre de la agencia
              </label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alucinando Agencia"
                required
                style={{
                  background:   'rgba(255,255,255,0.07)',
                  border:       '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '8px',
                  padding:      '11px 14px',
                  color:        '#fff',
                  fontSize:     '14px',
                  width:        '100%',
                  transition:   'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(83,74,183,0.6)')}
                onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.12)')}
              />
            </div>

            {/* Code preview */}
            <div style={{
              background:   'rgba(255,255,255,0.04)',
              border:       '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              padding:      '12px 14px',
            }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '5px' }}>
                Código generado:
              </div>
              <div style={{
                fontFamily: 'Consolas, Menlo, monospace',
                fontSize:   '13px',
                color:      name.trim() ? '#a78bfa' : 'rgba(255,255,255,0.25)',
                letterSpacing: '0.5px',
              }}>
                {previewCode(name)}
              </div>
            </div>

            {error && (
              <div style={{ fontSize: '13px', color: '#ef4444' }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              style={{
                background:   loading || !name.trim() ? 'rgba(83,74,183,0.35)' : '#534AB7',
                color:        '#fff',
                border:       'none',
                borderRadius: '8px',
                padding:      '12px',
                fontSize:     '14px',
                fontWeight:   600,
                cursor:       loading || !name.trim() ? 'not-allowed' : 'pointer',
                transition:   'background 0.15s',
              }}
            >
              {loading ? 'Creando...' : 'Crear agencia'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
