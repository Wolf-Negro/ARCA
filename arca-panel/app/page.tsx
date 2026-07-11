'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { NewAgencyModal } from '@/components/NewAgencyModal'
import { CopyButton } from '@/components/CopyButton'

interface Agency {
  id:         string
  name:       string
  code:       string
  team_id:    string
  active:     boolean
  created_at: string
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', {
      day:   'numeric',
      month: 'short',
      year:  'numeric',
    }).format(new Date(iso))
  } catch { return iso }
}

export default function DashboardPage() {
  const [agencies,   setAgencies]   = useState<Agency[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showModal,  setShowModal]  = useState(false)
  const [toast,      setToast]      = useState('')
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  const fetchAgencies = useCallback(async () => {
    try {
      const res = await fetch('/api/agencies')
      if (res.status === 401) { router.push('/login'); return }
      if (res.ok) setAgencies(await res.json())
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { fetchAgencies() }, [fetchAgencies])

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    setToast(msg)
    const t = setTimeout(() => setToast(''), 3000)
    setToastTimer(t)
  }

  async function handleToggle(id: string, currentActive: boolean) {
    const res = await fetch(`/api/agencies/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !currentActive }),
    })
    if (res.ok) {
      setAgencies(prev => prev.map(a => a.id === id ? { ...a, active: !currentActive } : a))
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return
    const res = await fetch(`/api/agencies/${id}`, { method: 'DELETE' })
    if (res.ok) setAgencies(prev => prev.filter(a => a.id !== id))
  }

  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }

  function handleCreated(agency: Agency) {
    setAgencies(prev => [agency, ...prev])
    setShowModal(false)
    showToast('✓ Agencia creada')
  }

  const total    = agencies.length
  const active   = agencies.filter(a => a.active).length
  const inactive = total - active

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        padding:        '0 32px',
        height:         '60px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        borderBottom:   '1px solid rgba(255,255,255,0.06)',
        flexShrink:     0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>⚡</span>
          <span style={{ fontSize: '16px', fontWeight: 700 }}>ARCA Panel</span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background:   'transparent',
            border:       '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color:        'rgba(255,255,255,0.5)',
            fontSize:     '13px',
            padding:      '6px 14px',
            cursor:       'pointer',
            transition:   'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.25)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)' }}
        >
          Cerrar sesión
        </button>
      </header>

      {/* Main */}
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
          marginBottom:   '24px',
          flexWrap:       'wrap',
          gap:            '16px',
        }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '2px' }}>Agencias</h1>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Gestiona los códigos de activación de ARCA Desktop</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              background:   '#534AB7',
              color:        '#fff',
              border:       'none',
              borderRadius: '8px',
              padding:      '10px 20px',
              fontSize:     '14px',
              fontWeight:   600,
              cursor:       'pointer',
              transition:   'background 0.15s',
              display:      'flex',
              alignItems:   'center',
              gap:          '6px',
              whiteSpace:   'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#6259d4'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#534AB7'}
          >
            + Nueva Agencia
          </button>
        </div>

        {/* Stats */}
        <div style={{
          display:       'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap:           '12px',
          marginBottom:  '24px',
        }}>
          {[
            { label: 'Total agencias', value: total,    color: '#fff' },
            { label: 'Activas',        value: active,   color: '#22c55e' },
            { label: 'Inactivas',      value: inactive, color: '#ef4444' },
          ].map(stat => (
            <div key={stat.label} style={{
              background:    'rgba(255,255,255,0.04)',
              border:        '1px solid rgba(255,255,255,0.08)',
              borderRadius:  '12px',
              padding:       '18px 20px',
            }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: stat.color, lineHeight: 1, marginBottom: '6px' }}>
                {loading ? '—' : stat.value}
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'rgba(255,255,255,0.3)', fontSize: '14px' }}>
            Cargando...
          </div>
        ) : agencies.length === 0 ? (
          <div style={{
            background:    'rgba(255,255,255,0.03)',
            border:        '1px dashed rgba(255,255,255,0.1)',
            borderRadius:  '12px',
            padding:       '60px 24px',
            textAlign:     'center',
            color:         'rgba(255,255,255,0.35)',
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏢</div>
            <div style={{ fontSize: '15px', marginBottom: '6px' }}>No hay agencias todavía</div>
            <div style={{ fontSize: '13px' }}>Crea la primera con el botón &quot;Nueva Agencia&quot; →</div>
          </div>
        ) : (
          <div style={{
            background:   'rgba(255,255,255,0.03)',
            border:       '1px solid rgba(255,255,255,0.07)',
            borderRadius: '12px',
            overflow:     'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Agencia', 'Código de activación', 'Team ID', 'Creada', 'Estado', 'Acciones'].map(h => (
                      <th key={h} style={{
                        padding:   '12px 16px',
                        textAlign: 'left',
                        color:     'rgba(255,255,255,0.4)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agencies.map((agency, i) => (
                    <tr
                      key={agency.id}
                      style={{
                        borderBottom: i < agencies.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        transition:   'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '14px 16px', fontWeight: 500 }}>{agency.name}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{
                            fontFamily: 'Consolas, Menlo, monospace',
                            fontSize:   '12px',
                            color:      '#a78bfa',
                            letterSpacing: '0.3px',
                          }}>
                            {agency.code}
                          </span>
                          <CopyButton text={agency.code} />
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Consolas, Menlo, monospace', fontSize: '12px' }}>
                        {agency.team_id}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
                        {formatDate(agency.created_at)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          display:      'inline-flex',
                          alignItems:   'center',
                          gap:          '5px',
                          fontSize:     '12px',
                          fontWeight:   600,
                          padding:      '3px 10px',
                          borderRadius: '20px',
                          background:   agency.active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          color:        agency.active ? '#22c55e'              : '#ef4444',
                          border:       `1px solid ${agency.active ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                        }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                          {agency.active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            onClick={() => handleToggle(agency.id, agency.active)}
                            style={{
                              background:   agency.active ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                              color:        agency.active ? '#ef4444'               : '#22c55e',
                              border:       `1px solid ${agency.active ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
                              borderRadius: '6px',
                              padding:      '5px 10px',
                              fontSize:     '12px',
                              fontWeight:   500,
                              cursor:       'pointer',
                              whiteSpace:   'nowrap',
                              transition:   'all 0.15s',
                            }}
                          >
                            {agency.active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            onClick={() => handleDelete(agency.id, agency.name)}
                            style={{
                              background:   'rgba(239,68,68,0.1)',
                              color:        '#ef4444',
                              border:       '1px solid rgba(239,68,68,0.2)',
                              borderRadius: '6px',
                              padding:      '5px 10px',
                              fontSize:     '12px',
                              cursor:       'pointer',
                              transition:   'all 0.15s',
                            }}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <NewAgencyModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreated}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position:     'fixed',
          bottom:       '24px',
          left:         '50%',
          transform:    'translateX(-50%)',
          background:   'rgba(34,197,94,0.15)',
          border:       '1px solid rgba(34,197,94,0.3)',
          color:        '#22c55e',
          borderRadius: '8px',
          padding:      '10px 20px',
          fontSize:     '14px',
          fontWeight:   500,
          zIndex:       200,
          whiteSpace:   'nowrap',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
