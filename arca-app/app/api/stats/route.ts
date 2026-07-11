import { NextResponse } from 'next/server'
import { getMode, getStats, getStatsAsync } from '@/lib/db'

// Reads live SQLite state on every request — must never be statically
// prerendered at build time (that would freeze this dev machine's data into
// every packaged install forever).
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const stats = getMode() === 'team'
      ? await getStatsAsync()
      : getStats()
    return NextResponse.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
