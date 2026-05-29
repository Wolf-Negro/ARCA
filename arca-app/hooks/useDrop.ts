'use client'

import { useState, useEffect, useCallback } from 'react'

interface UseDropOptions {
  onFileDrop: (file: File) => void
}

export function useDrop({ onFileDrop }: UseDropOptions) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCountRef = { current: 0 }

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCountRef.current++
    if (dragCountRef.current === 1) setIsDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current === 0) setIsDraggingOver(false)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
  }, [])

  const ALLOWED_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain',
  ])
  const MAX_SIZE = 10 * 1024 * 1024  // 10 MB

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      dragCountRef.current = 0
      setIsDraggingOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      if (!ALLOWED_TYPES.has(file.type)) return
      if (file.size > MAX_SIZE) return
      onFileDrop(file)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onFileDrop]
  )

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  return { isDraggingOver }
}
