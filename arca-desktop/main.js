'use strict'

const {
  app, BrowserWindow, globalShortcut,
  screen, ipcMain, shell, session, clipboard,
} = require('electron')
const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const https  = require('https')
const crypto = require('crypto')
const { spawn, exec } = require('child_process')
const { autoUpdater } = require('electron-updater')
const { createTray } = require('./tray')

// ── Window size constants ─────────────────────────────────────────────────────
const ORB_SIZE      = 150           // orb-only mode
const PANEL_W       = 420           // panel width
const PANEL_H       = 650           // panel height
const WIN_MARGIN    = 10            // screen-edge margin
const DEFAULT_PORT  = 3000
let   NEXT_URL       = `http://localhost:${DEFAULT_PORT}`   // reassigned once the real port is known
const INITIAL_DELAY = 5000          // ms — wait for Next.js to compile
const RETRY_MS      = 3000          // ms — between retry attempts
const MAX_RETRIES   = 20

// Generated fresh per launch, never persisted to disk: arca-app's
// /api/init-team requires this header to reconfigure team/Supabase sync.
// It's handed to the renderer only over IPC (see 'get-config' below).
const ADMIN_SECRET = crypto.randomBytes(32).toString('hex')

/** @type {BrowserWindow|null} */ let win     = null
/** @type {import('electron').Tray|null} */ let tray = null
/** @type {BrowserWindow|null} */ let onboardingWin = null
/** @type {import('child_process').ChildProcess|null} */ let nextServerProcess = null
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

// ── Bundled Next.js server ─────────────────────────────────────────────────────
// arca-desktop owns the arca-app server's lifecycle end-to-end: nobody should
// ever need to run `npm run dev` by hand for ARCA to work.
//
// Port selection deliberately does NOT use a separate "probe socket, then
// spawn the real server" strategy: Windows allows a wildcard (0.0.0.0) bind
// and a loopback-only (127.0.0.1) bind to coexist on the very same port
// without erroring, in either direction — so a probe can report a port as
// free when it truly isn't (confirmed in testing, twice, against two
// different unrelated local dev servers). Instead we spawn the REAL server on
// a candidate port and watch whether it survives its own startup window; an
// occupied port makes it exit almost immediately with EADDRINUSE, in which
// case we retry on the next port.

function buildServerEnv(port) {
  return {
    ...process.env,
    PORT:     String(port),
    HOSTNAME: '127.0.0.1',
    ARCA_DB_PATH:      path.join(app.getPath('userData'), 'arca-data', 'arca.db'),
    ARCA_UPLOADS_PATH: path.join(app.getPath('userData'), 'arca-data', 'uploads'),
    ARCA_ADMIN_SECRET: ADMIN_SECRET,
  }
}

/** One-shot migration: uploads used to live under process.cwd()/arca-data/
 *  which, in the packaged app, is inside resources/app — a directory
 *  electron-updater replaces wholesale on every update, silently deleting
 *  every file a user ever saved. Copies any such leftover uploads into the
 *  new userData location (which survives updates) exactly once. Never
 *  throws — must not block startup. */
function migrateLegacyUploads() {
  if (!app.isPackaged) return
  const marker = path.join(app.getPath('userData'), 'uploads-migrated.json')
  try {
    if (fs.existsSync(marker)) return

    const legacyDir = path.join(process.resourcesPath, 'app', 'arca-data', 'uploads')
    const newDir    = path.join(app.getPath('userData'), 'arca-data', 'uploads')

    if (fs.existsSync(legacyDir)) {
      fs.mkdirSync(newDir, { recursive: true })
      for (const name of fs.readdirSync(legacyDir)) {
        const dest = path.join(newDir, name)
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(legacyDir, name), dest)
        }
      }
    }

    fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString() }))
  } catch (err) {
    console.error('[ARCA] Legacy uploads migration failed (non-fatal):', err)
  }
}

