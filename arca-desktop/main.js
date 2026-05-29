'use strict'

const {
  app, BrowserWindow, globalShortcut,
  screen, ipcMain, shell, session, clipboard, systemPreferences,
} = require('electron')
const path = require('path')
const fs   = require('fs')
const { createTray } = require('./tray')

// Allow audio autoplay without a user gesture (needed for ElevenLabs TTS via new Audio())
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Ensure Web Speech API feature is explicitly enabled
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI,AudioCaptureAllowed')

// ── Window size constants ─────────────────────────────────────────────────────
const ORB_SIZE      = 150           // orb-only mode
const PANEL_W       = 420           // panel width
const PANEL_H       = 650           // panel height
const WIN_MARGIN    = 10            // screen-edge margin
const NEXT_URL      = 'http://localhost:3000'
const INITIAL_DELAY = 5000          // ms — wait for Next.js to compile
const RETRY_MS      = 3000          // ms — between retry attempts
const MAX_RETRIES   = 20

/** @type {BrowserWindow|null} */ let win     = null
/** @type {import('electron').Tray|null} */ let tray = null
/** @type {BrowserWindow|null} */ let authWin = null
/** @type {BrowserWindow|null} */ let onboardingWin = null
let retryCount  = 0
let loadTimer   = null
let isQuitting  = false

// Manual drag state (move-window IPC)
let dragLastX = null
let dragLastY = null

// Orb position saved when panel opens (restored on close)
let savedOrbX = null
let savedOrbY = null

// ── Position helpers ──────────────────────────────────────────────────────────

function orbPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return {
    x: width  - ORB_SIZE - WIN_MARGIN,
    y: height - ORB_SIZE - WIN_MARGIN,
  }
}

// ── Position persistence (userData/window-position.json) ─────────────────────

// Computed lazily — app.getPath('userData') requires the app to be ready
function positionFile() {
  return path.join(app.getPath('userData'), 'window-position.json')
}

function loadSavedPosition() {
  try {
    const raw  = fs.readFileSync(positionFile(), 'utf8')
    const data = JSON.parse(raw)
    if (typeof data.x === 'number' && typeof data.y === 'number') return data
  } catch {}
  return null
}

function savePosition() {
  if (!win || win.isDestroyed()) return
  try {
    const [x, y] = win.getPosition()
    fs.writeFileSync(positionFile(), JSON.stringify({ x, y }), 'utf8')
  } catch {}
}

function configFile() {
  return path.join(app.getPath('userData'), 'arca-config.json')
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  } catch { return null }
}

function saveConfig(data) {
  try { fs.writeFileSync(configFile(), JSON.stringify(data), 'utf8') } catch {}
}

/** Returns true if the rect overlaps at least one display's work area. */
function isOnScreen(x, y, w, h) {
  return screen.getAllDisplays().some(d => {
    const b = d.workArea
    return x < b.x + b.width && x + w > b.x && y < b.y + b.height && y + h > b.y
  })
}

