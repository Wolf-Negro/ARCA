'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })

      if (!res.ok) {
        setError('Contraseña incorrecta')
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '24px',
    }}>
      <div style={{
        width:         '100%',
        maxWidth:      '380px',
        background:    'rgba(255,255,255,0.04)',
        border:        '1px solid rgba(255,255,255,0.08)',
        borderRadius:  '16px',
        padding:       '40px 32px',
        display:       'flex',
        flexDirection: 'column',
        gap:           '28px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '44px', marginBottom: '14px', lineHeight: 1 }}>⚡</div>
          <div style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>ARCA Panel</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Acceso de administrador</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña"
            required
            style={{
              background:   'rgba(255,255,255,0.06)',
              border:       '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              padding:      '12px 16px',
              color:        '#fff',
              fontSize:     '14px',
              width:        '100%',
              transition:   'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(83,74,183,0.6)')}
            onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.12)')}
          />

          {error && (
            <div style={{ fontSize: '13px', color: '#ef4444', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              background:   loading || !password ? 'rgba(83,74,183,0.35)' : '#534AB7',
              color:        '#fff',
              border:       'none',
              borderRadius: '8px',
              padding:      '12px',
              fontSize:     '14px',
              fontWeight:   600,
              cursor:       loading || !password ? 'not-allowed' : 'pointer',
              transition:   'background 0.15s',
              marginTop:    '4px',
            }}
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
