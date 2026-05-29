'use client'

import { useState } from 'react'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copiado' : 'Copiar código'}
      style={{
        background:   'transparent',
        border:       'none',
        cursor:       'pointer',
        color:        copied ? '#22c55e' : 'rgba(255,255,255,0.35)',
        padding:      '4px 6px',
        borderRadius: '4px',
        fontSize:     '14px',
        transition:   'color 0.15s',
        flexShrink:   0,
        lineHeight:   1,
      }}
      onMouseEnter={e => { if (!copied) (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)' }}
      onMouseLeave={e => { if (!copied) (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)' }}
    >
      {copied ? '✓' : '⎘'}
    </button>
  )
}