/** Returns the display the window currently occupies. */
function displayForWindow() {
  if (!win) return screen.getPrimaryDisplay()
  const [wx, wy] = win.getPosition()
  for (const d of screen.getAllDisplays()) {
    const b = d.workArea
    if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) {
      return d
    }
  }
  return screen.getPrimaryDisplay()
}

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow(savedBounds = null) {
  // NOTE: x/y position is intentionally NOT restored from savedBounds or
  // window-position.json so the window always starts centered on screen.
  // Only size is preserved from savedBounds (if available).
  const sizeOverride = savedBounds
    ? { width: savedBounds.width, height: savedBounds.height }
    : {}

  win = new BrowserWindow({
    width:     440,
    height:    720,
    center:    true,
    ...sizeOverride,          // restore saved size only, never saved x/y
    show:      false,         // revealed only in ready-to-show handler
    minWidth:  380,
    minHeight: 500,
    // ── Frameless transparent floating window ──
    frame:           false,
    transparent:     true,
    backgroundColor: '#00000000',
    hasShadow:       false,
    // ── Always on top, visible in taskbar ──
    alwaysOnTop:            true,
    visibleOnAllWorkspaces: true,
    skipTaskbar:            false,
    // ── Fixed aspect / no chrome ──
    resizable:      false,
    maximizable:    false,
    fullscreenable: false,
    minimizable:    false,
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      backgroundThrottling: false,
    },
  })

  // (mic permissions are granted globally in setupPermissions() below)

  // ── Show only after first paint; re-validate bounds in case display changed ─
  // Safety fallback: force-show after 15 s if ready-to-show never fires
  // (e.g. Next.js very slow to compile or loading fails entirely).
  const showFallback = setTimeout(() => {
    if (win && !win.isVisible() && !win.isDestroyed()) {
      console.log('[ARCA] ready-to-show fallback: force-showing window')
      win.show()
    }
  }, INITIAL_DELAY + 10_000)

  win.once('ready-to-show', () => {
    clearTimeout(showFallback)
    const primaryDisplay = screen.getPrimaryDisplay()
    const { x: workX, y: workY, width: workW, height: workH } = primaryDisplay.workArea
    const winW = 150
    const winH = 150
    const centerX = Math.round(workX + (workW - winW) / 2)
    const centerY = Math.round(workY + (workH - winH) / 2)
    win.setSize(winW, winH)
    win.setPosition(centerX, centerY)
    win.show()
    win.focus()
    console.log(`[ARCA] Window shown — pos:(${centerX},${centerY}) size:(${winW}x${winH})`)
  })

  // ── Persistent load handlers ──────────────────────────────────────────────
  win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
    if (url === NEXT_URL && code !== 0) scheduleRetry()
  })

  win.webContents.on('did-finish-load', () => {
    retryCount = 0
    clearTimeout(loadTimer)
    console.log('[ARCA] Loaded successfully')
  })

  scheduleLoad(INITIAL_DELAY)

  // ── Persist position on move (debounced 500 ms) ───────────────────────────
  let savePosTimer = null
  win.on('moved', () => {
    clearTimeout(savePosTimer)
    savePosTimer = setTimeout(savePosition, 500)
  })

  // ── Close = save position + bounds + hide (or quit) ─────────────────────
  win.on('close', (e) => {
    savePosition()
    if (stateFile) {
      try {
        fs.writeFileSync(stateFile, JSON.stringify(win.getBounds()), 'utf8')
      } catch {}
    }
    if (!isQuitting) { e.preventDefault(); win.hide() }
  })

  // External links → system browser
  // Use proper URL parsing — startsWith is bypassable via http://localhost:3000@attacker.com
  function isInternal(urlStr) {
    try {
      const u = new URL(urlStr), base = new URL(NEXT_URL)
      return u.protocol === base.protocol && u.hostname === base.hostname && u.port === base.port
    } catch { return false }
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url) }
  })

  return win
}

function createOnboardingWindow() {
  onboardingWin = new BrowserWindow({
    width:           480,
    height:          600,
    center:          true,
    resizable:       false,
    frame:           false,
    transparent:     false,
    backgroundColor: '#0f0f14',
    alwaysOnTop:     true,
    skipTaskbar:     false,
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  })
  onboardingWin.loadFile(path.join(__dirname, 'onboarding.html'))
  onboardingWin.once('ready-to-show', () => onboardingWin?.show())
  onboardingWin.once('closed', () => { onboardingWin = null })
  return onboardingWin
}

// ── Load / retry logic ────────────────────────────────────────────────────────

function scheduleLoad(delay) {
  clearTimeout(loadTimer)
  loadTimer = setTimeout(doLoad, delay)
}

function doLoad() {
  if (!win) return
  console.log(`[ARCA] Loading ${NEXT_URL} (attempt ${retryCount + 1}/${MAX_RETRIES})`)
  win.loadURL(NEXT_URL).catch(() => scheduleRetry())
}

function scheduleRetry() {
  if (retryCount >= MAX_RETRIES) {
    console.warn('[ARCA] Max retries reached — is Next.js running?')
    return
  }
  retryCount++
  console.log(`[ARCA] Retrying in ${RETRY_MS}ms...`)
  scheduleLoad(RETRY_MS)
}

// ── Global shortcuts ──────────────────────────────────────────────────────────

