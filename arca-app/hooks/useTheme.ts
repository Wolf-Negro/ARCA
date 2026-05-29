'use client'

import { useState, useCallback } from 'react'

export type ThemeName = 'purple' | 'matrix' | 'cyber' | 'ember'

export interface Theme {
  name:  ThemeName
  label: string
  color: [number, number, number]  // RGB for particle idle state
  hex:   string
}

export const THEMES: Record<ThemeName, Theme> = {
  purple: { name: 'purple', label: 'ARCA Purple', color: [123, 116, 224], hex: '#7B74E0' },
  matrix: { name: 'matrix', label: 'Matrix',      color: [0,   255,  65], hex: '#00FF41' },
  cyber:  { name: 'cyber',  label: 'Cyber',        color: [0,   180, 255], hex: '#00B4FF' },
  ember:  { name: 'ember',  label: 'Ember',         color: [255, 107,  53], hex: '#FF6B35' },
}

const STORAGE_KEY = 'arca-theme'

function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'purple'
  const saved = localStorage.getItem(STORAGE_KEY)
  return (saved && saved in THEMES) ? (saved as ThemeName) : 'purple'
}

export function useTheme() {
  const [themeName, setThemeName] = useState<ThemeName>(readTheme)

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name)
    localStorage.setItem(STORAGE_KEY, name)
  }, [])

  return { theme: THEMES[themeName], setTheme }
}
