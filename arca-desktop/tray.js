'use strict'

const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')

/**
 * Resolve the tray icon path.
 * - Development: ../arca-app/public/icon-192.png
 * - Production (packaged): process.resourcesPath/tray-icon.png
 */
function resolveIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tray-icon.png')
  }
  return path.join(__dirname, '..', 'arca-app', 'public', 'icon-192.png')
}

function buildIcon() {
  try {
    const raw = nativeImage.createFromPath(resolveIconPath())
    if (raw.isEmpty()) return nativeImage.createEmpty()
    // 16px for Windows tray, 18px for macOS menu bar
    const size = process.platform === 'darwin' ? 18 : 16
    return raw.resize({ width: size, height: size, quality: 'best' })
  } catch {
    return nativeImage.createEmpty()
  }
}

/**
 * @param {import('electron').BrowserWindow} win
 * @returns {Tray}
 */
function createTray(win) {
  const icon = buildIcon()
  const tray = new Tray(icon)

  tray.setToolTip('ARCA — Archivos de Agencia')
  if (process.platform === 'darwin') {
    tray.setTitle('ARCA')
  }

  function rebuildMenu() {
    const isVisible = win.isVisible()

    const menu = Menu.buildFromTemplate([
      {
        label: 'ARCA — Archivos de Agencia',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isVisible ? 'Ocultar ventana' : 'Mostrar ventana',
        accelerator: 'CommandOrControl+Space',
        click: () => {
          if (win.isVisible()) {
            win.hide()
          } else {
            win.show()
            win.focus()
          }
          // Rebuild menu so label stays in sync
          rebuildMenu()
        },
      },
      {
        label: 'Activar micrófono',
        accelerator: 'CommandOrControl+Shift+V',
        click: () => {
          if (!win.isVisible()) {
            win.show()
            win.focus()
          }
          win.webContents.send('activate-voice')
        },
      },
      { type: 'separator' },
      {
        label: 'Salir',
        accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
        click: () => {
          app.isQuitting = true
          app.quit()
        },
      },
    ])

    tray.setContextMenu(menu)
  }

  rebuildMenu()

  // Left-click on tray icon toggles window
  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
    rebuildMenu()
  })

  // Double-click on Windows also works
  tray.on('double-click', () => {
    win.show()
    win.focus()
    rebuildMenu()
  })

  // Keep menu label in sync with window visibility
  win.on('show', rebuildMenu)
  win.on('hide', rebuildMenu)

  return tray
}

module.exports = { createTray }
