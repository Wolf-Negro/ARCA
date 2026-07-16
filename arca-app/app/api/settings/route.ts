import { NextRequest, NextResponse } from 'next/server'
import { getGeminiKey, getGeminiKeySource, setGeminiKey, validateGeminiKey } from '@/lib/gemini'

// Local-only settings endpoint (protected, like every mutating route, by the
// Origin check in middleware.ts). The key never leaves this machine except
// toward Google's Gemini API.

export async function GET() {
  try {
    const source = getGeminiKeySource()
    const key    = source ? getGeminiKey() : null
    return NextResponse.json({
      gemini: {
        configured: source !== null,
        source,
        masked: key ? `••••${key.slice(-4)}` : null,
      },
    })
  } catch (err) {
    console.error('[/api/settings GET]', err)
    return NextResponse.json({ error: 'Error al leer la configuración' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { geminiApiKey } = body

    if (typeof geminiApiKey !== 'string') {
      return NextResponse.json({ error: 'Falta el campo geminiApiKey' }, { status: 400 })
    }

    const trimmed = geminiApiKey.trim()

    // Empty string = remove the stored key (env var, if set, still wins).
    if (!trimmed) {
      setGeminiKey('')
      return NextResponse.json({ ok: true, configured: getGeminiKeySource() !== null })
    }

    const check = await validateGeminiKey(trimmed)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.error }, { status: 422 })
    }

    setGeminiKey(trimmed)
    return NextResponse.json({ ok: true, configured: true })
  } catch (err) {
    console.error('[/api/settings POST]', err)
    return NextResponse.json({ error: 'Error al guardar la configuración' }, { status: 500 })
  }
}