/** stdio target that logs the server's stdout/stderr to userData/server.log —
 *  a packaged GUI app has no attached console, so this is the only way to
 *  diagnose a startup failure (and doubles as an ongoing support artifact). */
function serverLogStdio() {
  try {
    const logPath = path.join(app.getPath('userData'), 'server.log')
    const fd = fs.openSync(logPath, 'a')
    return ['ignore', fd, fd]
  } catch (err) {
    console.error('[ARCA] Could not open server.log:', err)
    return 'ignore'
  }
}

function spawnServer(port) {
  const env   = buildServerEnv(port)
  const stdio = serverLogStdio()

  if (app.isPackaged) {
    // Standalone Next.js build bundled via electron-builder's extraResources
    // (see package.json → build.extraResources). Run it with a bundled real
    // Node.js binary (also an extraResource), NOT Electron's own Node runtime
    // (ELECTRON_RUN_AS_NODE): Electron embeds a different Node ABI than the
    // system Node used to `npm install` arca-app, so native modules like
    // better-sqlite3 crash with a NODE_MODULE_VERSION mismatch under
    // ELECTRON_RUN_AS_NODE. Bundling the same real Node.js binary sidesteps
    // that entirely — no per-platform native rebuild step needed.
    const serverEntry = path.join(process.resourcesPath, 'app', 'server.js')
    const nodeBinary   = path.join(process.resourcesPath, 'node', 'node.exe')
    return spawn(nodeBinary, [serverEntry], {
      cwd:      path.join(process.resourcesPath, 'app'),
      env,
      stdio,
      detached: process.platform !== 'win32',
    })
  }

  // Dev: run the arca-app source directly with the local `next` binary.
  const arcaAppDir = path.join(__dirname, '..', 'arca-app')
  const nextBin     = path.join(arcaAppDir, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next')
  return spawn(nextBin, ['dev', '-p', String(port)], {
    cwd:      arcaAppDir,
    env,
    stdio,
    detached: process.platform !== 'win32',
  })
}

/** Resolves true only if the response from 127.0.0.1:port carries our own
 *  app's marker header (see next.config.js → headers()) — proof that WE are
 *  the ones actually answering on this port, not just that our bind() call
 *  happened not to error. */
function verifyArcaResponding(port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.headers['x-arca-app'] === '1')
    })
    req.on('error',   () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function killChildProcess(child) {
  if (!child || child.killed) return
  const pid = child.pid
  if (process.platform === 'win32') {
    // child.kill() alone doesn't reliably reach the whole process tree on
    // Windows (next dev / next start can spawn workers) — force-kill the tree.
    exec(`taskkill /pid ${pid} /t /f`, () => {})
  } else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch {} }
  }
}

function trySpawnOnPort(port) {
  return new Promise((resolve) => {
    const child = spawnServer(port)
    let settled = false

    const onEarlyExit = () => {
      if (settled) return
      settled = true
      resolve(false)
    }
    child.once('exit', onEarlyExit)
    child.once('error', onEarlyExit)

    // Next.js standalone typically reports ready within ~100-300ms; an
    // EADDRINUSE crash happens within milliseconds of spawn. 2s is a
    // generous margin to tell the two apart without slowing startup much.
    setTimeout(async () => {
      if (settled) return

      // Our own listen() may have "succeeded" even though another process
      // already owns this port (see the comment above startNextServer) — the
      // only real proof is getting our own marker header back.
      const verified = await verifyArcaResponding(port)
      if (settled) return   // the child exited while we were checking

      settled = true
      child.removeListener('exit', onEarlyExit)
      child.removeListener('error', onEarlyExit)

      if (!verified) {
        console.warn(`[ARCA] Port ${port} answered but not from our server — releasing it`)
        killChildProcess(child)
        resolve(false)
        return
      }

      nextServerProcess = child
      nextServerProcess.on('error', (err) => console.error('[ARCA] Bundled server error:', err))
      nextServerProcess.on('exit', (code, signal) => {
        if (!isQuitting) console.warn(`[ARCA] Bundled server exited unexpectedly (code=${code}, signal=${signal})`)
        nextServerProcess = null
      })
      resolve(true)
    }, 2000)
  })
}

