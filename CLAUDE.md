# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

ARCA is a desktop-first document management assistant for marketing agencies:

- **arca-app** — Next.js 14 PWA (main UI), hosted locally by arca-desktop on `localhost:3000`. Fully local/offline by default — no cloud APIs required.
- **arca-desktop** — Electron wrapper that hosts arca-app in a floating, always-on-top window with global hotkeys.
- **arca-panel** — Next.js admin panel (deployed on Vercel) that issues and validates agency/team activation codes consumed by `arca-desktop/onboarding.html`. Has its own Supabase-backed store, independent of arca-app's local data.

> There used to be a separate `whatsapp-doc-bot` (Node.js, Supabase + OpenAI). It has been removed — the product is desktop-only now.

## Commands

### arca-app
```bash
npm run dev      # Dev server on :3000 (binds to 127.0.0.1 only)
npm run build    # Production build
npm run lint     # ESLint
```

### arca-desktop
```bash
npm start        # Launch Electron (requires arca-app running on :3000)
npm run build:win   # Windows NSIS installer
npm run build:mac   # macOS DMG
npm run build:linux # Linux AppImage
```

### arca-panel
```bash
npm run dev      # Dev server (used as local fallback for onboarding activation)
npm run build    # Production build
```

## Architecture

### arca-app: Local-First Data Layer

**No OpenAI is used in arca-app.** Data lives in a local SQLite database (via `better-sqlite3`, WAL mode):

- **Path**: `./arca-data/arca.db` (overridable via `ARCA_DB_PATH` env var)
- **Uploads**: `./arca-data/uploads/` — files stored locally, referenced as `file://` URLs
- **`lib/db.ts`** — wraps the SQLite connection; also implements an optional **team mode** that syncs documents to a Supabase project (`app/api/init-team/route.ts` configures `supabaseUrl`/`supabaseKey`/`teamId`, protected by the `ARCA_ADMIN_SECRET` header). Team mode is opt-in; local SQLite is the default and requires no cloud config.
- **`lib/openai.ts`** — shim that re-exports from `lib/metadata.ts` (no actual OpenAI calls)

**arca-app has no required environment variables** for local-only use. `ARCA_DB_PATH` is optional. `ARCA_ADMIN_SECRET` is required only to enable the `/api/init-team` endpoint (team/Supabase sync mode).

### arca-app: Metadata Extraction (Rule-Based, No LLM)

`lib/metadata.ts` infers doc type, file name, description, and tags using:
1. URL hostname pattern matching (google.com → "Google Doc", figma.com → "Creativo / Imagen", etc.)
2. MIME type mapping (PDF → "Presentación", XLSX → "Presupuesto", etc.)
3. OG tags scraped from fetched HTML (`lib/fileHandler.ts::fetchUrlContent`)

`lib/fileHandler.ts` handles text extraction (pdf-parse, mammoth, xlsx) and URL fetching. `assertSafeUrl` (async) blocks SSRF: it rejects private/loopback/link-local hostnames by string match AND resolves DNS (`dns.promises.lookup`, all records) to reject hosts that resolve to a private/internal IP (DNS-rebinding protection). There's also an auth-only domain fast-path that skips the HTTP fetch for services that always require login.

### arca-app: API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/save` | POST | Extract metadata + optionally persist. Returns `proposedMetadata` for user confirmation, or `needsClient` if client is unknown. Confirmed saves via `confirmed: true` flag. |
| `/api/search` | POST | Text search (fuzzy substring). Supports `listAll`, `listToday`, `listYesterday`, `countOnly`, `clientFilter`, `docTypeFilter`. |
| `/api/documents` | GET | Paginated library view (`page`, `limit`, `search`, `clientFilter`, `docTypeFilter`). |
| `/api/documents/[id]` | DELETE / PATCH | Delete or edit a document's metadata. |
| `/api/documents/[id]/pin` | POST | Toggle `pinned` on a document (pinned docs sort first). |
| `/api/upload` | POST | Validates extension + declared MIME type against a whitelist, saves base64-encoded file to `arca-data/uploads/`, returns a `file://` URL. |
| `/api/init-team` | POST | Configures team/Supabase sync mode. Requires `x-arca-admin-secret` header matching `ARCA_ADMIN_SECRET` (503 if unset, 403 if wrong); validates `supabaseUrl` via `assertSafeUrl` before connecting. |
| `/api/sync` | POST | Pushes local unsynced changes to Supabase, then pulls remote changes into local SQLite (team mode). |
| `/api/stats` | GET | Aggregate counts by client and doc type. |

### arca-app: Security

