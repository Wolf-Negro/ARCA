import { describe, it, expect } from 'vitest'
import { isAllowedFile, ALLOWED_TYPES } from './uploadValidation'

describe('isAllowedFile', () => {
  it('accepts a PDF with the correct MIME type', () => {
    expect(isAllowedFile('presupuesto.pdf', 'application/pdf')).toBe(true)
  })

  it('accepts every extension/MIME pair declared in the whitelist', () => {
    for (const [ext, mimes] of Object.entries(ALLOWED_TYPES)) {
      for (const mime of mimes) {
        expect(isAllowedFile(`archivo${ext}`, mime)).toBe(true)
      }
    }
  })

  it('is case-insensitive for both extension and MIME type', () => {
    expect(isAllowedFile('IMAGEN.PNG', 'IMAGE/PNG')).toBe(true)
  })

  it('rejects a MIME type that does not match the extension', () => {
    expect(isAllowedFile('archivo.pdf', 'image/png')).toBe(false)
  })

  it('rejects an extension outside the whitelist', () => {
    expect(isAllowedFile('script.exe', 'application/octet-stream')).toBe(false)
  })

  it('rejects an extensionless filename', () => {
    expect(isAllowedFile('archivo', 'application/pdf')).toBe(false)
  })

  it('rejects a disguised executable using a double extension trick', () => {
    // extname() only looks at the last extension, so "malware.pdf.exe" is
    // correctly rejected because its real extension is ".exe".
    expect(isAllowedFile('malware.pdf.exe', 'application/pdf')).toBe(false)
  })
})