async function startNextServer(startPort, maxAttempts = 20) {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await trySpawnOnPort(port)) return port
    console.warn(`[ARCA] Port ${port} unavailable, trying ${port + 1}...`)
  }
  throw new Error(`Could not start the bundled server on any port in range ${startPort}-${startPort + maxAttempts - 1}`)
}

function stopNextServer() {
  killChildProcess(nextServerProcess)
  nextServerProcess = null
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
    // Compare origins, not exact strings — NEXT_URL has no trailing slash but
    // a failed navigation's url can come back as e.g. `${NEXT_URL}/`, which
    // would never match a strict `===` and silently skip the retry.
    try {
      if (new URL(url).origin === new URL(NEXT_URL).origin && code !== 0) scheduleRetry()
    } catch { /* not a parseable URL — ignore */ }
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
      preload:          path.join(__dirname, 'preload-onboarding.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
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

  const ok3 = globalShortcut.register('Alt+Space', () => {
    if (!win) return
    if (!win.isVisible()) { win.show(); win.focus() }
    win.webContents.send('spotlight-toggle')
  })
  if (!ok3) console.warn('[ARCA] Alt+Space taken by another app')
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

  // ── Spotlight open/close — centered on screen ──────────────────────────────
  ipcMain.on('spotlight-toggle', (_event, isOpen) => {
    if (!win) return
    const display = displayForWindow()
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea

    if (isOpen) {
      const [wx, wy] = win.getPosition()
      if (savedOrbX === null) {
        savedOrbX = wx
        savedOrbY = wy
      }

      win.setMinimumSize(600, 400)
      const newX = Math.round(dx + (dw - 600) / 2)
      const newY = Math.round(dy + (dh - 400) / 2)
      win.setBounds({ x: newX, y: newY, width: 600, height: 400 }, false)
      win.show()
      win.focus()
    } else {
      win.setMinimumSize(ORB_SIZE, ORB_SIZE)
      const x = savedOrbX ?? (dx + dw - ORB_SIZE - WIN_MARGIN)
      const y = savedOrbY ?? (dy + dh - ORB_SIZE - WIN_MARGIN)
      savedOrbX = null
      savedOrbY = null
      win.setBounds({ x, y, width: ORB_SIZE, height: ORB_SIZE }, false)
      savePosition()
    }
  })

  // ── Toast notification open/close ──────────────────────────────────────────
  ipcMain.on('toast-toggle', (_event, isOpen) => {
    if (!win) return
    const display = displayForWindow()
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea

    if (isOpen) {
      const [wx, wy] = win.getPosition()
      if (savedOrbX === null) {
        savedOrbX = wx
        savedOrbY = wy
      }

      win.setMinimumSize(320, 120)
      const newX = dx + dw - 320 - WIN_MARGIN
      const newY = dy + dh - 120 - WIN_MARGIN
      win.setBounds({ x: newX, y: newY, width: 320, height: 120 }, false)
      win.show()
    } else {
      win.setMinimumSize(ORB_SIZE, ORB_SIZE)
      const x = savedOrbX ?? (dx + dw - ORB_SIZE - WIN_MARGIN)
      const y = savedOrbY ?? (dy + dh - ORB_SIZE - WIN_MARGIN)
      savedOrbX = null
      savedOrbY = null
      win.setBounds({ x, y, width: ORB_SIZE, height: ORB_SIZE }, false)
      savePosition()
    }
  })

  ipcMain.handle('open-external', (_event, url) => {
    try {
      const parsed = new URL(String(url))
      if (['http:', 'https:'].includes(parsed.protocol)) {
        shell.openExternal(parsed.href)
        return
      }
      if (parsed.protocol === 'file:') {
        // Uploaded files are saved as file:// URLs (see ARCA_UPLOADS_PATH in
        // buildServerEnv) — only allow opening files that actually live
        // inside that folder, never an arbitrary path on disk.
        const { fileURLToPath } = require('url')
        const uploadsDir = path.join(app.getPath('userData'), 'arca-data', 'uploads')
        const target = path.normalize(fileURLToPath(parsed))
        if (target === uploadsDir || target.startsWith(uploadsDir + path.sep)) {
          shell.openPath(target)
        }
      }
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
    startClipboardPoll()
  })

  ipcMain.on('reset-onboarding', () => {
    try { fs.unlinkSync(configFile()) } catch {}
    if (win && !win.isDestroyed()) win.close()
    onboardingWin = createOnboardingWindow()
  })

  ipcMain.handle('get-config', () => {
    const cfg = loadConfig()
    if (!cfg) return cfg
    // adminSecret travels over IPC only — never written to arca-config.json.
    return { ...cfg, adminSecret: ADMIN_SECRET }
  })

  // ── Onboarding: verify a user-supplied Supabase project (runs the HTTPS
  // request in main so onboarding.html never needs raw Node `https` access) ──
  ipcMain.handle('verify-supabase', (_event, payload) => {
    const hostname = payload?.hostname
    const key      = payload?.key
    return new Promise((resolve) => {
      if (typeof hostname !== 'string' || !hostname || typeof key !== 'string' || !key) {
        resolve({ ok: false })
        return
      }
      if (!/^[a-z0-9-]+\.supabase\.co$/i.test(hostname)) {
        resolve({ ok: false })
        return
      }
      const req = https.request({
        hostname,
        path:    '/rest/v1/',
        method:  'GET',
        timeout: 8000,
        headers: {
          apikey:        key,
          Authorization: 'Bearer ' + key,
        },
      }, (res) => {
        res.resume()
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode })
      })
      req.on('error',   () => resolve({ ok: false }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false }) })
      req.end()
    })
  })
}

