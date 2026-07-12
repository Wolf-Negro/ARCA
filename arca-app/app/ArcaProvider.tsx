'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ParticleOrb, type OrbState } from '@/components/ParticleOrb'
import { ChatPanel } from '@/components/ChatPanel'
import { DropZone } from '@/components/DropZone'
import { LibraryView } from '@/components/LibraryView'
import { StatsView } from '@/components/StatsView'
import { SpotlightSearch } from '@/components/SpotlightSearch'
import { ClipboardToast } from '@/components/ClipboardToast'
import { useDrop } from '@/hooks/useDrop'
import { useTheme } from '@/hooks/useTheme'

declare global {
  interface Window {
    electronAPI?: {
      onActivateVoice:       (cb: () => void) => void
      offActivateVoice:      () => void
      onClipboardDetected:   (cb: (url: string) => void) => void
      offClipboardDetected:  () => void
      onSpotlightToggle:     (cb: (isOpen: boolean) => void) => void
      offSpotlightToggle:    () => void
      spotlightToggle:       (open: boolean) => void
      toastToggle:           (open: boolean) => void
      notifyDocSaved:        () => void
      openExternal?:         (url: string) => Promise<void>
      copyToClipboard?:      (text: string) => Promise<void>
      panelToggle?:          (isOpen: boolean) => void
      moveWindow?:           (x: number, y: number) => void
      snapToEdge?:           () => void
      hideWindow?:           () => void
      getConfig?:            () => Promise<{ mode: string; storage?: string; supabaseUrl?: string; supabaseKey?: string; teamId?: string; adminSecret?: string } | null>
    }
  }
}

