import { extname } from 'path'

// Whitelist kept in sync with what lib/fileHandler.ts and lib/metadata.ts actually
// process: PDFs, Office docs, spreadsheets, presentations, images, and plain text.
export const ALLOWED_TYPES: Record<string, string[]> = {
  '.pdf':  ['application/pdf'],
  '.doc':  ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls':  ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt':  ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.jpg':  ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png':  ['image/png'],
  '.webp': ['image/webp'],
  '.gif':  ['image/gif'],
  '.txt':  ['text/plain'],
}

export function isAllowedFile(filename: string, mimeType: string): boolean {
  const ext = extname(filename).toLowerCase()
  const allowedMimes = ALLOWED_TYPES[ext]
  return !!allowedMimes && allowedMimes.includes(mimeType.toLowerCase())
}
