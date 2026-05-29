import { NextRequest, NextResponse } from 'next/server'
import { setTeamConfig } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { supabaseUrl, supabaseKey, teamId } = await req.json()

    if (!supabaseUrl || !supabaseKey || !teamId) {
      return NextResponse.json({ error: 'supabaseUrl, supabaseKey y teamId son requeridos' }, { status: 400 })
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
