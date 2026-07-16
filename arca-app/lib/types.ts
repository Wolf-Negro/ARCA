export interface DocumentMetadata {
  client_name: string | null
  doc_type:    string
  description: string
  tags:        string[]
  file_name:   string
}

// Canonical doc types the app understands (used by the rule-based classifier
// in lib/metadata.ts and as the closed set Gemini must choose from).
export const DOC_TYPES = [
  'Presentación',
  'Google Doc',
  'Google Sheet',
  'Google Slides',
  'Google Drive',
  'Dashboard / Reporte',
  'Creativo / Imagen',
  'Creativo / Video',
  'Brief de Campaña',
  'Métricas / Resultados',
  'Repositorio',
  'Credenciales',
  'Email Marketing',
  'Propuesta Comercial',
  'Hosting',
  'Presupuesto',
] as const
