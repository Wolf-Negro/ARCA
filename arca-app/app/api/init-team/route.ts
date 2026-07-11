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

    const { supabaseUrl, supabaseKey, teamId } = await req.json()

    if (!supabaseUrl || !supabaseKey || !teamId) {
      return NextResponse.json({ error: 'supabaseUrl, supabaseKey y teamId son requeridos' }, { status: 400 })
    }

    try {
      await assertSafeUrl(supabaseUrl)
    } catch (err) {
      const message = err instanceof UrlValidationError ? err.message : 'supabaseUrl inválida'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // Test the connection with team_id filter
    const testRes = await fetch(`${supabaseUrl}/rest/v1/documents?team_id=eq.${encodeURIComponent(teamId)}&limit=1`, {
      headers: {
        'apikey':        supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    })

    if (testRes.status === 401) {
      return NextResponse.json({ error: 'Clave incorrecta (401 Unauthorized)' }, { status: 400 })
    }

    if (testRes.status >= 500) {
      return NextResponse.json({ error: `Error del servidor Supabase (${testRes.status})` }, { status: 400 })
    }

    // Configure the db module
    setTeamConfig(supabaseUrl, supabaseKey, teamId)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'No se pudo conectar a Supabase' }, { status: 500 })
  }
}
