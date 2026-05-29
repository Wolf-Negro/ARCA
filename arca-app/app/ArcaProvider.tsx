'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ParticleOrb, type OrbState } from '@/components/ParticleOrb'
import { ChatPanel } from '@/components/ChatPanel'
import { DropZone } from '@/components/DropZone'
import { LibraryView } from '@/components/LibraryView'
import { StatsView } from '@/components/StatsView'
import { useDrop } from '@/hooks/useDrop'
import { useTheme } from '@/hooks/useTheme'

declare global {
  interface Window {
    electronAPI?: {
      onActivateVoice:  (cb: () => void) => void
      offActivateVoice: () => void
      notifyDocSaved:   () => void
      openExternal?:    (url:  string) => Promise<void>
      copyToClipboard?: (text: string) => Promise<void>
      panelToggle?:     (isOpen: boolean) => void
      moveWindow?:      (x: number, y: number) => void
      snapToEdge?:      () => void
      hideWindow?:      () => void
      getConfig?:       () => Promise<{ mode: string; storage?: string; supabaseUrl?: string; supabaseKey?: string; teamId?: string } | null>
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

  const [arcaConfig, setArcaConfig] = useState<{ mode: 'personal' | 'team'; storage?: 'local' | 'supabase'; supabaseUrl?: string; supabaseKey?: string; teamId?: string } | null>(null)

  useEffect(() => {
    window.electronAPI?.getConfig?.().then(cfg => {
      if (!cfg) return
      setArcaConfig(cfg as { mode: 'personal' | 'team'; storage?: 'local' | 'supabase'; supabaseUrl?: string; supabaseKey?: string; teamId?: string })
      // Re-initialize Supabase connection if using cloud storage
      if (cfg.supabaseUrl && cfg.supabaseKey) {
        fetch('/api/init-team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supabaseUrl: cfg.supabaseUrl, supabaseKey: cfg.supabaseKey, teamId: cfg.teamId }),
        }).catch(() => {/* best-effort — app continues working */})
      }
    })
  }, [])

  const handleShowLibrary = useCallback((clientFilter?: string, docTypeFilter?: string) => {
    setLibraryClient(clientFilter)
    setLibraryDocType(docTypeFilter)
    setShowLibrary(true)
  }, [])

  const handleShowStats = useCallback(() => setShowStats(true), [])

  const handleFilterFromStats = useCallback((clientFilter?: string, docTypeFilter?: string) => {
    setShowStats(false)
    handleShowLibrary(clientFilter, docTypeFilter)
  }, [handleShowLibrary])

  const { theme } = useTheme()

  function setOrbFor(next: OrbState, durationMs: number, then: OrbState) {
    setOrbState(next)
    if (orbTimerRef.current) clearTimeout(orbTimerRef.current)
    orbTimerRef.current = setTimeout(() => setOrbState(then), durationMs)
  }

  // Notify Electron when panel opens/closes (dynamic window resize)
  useEffect(() => {
    window.electronAPI?.panelToggle?.(isOpen)
  }, [isOpen])

  // Chat processing drives orb state
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

  // Drop zone
  const { isDraggingOver } = useDrop({
    onFileDrop: useCallback((file: File) => {
      setPendingDropFile(file)
      setIsOpen(true)
    }, []),
  })

  // Electron global shortcut (Ctrl+Shift+V) — opens panel
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.onActivateVoice(() => setIsOpen(true))
    return () => api.offActivateVoice()
  }, [])

  const handleOrbClick     = useCallback(() => setIsOpen((v) => !v), [])
  const handleLongPress    = useCallback(() => setIsOpen(true), [])
  const handleDropConsumed = useCallback(() => setPendingDropFile(null), [])
  const handleClose        = useCallback(() => setIsOpen(false), [])

  return (
    <>
      {children}
      <DropZone isVisible={isDraggingOver} />
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
