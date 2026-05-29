import { NextResponse } from 'next/server'
import { getMode, getStats, getStatsAsync } from '@/lib/db'

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