function registerShortcuts() {
  const ok1 = globalShortcut.register('CommandOrControl+Space', () => {
    if (!win) return
    if (win.isVisible() && win.isFocused()) win.hide()
    else { win.show(); win.focus() }
  })
  if (!ok1) console.warn('[ARCA] Ctrl+Space taken by another app')

  const ok2 = globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (!win) return
    if (!win.isVisible()) { win.show(); win.focus() }
    setTimeout(() => win.webContents.send('activate-voice'), 120)
  })
  if (!ok2) console.warn('[ARCA] Ctrl+Shift+V taken by another app')
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.on('doc-saved', () => {
    tray?.setToolTip('ARCA — Documento guardado ✓')
    setTimeout(() => tray?.setToolTip('ARCA — Archivos de Agencia'), 4000)
  })

  ipcMain.on('hide-window', () => {
    if (win && !win.isDestroyed()) win.hide()
  })

  // ── Manual window drag ────────────────────────────────────────────────────
  ipcMain.on('move-window', (_event, { x, y }) => {
    if (!win) return
    if (x === 0 && y === 0) { dragLastX = null; dragLastY = null; return }
    if (dragLastX === null) { dragLastX = x; dragLastY = y; return }
    const [wx, wy] = win.getPosition()
    win.setPosition(wx + (x - dragLastX), wy + (y - dragLastY))
    dragLastX = x
    dragLastY = y
  })

  // ── Snap to nearest edge after drag ───────────────────────────────────────
  ipcMain.on('snap-to-edge', (_event, { x, y }) => {
    if (!win) return

    // Find which display the window is on (cursor coords for accuracy)
    let display = screen.getPrimaryDisplay()
    for (const d of screen.getAllDisplays()) {
      const b = d.workArea
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        display = d; break
      }
    }

    const { x: dx, y: dy, width: dw, height: dh } = display.workArea
    const [winX, winY] = win.getPosition()

    // Distance from each edge
    const distLeft   = winX - dx
    const distRight  = (dx + dw) - (winX + ORB_SIZE)
    const distTop    = winY - dy
    const distBottom = (dy + dh) - (winY + ORB_SIZE)
    const minDist    = Math.min(distLeft, distRight, distTop, distBottom)

    // Snap X or Y to the nearest edge; the other axis stays free
    let snapX = winX, snapY = winY
    if      (minDist === distLeft)   snapX = dx + WIN_MARGIN
    else if (minDist === distRight)  snapX = dx + dw - ORB_SIZE - WIN_MARGIN
    else if (minDist === distTop)    snapY = dy + WIN_MARGIN
    else                             snapY = dy + dh - ORB_SIZE - WIN_MARGIN

    // Animated ease-out snap
    const startX = winX, startY = winY
    const steps  = 8
    let   step   = 0
    const interval = setInterval(() => {
      step++
      const t    = step / steps
      const ease = 1 - Math.pow(1 - t, 3)  // cubic ease-out
      win.setPosition(
        Math.round(startX + (snapX - startX) * ease),
        Math.round(startY + (snapY - startY) * ease),
      )
      if (step >= steps) { clearInterval(interval); savePosition() }
    }, 16)
  })

  // ── Panel open/close — multi-monitor aware ────────────────────────────────
  ipcMain.on('panel-toggle', (_event, isOpen) => {
    if (!win) return
    const display = displayForWindow()
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea

    if (isOpen) {
      const [wx, wy] = win.getPosition()
      savedOrbX = wx
      savedOrbY = wy

      // Raise minimum size before expanding to panel dimensions
      win.setMinimumSize(400, 600)

      // Anchor panel to orb corner, clamped to stay fully on screen
      const newX = Math.max(dx + WIN_MARGIN,
                    Math.min(wx, dx + dw - PANEL_W - WIN_MARGIN))
      const newY = Math.max(dy + WIN_MARGIN,
                    Math.min(wy, dy + dh - PANEL_H - WIN_MARGIN))
      win.setBounds({ x: newX, y: newY, width: PANEL_W, height: PANEL_H }, false)
    } else {
      // Lower minimum size before shrinking back to orb dimensions
      win.setMinimumSize(ORB_SIZE, ORB_SIZE)

      // Restore exact orb position from before the panel opened
      const x = savedOrbX ?? (dx + dw - ORB_SIZE - WIN_MARGIN)
      const y = savedOrbY ?? (dy + dh - ORB_SIZE - WIN_MARGIN)
      savedOrbX = null
      savedOrbY = null
      win.setBounds({ x, y, width: ORB_SIZE, height: ORB_SIZE }, false)
      savePosition()  // persist final orb position after panel closes
    }
  })

  // ── Google OAuth popup ───────────────────────────────────────────────────
  ipcMain.on('open-auth', () => {
    // Prevent multiple auth windows if user clicks the button twice
    if (authWin && !authWin.isDestroyed()) {
      authWin.focus()
      return
    }

    authWin = new BrowserWindow({
      width:  520,
      height: 680,
      center: true,
      show:   false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation:   true,
        nodeIntegration:    false,
        sandbox:            true,
        devTools:           false,
        enableRemoteModule: false,
      },
    })

    authWin.loadURL(`${NEXT_URL}/api/auth/signin/google`)
    authWin.once('ready-to-show', () => authWin?.show())

    // Auto-close if auth takes more than 5 minutes
    const timeout = setTimeout(() => {
      if (authWin && !authWin.isDestroyed()) authWin.destroy()
    }, 5 * 60 * 1000)

    authWin.once('closed', () => {
      clearTimeout(timeout)
      authWin = null
    })

    // When OAuth finishes, Google redirects → callback → root of the app
    const onNav = (_e, url) => {
      if (url === NEXT_URL || url === NEXT_URL + '/') {
        clearTimeout(timeout)
        authWin?.destroy()
        win?.webContents.reload()
      }
    }
    authWin.webContents.on('will-navigate', onNav)
    authWin.webContents.on('did-navigate',  onNav)
  })

  ipcMain.handle('open-external', (_event, url) => {
    try {
      const parsed = new URL(String(url))
      if (!['http:', 'https:'].includes(parsed.protocol)) return
      shell.openExternal(parsed.href)
    } catch { /* invalid URL — ignore */ }
  })

  ipcMain.handle('copy-clipboard', (_event, text) => {
    clipboard.writeText(String(text))
  })

  ipcMain.on('onboarding-complete', (_event, config) => {
    saveConfig(config)
    if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close()
    win = createWindow(null)
    tray = createTray(win)
    registerShortcuts()
  })

  ipcMain.on('reset-onboarding', () => {
    try { fs.unlinkSync(configFile()) } catch {}
    if (win && !win.isDestroyed()) win.close()
    onboardingWin = createOnboardingWindow()
  })

  ipcMain.handle('get-config', () => loadConfig())
}

