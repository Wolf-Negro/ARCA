import Database from 'better-sqlite3'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { DB_PATH } from './paths'

const BACKUPS_DIR  = join(dirname(DB_PATH), 'backups')
const MAX_BACKUPS  = 14

function backupFileName(): string {
  // ISO timestamp with characters invalid in filenames (":" ) stripped/replaced.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `arca-${stamp}.db`
}

function rotateBackups(): void {
  const files = readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith('arca-') && f.endsWith('.db'))
    .map(f => {
      const full = join(BACKUPS_DIR, f)
      return { name: f, full, mtime: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime) // newest first

  const stale = files.slice(MAX_BACKUPS)
  for (const f of stale) {
    try {
      unlinkSync(f.full)
    } catch {
      // Ignore individual deletion failures; not critical.
    }
  }
}

/**
 * Creates a backup copy of the SQLite database and rotates old backups,
 * keeping only the most recent MAX_BACKUPS. Safe to call once per process
 * startup. Never throws — callers should still wrap in try/catch as an
 * extra safety net since this touches the filesystem.
 */
export function runBackup(): void {
  if (!existsSync(DB_PATH)) return // Nothing to back up yet (fresh install).

  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true })

  const destPath = join(BACKUPS_DIR, backupFileName())

  // Prefer better-sqlite3's native .backup() — it uses SQLite's online backup
  // API, which is safe against concurrent writes (won't capture a half-written
  // page like a raw file copy could).
  let source: Database.Database | null = null
  try {
    source = new Database(DB_PATH, { readonly: true, fileMustExist: true })
    // .backup() returns a Promise; we run it fire-and-forget but still
    // catch failures so a rejected promise never becomes an unhandled
    // rejection or crashes the process.
    source
      .backup(destPath)
      .catch(() => {
        // Fall back to a plain file copy if the native backup fails.
        try {
          copyFileSync(DB_PATH, destPath)
        } catch {
          // Give up silently; backups are best-effort.
        }
      })
      .finally(() => {
        try {
          source?.close()
        } catch {
          // ignore
        }
        // A throw here (e.g. statSync ENOENT inside rotateBackups on a file
        // deleted concurrently) would reject this promise with no handler
        // attached → unhandledRejection → process crash. Backups are
        // best-effort; swallow it.
        try {
          rotateBackups()
        } catch {
          // ignore
        }
      })
  } catch {
    // Could not open DB via better-sqlite3 (e.g. locked) — fall back to a
    // direct file copy.
    try {
      copyFileSync(DB_PATH, destPath)
    } catch {
      // Give up silently; backups are best-effort.
    }
    try {
      source?.close()
    } catch {
      // ignore
    }
    rotateBackups()
  }
}
