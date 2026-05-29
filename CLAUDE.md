# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

ARCA is a two-tier document management assistant for marketing agencies:

- **arca-app** — Next.js 14 PWA (main UI, fully local/offline — no cloud APIs required)
- **arca-desktop** — Electron wrapper that hosts arca-app in a floating, always-on-top window with global hotkeys
- **whatsapp-doc-bot** — Separate Node.js WhatsApp bot that still uses Supabase + OpenAI (independent from arca-app)

> ⚠️ arca-app and whatsapp-doc-bot **no longer share a database**. arca-app is fully local (JSON file). The bot retains its own Supabase schema.

## Commands

### arca-app
```bash
npm run dev      # Dev server on :3000
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

### whatsapp-doc-bot
```bash
npm start    # Connect bot (shows QR on first run)
npm run dev  # node --watch for development
```

## Architecture

### arca-app: Local-First Data Layer

**There is no Supabase and no OpenAI in arca-app.** All data lives in a JSON flat file:

- **Path**: `./arca-data/arca.db.json` (overridable via `ARCA_DB_PATH` env var)
- **Uploads**: `./arca-data/uploads/` — files stored locally, referenced as `file://` URLs
- **`lib/db.ts`** — in-memory `Map<id, Document>` cache backed by the JSON file; all reads go through the cache, all writes flush to disk
- **`lib/openai.ts`** — shim that re-exports from `lib/metadata.ts` (no actual OpenAI calls)

**arca-app has no required environment variables** for local use. `ARCA_DB_PATH` is optional.

### arca-app: Metadata Extraction (Rule-Based, No LLM)

`lib/metadata.ts` infers doc type, file name, description, and tags using:
1. URL hostname pattern matching (google.com → "Google Doc", figma.com → "Creativo / Imagen", etc.)
2. MIME type mapping (PDF → "Presentación", XLSX → "Presupuesto", etc.)
3. OG tags scraped from fetched HTML (`lib/fileHandler.ts::fetchUrlContent`)

`lib/fileHandler.ts` handles text extraction (pdf-parse, mammoth, xlsx) and URL fetching with SSRF protection (blocked private IP ranges) and an auth-only domain fast-path that skips the HTTP fetch for services that always require login.

### arca-app: API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/save` | POST | Extract metadata + optionally persist. Returns `proposedMetadata` for user confirmation, or `needsClient` if client is unknown. Confirmed saves via `confirmed: true` flag. |
| `/api/search` | POST | Text search (fuzzy substring). Supports `listAll`, `listToday`, `listYesterday`, `countOnly`, `clientFilter`, `docTypeFilter`. |
| `/api/documents` | GET | Paginated library view (`page`, `limit`, `search`, `clientFilter`, `docTypeFilter`). |
| `/api/documents/[id]` | DELETE / PATCH | Delete or edit a document's metadata. |
| `/api/upload` | POST | Saves base64-encoded file to `arca-data/uploads/` and returns a `file://` URL. |
| `/api/stats` | GET | Aggregate counts by client and doc type. |

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

Global shortcuts: `Ctrl+Space` (toggle panel), `Ctrl+Shift+V` (open panel).

The desktop app has an onboarding flow: if no `arca-config.json` exists in userData, it shows `onboarding.html` first. The config is saved via `ipcMain.on('onboarding-complete')`.

### whatsapp-doc-bot: Architecture (Still Cloud-Based)

Still uses Supabase (`documents` + `pending_confirmations` tables) and OpenAI (GPT-4o-mini for metadata inference, `text-embedding-3-small` for pgvector semantic search).

Required env vars:
```
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_KEY        # service_role key (bypasses RLS)
SUPABASE_BUCKET     # Storage bucket name
```

Message flow: `index.js` → `handlers/messageHandler.js` → `services/{openai,database,fileHandler,whatsapp}.js`

Conversation state (pending confirmations) is stored in the `pending_confirmations` table with an `expires_at` TTL.

On Linux deployments (Railway/Render):
```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## Deployment

- **arca-app**: Vercel
- **arca-desktop**: GitHub Releases via electron-builder
- **whatsapp-doc-bot**: Railway or Render (needs persistent volume for `.wwebjs_auth/` WhatsApp session)