export function ArcaProvider({ children }: { children: React.ReactNode }) {
  const [isOpen,          setIsOpen]         = useState(false)
  const [orbState,        setOrbState]       = useState<OrbState>('idle')
  const [pendingDropFile, setPendingDropFile] = useState<File | null>(null)
  const orbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showLibrary,    setShowLibrary]    = useState(false)
  const [libraryClient,  setLibraryClient]  = useState<string | undefined>()
  const [libraryDocType, setLibraryDocType] = useState<string | undefined>()
  const [showStats,      setShowStats]      = useState(false)

  // ── Spotlight state ──────────────────────────────────────────────────────────
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false)

  // ── Clipboard toast state ────────────────────────────────────────────────────
  const [clipboardUrl,        setClipboardUrl]        = useState<string | null>(null)
  const [pendingClipboardUrl, setPendingClipboardUrl] = useState<string | null>(null)

  const [arcaConfig, setArcaConfig] = useState<{
    mode: 'personal' | 'team'
    storage?: 'local' | 'supabase'
    supabaseUrl?: string
    supabaseKey?: string
    teamId?: string
  } | null>(null)

  // ── Load config from Electron & init team mode ───────────────────────────────
  useEffect(() => {
    window.electronAPI?.getConfig?.().then(cfg => {
      if (!cfg) return
      setArcaConfig(cfg as typeof arcaConfig)
      if (cfg.supabaseUrl && cfg.supabaseKey) {
        fetch('/api/init-team', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.adminSecret ? { 'x-arca-admin-secret': cfg.adminSecret } : {}),
          },
          body: JSON.stringify({ supabaseUrl: cfg.supabaseUrl, supabaseKey: cfg.supabaseKey, teamId: cfg.teamId }),
        }).then(async res => {
          if (!res.ok) {
            console.error('[ARCA] init-team falló:', res.status, await res.text().catch(() => ''))
          }
        }).catch(err => console.error('[ARCA] init-team falló:', err))
      }
    })
  }, [])

  // ── Background sync polling (every 60 s when in team mode) ──────────────────
  useEffect(() => {
    if (!arcaConfig || arcaConfig.mode !== 'team') return
    const syncNow = () => {
      fetch('/api/sync', { method: 'POST' }).catch(() => {})
    }
    syncNow()
    const interval = setInterval(syncNow, 60_000)
    return () => clearInterval(interval)
  }, [arcaConfig])

  // ── Library helpers ───────────────────────────────────────────────────────────
  const handleShowLibrary = useCallback((clientFilter?: string, docTypeFilter?: string) => {
    setLibraryClient(clientFilter)
    setLibraryDocType(docTypeFilter)
    setShowLibrary(true)
  }, [])

  const handleShowStats    = useCallback(() => setShowStats(true), [])

  const handleFilterFromStats = useCallback((clientFilter?: string, docTypeFilter?: string) => {
    setShowStats(false)
    handleShowLibrary(clientFilter, docTypeFilter)
  }, [handleShowLibrary])

  const { theme } = useTheme()

  // ── Orb state helpers ─────────────────────────────────────────────────────────
  function setOrbFor(next: OrbState, durationMs: number, then: OrbState) {
    setOrbState(next)
    if (orbTimerRef.current) clearTimeout(orbTimerRef.current)
    orbTimerRef.current = setTimeout(() => setOrbState(then), durationMs)
  }

  // ── Notify Electron when panel opens/closes ───────────────────────────────────
  useEffect(() => {
    window.electronAPI?.panelToggle?.(isOpen)
  }, [isOpen])

  // ── Chat processing → orb state ───────────────────────────────────────────────
  const handleProcessingChange = useCallback((processing: boolean) => {
    if (processing) {
      if (orbTimerRef.current) clearTimeout(orbTimerRef.current)
      setOrbState('processing')
    } else {
      setOrbFor('responding', 2200, 'idle')
    }
  }, [])

  const handleDocSaved = useCallback(() => {
    window.electronAPI?.notifyDocSaved()
    setOrbFor('success', 800, 'idle')
  }, [])

  // ── Drop zone ─────────────────────────────────────────────────────────────────
  const { isDraggingOver } = useDrop({
    onFileDrop: useCallback((file: File) => {
      setPendingDropFile(file)
      setIsOpen(true)
    }, []),
  })

  // ── Electron: activate-voice shortcut (Ctrl+Shift+V) ─────────────────────────
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.onActivateVoice(() => setIsOpen(true))
    return () => api.offActivateVoice()
  }, [])

  // ── Electron: Alt+Space → Spotlight toggle ───────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.onSpotlightToggle(() => setIsSpotlightOpen(prev => !prev))
    return () => api.offSpotlightToggle()
  }, [])

  const handleSpotlightClose = useCallback(() => {
    setIsSpotlightOpen(false)
    window.electronAPI?.spotlightToggle?.(false)
  }, [])

  // ── Electron: clipboard-detected → show toast ────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.onClipboardDetected((url: string) => {
      setPendingClipboardUrl(url)
      setClipboardUrl(url)
      setOrbFor('clipboard', 8000, 'idle')
      // Resize window to show toast
      api.toastToggle?.(true)
    })
    return () => api.offClipboardDetected()
  }, [])

  const handleClipboardSave = useCallback(async () => {
    const url = pendingClipboardUrl
    if (!url) return
    setClipboardUrl(null)
    setPendingClipboardUrl(null)
    window.electronAPI?.toastToggle?.(false)
    // Open the chat panel and pre-fill with the URL
    setIsOpen(true)
    // Give panel a beat to mount, then send the URL as a chat message via a custom event
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('arca:send-url', { detail: url }))
    }, 200)
  }, [pendingClipboardUrl])

  const handleClipboardDismiss = useCallback(() => {
    setClipboardUrl(null)
    setPendingClipboardUrl(null)
    setOrbState('idle')
    window.electronAPI?.toastToggle?.(false)
  }, [])

  const handleOrbClick     = useCallback(() => setIsOpen(v => !v), [])
  const handleLongPress    = useCallback(() => setIsOpen(true), [])
  const handleDropConsumed = useCallback(() => setPendingDropFile(null), [])
  const handleClose        = useCallback(() => setIsOpen(false), [])

  return (
    <>
      {children}
      <DropZone isVisible={isDraggingOver} />

      {/* Spotlight global search */}
      <SpotlightSearch
        isOpen={isSpotlightOpen}
        onClose={handleSpotlightClose}
      />

      {/* Clipboard link-detected toast */}
      <ClipboardToast
        url={clipboardUrl}
        onSave={handleClipboardSave}
        onDismiss={handleClipboardDismiss}
      />

      <ChatPanel
        isOpen={isOpen}
        pendingDropFile={pendingDropFile}
        onDropFileConsumed={handleDropConsumed}
        onDocSaved={handleDocSaved}
        onProcessingChange={handleProcessingChange}
        onShowLibrary={handleShowLibrary}
        onShowStats={handleShowStats}
        onClose={handleClose}
      />
      <LibraryView
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        initialClientFilter={libraryClient}
        initialDocTypeFilter={libraryDocType}
      />
      <StatsView
        isOpen={showStats}
        onClose={() => setShowStats(false)}
        onFilterLibrary={handleFilterFromStats}
      />
      <div style={{ overflow: 'hidden', position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <ParticleOrb
          state={orbState}
          themeColor={theme.color}
          onClick={handleOrbClick}
          onLongPress={handleLongPress}
        />
      </div>
    </>
  )
}
