'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// ── Minimal IPC bridge for onboarding.html — exposed as window.electronAPI ──
// Only the handful of calls onboarding.html actually needs are exposed here;
// it must never get raw Node (`require`) or unrestricted Electron access.
contextBridge.exposeInMainWorld('electronAPI', {
  // Finishes onboarding: persists config in main and swaps to the main window.
  sendOnboardingComplete: (config) => ipcRenderer.send('onboarding-complete', config),

  // Opens a URL (e.g. supabase.com signup) in the system browser.
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
