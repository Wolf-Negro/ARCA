import { NextRequest, NextResponse } from 'next/server'
import { setTeamConfig } from '@/lib/db'
import { assertSafeUrl, UrlValidationError } from '@/lib/fileHandler'

export async function POST(req: NextRequest) {
  try {
    const adminSecret = process.env.ARCA_ADMIN_SECRET
    if (!adminSecret) {
      return NextResponse.json({ error: 'ARCA_ADMIN_SECRET no está configurado' }, { status: 503 })
    }
    if (req.headers.get('x-arca-admin-secret') !== adminSecret) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { supabaseUrl, supabaseKey, teamId, anonKey } = await req.json()

    if (!supabaseUrl || !supabaseKey || !teamId) {
      return NextResponse.json({ error: 'supabaseUrl, supabaseKey y teamId son requeridos' }, { status: 400 })
    }

    try {
      await assertSafeUrl(supabaseUrl)
    } catch (err) {
      const message = err instanceof UrlValidationError ? err.message : 'supabaseUrl inválida'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // Test the connection with team_id filter. apikey must be the project's
    // anon key (falls back to supabaseKey for pre-JWT configs); Authorization
    // carries the per-agency JWT that RLS actually checks.
    const testRes = await fetch(`${supabaseUrl}/rest/v1/documents?team_id=eq.${encodeURIComponent(teamId)}&limit=1`, {
      headers: {
        'apikey':        anonKey || supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      signal: AbortSignal.timeout(10000),
    })

    // Anything non-2xx means team mode would be broken (401 bad key, 403
    // RLS-rejected JWT, 404 not a Supabase REST URL...) — refuse to persist
    // a config that can't read its own documents table.
    if (!testRes.ok) {
      return NextResponse.json({ error: `Supabase rechazó la conexión (${testRes.status})` }, { status: 400 })
    }

    // Configure the db module
    setTeamConfig(supabaseUrl, supabaseKey, teamId, anonKey)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'No se pudo conectar a Supabase' }, { status: 500 })
  }
}
