import { resolve, join, dirname } from 'path'

export const DB_PATH = resolve(process.env.ARCA_DB_PATH ?? './arca-data/arca.db')

// Uploads default to a sibling of the DB file, not a fixed `arca-data/uploads`
// under process.cwd() — in the packaged app, cwd is inside the app's own
// install directory, which electron-updater replaces wholesale on every
// update, wiping any files saved there. arca-desktop points ARCA_UPLOADS_PATH
// at a userData folder that survives updates (see main.js → buildServerEnv).
export const UPLOADS_DIR = process.env.ARCA_UPLOADS_PATH
  ? resolve(process.env.ARCA_UPLOADS_PATH)
  : join(dirname(DB_PATH), 'uploads')
