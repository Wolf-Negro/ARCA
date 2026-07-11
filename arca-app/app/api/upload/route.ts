import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { isAllowedFile } from '@/lib/uploadValidation'

const UPLOADS_DIR = join(process.cwd(), 'arca-data', 'uploads')

export async function POST(req: NextRequest) {
  const MAX_BASE64_CHARS = Math.ceil(10 * 1024 * 1024 * 4 / 3)

  try {
    const body = await req.json()
    const { base64, filename, mimeType } = body

    if (!base64 || !filename || !mimeType) {
      return NextResponse.json({ error: 'Faltan parámetros: base64, filename, mimeType' }, { status: 400 })
    }

    if (typeof base64 !== 'string' || base64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: 'El archivo excede el límite de 10 MB' }, { status: 413 })
    }

    if (typeof filename !== 'string' || typeof mimeType !== 'string' || !isAllowedFile(filename, mimeType)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    }

    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

    const safeName = `${Date.now()}-${filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200)}`
    const filePath = join(UPLOADS_DIR, safeName)
    writeFileSync(filePath, Buffer.from(base64, 'base64'))

    return NextResponse.json({ url: `file://${filePath}` })
  } catch (err) {
    console.error('[/api/upload]', err)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: `Error al subir archivo: ${message}` }, { status: 500 })
  }
}