let lastClipboardUrl = ''
function startClipboardPoll() {
  setInterval(() => {
    try {
      if (!win || win.isDestroyed() || !win.isVisible()) return
      const text = clipboard.readText().trim()
      if (!text) return
      if (/^https?:\/\/[^\s]+$/i.test(text)) {
        if (text !== lastClipboardUrl) {
          lastClipboardUrl = text
          if (win && !win.isDestroyed()) {
            win.webContents.send('clipboard-detected', text)
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }, 1500)
}

// ── Permissions ────────────────────────────────────────────────────────────
// ARCA has no voice/mic feature — deny every permission request outright
// rather than maintaining an allowlist for capabilities the app never uses.
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
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

  registerIPC()
  migrateLegacyUploads()

  // Start arca-app's own server before loading any window into it, retrying
  // on the next port if one is already taken by another local project.
  const port = await startNextServer(DEFAULT_PORT).catch((err) => {
    console.error('[ARCA] Could not start bundled server:', err)
    return DEFAULT_PORT
  })
  NEXT_URL = `http://localhost:${port}`

  const config = loadConfig()
  if (config) {
    win  = createWindow(savedBounds)
    tray = createTray(win)
    registerShortcuts()
    startClipboardPoll()
  } else {
    createOnboardingWindow()
  }

  // ── Auto-update check ──────────────────────────────────────────────────
  // Never let a failed update check (offline, no published releases yet,
  // unsigned build, etc.) block or crash app startup.
  try {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[ARCA] Auto-update check failed:', err?.message || err)
    })
  } catch (err) {
    console.warn('[ARCA] Auto-update check failed:', err?.message || err)
  }
})

app.on('will-quit',         () => globalShortcut.unregisterAll())
app.on('before-quit',       () => { isQuitting = true; stopNextServer() })
app.on('activate',          () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (loadConfig()) win = createWindow()
    else onboardingWin = createOnboardingWindow()
  } else {
    win?.show(); win?.focus()
  }
})
app.on('window-all-closed', (e) => e.preventDefault())
