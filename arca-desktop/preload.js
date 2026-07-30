'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// ── IPC bridge → exposed as window.electronAPI ────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  onActivateVoice:  (cb)    => ipcRenderer.on('activate-voice', () => cb()),
  offActivateVoice: ()      => ipcRenderer.removeAllListeners('activate-voice'),
  onSpotlightToggle: (cb)   => ipcRenderer.on('spotlight-toggle', (_, isOpen) => cb(isOpen)),
  offSpotlightToggle: ()    => ipcRenderer.removeAllListeners('spotlight-toggle'),
  spotlightToggle:  (open)  => ipcRenderer.send('spotlight-toggle', open),
  notifyDocSaved:   ()      => ipcRenderer.send('doc-saved'),
  openExternal:     (url)   => ipcRenderer.invoke('open-external', url),
  copyToClipboard:  (text)  => ipcRenderer.invoke('copy-clipboard', text),
  panelToggle:      (open)  => ipcRenderer.send('panel-toggle', open),
  moveWindow:       (x, y)  => ipcRenderer.send('move-window', { x, y }),
  snapToEdge:       ()      => ipcRenderer.send('snap-to-edge',
                                 { x: window.screenX, y: window.screenY }),
  hideWindow:       ()      => ipcRenderer.send('hide-window'),
  getConfig:        ()      => ipcRenderer.invoke('get-config'),
  resetOnboarding:  ()      => ipcRenderer.send('reset-onboarding'),
})

// ── Inject styles as soon as the DOM is available ────────────────────────────
function injectStyles() {
  if (document.getElementById('arca-preload')) return

  const s = document.createElement('style')
  s.id = 'arca-preload'
  s.textContent = `
    /* ── Transparent background ── */
    html, body {
      background: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }

    /* ── No webkit drag regions — canvas manages drag via IPC ── */
    * {
      -webkit-app-region: no-drag;
    }

    /* ── Prevent text-selection during drag ── */
    body {
      user-select: none;
      -webkit-user-select: none;
    }
    input, textarea, p, span, li {
      user-select: text;
      -webkit-user-select: text;
    }
  `
  ;(document.head || document.documentElement).appendChild(s)
}

if (document.readyState !== 'loading') {
  injectStyles()
} else {
  document.addEventListener('DOMContentLoaded', injectStyles)
}
