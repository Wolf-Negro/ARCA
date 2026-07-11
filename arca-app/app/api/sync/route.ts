import { NextRequest, NextResponse } from 'next/server'
import { triggerBackgroundSync, pullSupabaseChanges } from '@/lib/db'

export async function POST(_req: NextRequest) {
  try {
    // 1. Push any local unsynced changes to Supabase
    await triggerBackgroundSync()
    // 2. Pull recent changes from Supabase into local SQLite
    await pullSupabaseChanges()
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de sincronización'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