- **`middleware.ts`** (root) — defense against drive-by-localhost / DNS-rebinding attacks: rejects (403) any mutating request (POST/PATCH/PUT/DELETE) to `/api/:path*` whose `Origin` header is present but isn't `http://localhost:3000` or `http://127.0.0.1:3000`. Requests with no `Origin` header (same-origin fetches from Electron) pass through — there is no user-login system, this is the whole authorization layer for document mutations.
- `dev`/`start` scripts bind to `-H 127.0.0.1` (loopback only, not `0.0.0.0`).
- `/api/init-team` is the one endpoint that reconfigures where data syncs to, so it's gated separately by `ARCA_ADMIN_SECRET` (see API table above).

### arca-app: UI State Machine

**`ArcaProvider.tsx`** is the root client component mounted in `layout.tsx`. All UI state lives here:

- `ParticleOrb` — canvas animation with 5 states: `idle | listening | processing | responding | success`. State is driven by chat activity.
- `ChatPanel` — opens/closes on orb click. Notifies Electron via `window.electronAPI?.panelToggle(isOpen)`, which resizes the window between **150×150 (orb mode)** and **420×650 (panel mode)**.
- `LibraryView` — full document browser with search/filter/edit/delete, opens as overlay.
- `StatsView` — aggregate stats, can navigate to LibraryView with a filter applied.

**`hooks/useChat.ts`** is the core command parser and state machine. It handles:
- URL detection → `POST /api/save` flow with 3-step confirmation (propose → client? → confirm)
- Text commands parsed by regex (no LLM) for list/search/open/copy/stats/library/count
- File drag-drop → `POST /api/upload` → `POST /api/save` flow
- `pendingMetadata` + `pendingFileData` state for the confirm-before-save pattern
- Message history navigation (up/down arrow, last 5 messages)

### arca-desktop ↔ arca-app Integration

`preload.js` exposes `window.electronAPI` via `contextBridge`. Key IPC channels:

| Channel | Direction | Purpose |
|---|---|---|
| `panel-toggle` | app → main | Resize window: `true` = 420×650 panel, `false` = 150×150 orb |
| `move-window` | app → main | Manual drag via mouse delta |
| `snap-to-edge` | app → main | Cubic ease-out snap animation to nearest screen edge |
| `activate-voice` | main → app | Sent on `Ctrl+Shift+V` global shortcut — opens the panel |
| `doc-saved` | app → main | Updates tray tooltip to show save confirmation |
| `open-auth` | app → main | Opens a sandboxed Google OAuth popup window |
| `open-external` | app → main | Opens URLs in system browser via `shell.openExternal` |

Global shortcuts: `Ctrl+Space` (toggle panel), `Ctrl+Shift+V` (open panel), `Alt+Space` (spotlight search).

The desktop app has an onboarding flow: if no `arca-config.json` exists in userData, it shows `onboarding.html` first, in its own `BrowserWindow` with `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` (like every other window) backed by `preload-onboarding.js`. That preload exposes only `sendOnboardingComplete`, `openExternal`, and `verifySupabase` (the Supabase credential check happens in the main process via `ipcMain.handle('verify-supabase', ...)`, not via `require('https')` in the renderer). The config is saved via `ipcMain.on('onboarding-complete')`.

Auto-update: `electron-updater` calls `autoUpdater.checkForUpdatesAndNotify()` on `app.whenReady()` (best-effort, wrapped so a failed check never blocks startup), publishing to GitHub Releases (`build.publish` in `package.json`, `Wolf-Negro/ARCA`). Code signing is **not configured** — installers are unsigned until real certificates (Windows EV/OV, macOS Developer ID + notarization) are added.

### arca-panel: Team Activation

Standalone Next.js app (Next 16) deployed on Vercel. Validates activation codes for agencies/teams (`POST /api/activate`) and returns the Supabase credentials arca-desktop's onboarding flow needs to enable team mode. Has its own admin login gating everything except `/login`, `/api/activate`, `/api/auth`, `/api/logout`.

Session auth (`lib/session.ts`): signed token `payload.signature` where `signature = HMAC-SHA256(payload, PANEL_SESSION_SECRET)`, verified with `crypto.timingSafeEqual`. Route protection lives in **`proxy.ts`** (not `middleware.ts`) — Next 16 runs `middleware.ts` on the Edge runtime by default, which doesn't support Node's `crypto`; `proxy.ts` always runs on the Node runtime. Requires `PANEL_SESSION_SECRET` env var (separate secret from `PANEL_ADMIN_PASSWORD`, never derive one from the other).

## Deployment

- **arca-app**: bundled with arca-desktop (not deployed to Vercel as a standalone site); runs on `127.0.0.1:3000`
- **arca-desktop**: GitHub Releases via electron-builder
- **arca-panel**: Vercel