// ── Microphone / media permissions ───────────────────────────────────────────

// Permission names Electron uses for media/microphone access:
//   'media'       — getUserMedia (audio+video)
//   'speech'      — Web Speech API SpeechRecognition
//   'audioCapture', 'microphone' — legacy / alias names
const ALLOWED_PERMISSIONS = new Set([
  'media', 'speech', 'microphone', 'audioCapture', 'speechRecognition',
])

// Cache of already-approved permission types.
// SpeechRecognition calls getUserMedia on every restart; without this cache
// the request handler fires hundreds of times and spams the console.
const grantedPermissions = new Set()

function isPermissionAllowed(permission, details) {
  return ALLOWED_PERMISSIONS.has(permission) ||
    (permission === 'media' && (
      !details?.mediaTypes || details.mediaTypes.includes('audio')
    ))
}

function setupPermissions() {
  // Approve requests — log only once per permission type, then cache
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (grantedPermissions.has(permission)) {
      cb(true)   // already granted — skip log to avoid infinite spam
      return
    }
    const allowed = isPermissionAllowed(permission, details)
    if (allowed) {
      console.log(`[ARCA] Permission granted (first time): ${permission}`)
      grantedPermissions.add(permission)
    } else {
      console.warn(`[ARCA] Permission denied: ${permission}`)
    }
    cb(allowed)
  })

  // Pre-approve checks so the browser short-circuits before reaching the
  // request handler — this is what should prevent repeat request callbacks,
  // but we keep the cache above as a belt-and-suspenders guard.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (grantedPermissions.has(permission)) return true
    return isPermissionAllowed(permission, details)
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { win?.show(); win?.focus() })
}

app.commandLine.appendSwitch('lang', 'es')

// stateFile is defined lazily inside whenReady because app.getPath('userData')
// is not available until the app is ready.
let stateFile = null

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide()

  stateFile = path.join(app.getPath('userData'), 'window-state.json')

  // ── Restore window bounds from previous session ───────────────────────────
  let savedBounds = null
  try {
    const raw  = fs.readFileSync(stateFile, 'utf8')
    const data = JSON.parse(raw)
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const { x, y, width, height } = data
    if (
      typeof x === 'number' && typeof y === 'number' &&
      typeof width === 'number' && typeof height === 'number' &&
      x >= 0 && y >= 0 &&
      x + width <= sw && y + height <= sh
    ) {
      savedBounds = { x, y, width, height }
    }
  } catch {}

  // Permissions must be registered before the window navigates
  setupPermissions()

  // On macOS, trigger the OS microphone-access dialog if not yet authorised
  if (process.platform === 'darwin') {
    const status = await systemPreferences.askForMediaAccess('microphone')
    console.log(`[ARCA] macOS microphone access: ${status}`)
  }

  registerIPC()
  const config = loadConfig()
  if (config) {
    win  = createWindow(savedBounds)
    tray = createTray(win)
    registerShortcuts()
  } else {
    createOnboardingWindow()
  }
})

app.on('will-quit',         () => globalShortcut.unregisterAll())
app.on('before-quit',       () => { isQuitting = true })
app.on('activate',          () => {
  if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  else { win?.show(); win?.focus() }
})
app.on('window-all-closed', (e) => e.preventDefault())
