const OpenAI = require('openai');
const axios = require('axios');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// ──────────────────────────────────────────────
// Prompts del sistema
// ──────────────────────────────────────────────

const METADATA_SYSTEM_PROMPT = `Eres un asistente especializado en organizar archivos de una agencia de marketing digital. Analizas links y documentos para extraer metadatos precisos.

TIPOS DE DOCUMENTOS QUE MANEJA UNA AGENCIA:
- Google Drive (docs, sheets, slides, forms)
- Reportes (Google Analytics, Meta Ads, Google Ads, Data Studio/Looker)
- Dashboards (links de reportes, datastudio, looker studio)
- Propuestas comerciales y presupuestos
- Contratos y acuerdos
- Creativos (imágenes, banners, videos)
- Calendarios de contenido
- Briefs de campaña
- Métricas y resultados
- Facturas y pagos
- Presentaciones de cliente

REGLAS ESTRICTAS:
1. doc_type NUNCA puede ser 'otro' ni 'link'. Deduce el tipo real del contenido.
2. Si la URL contiene 'docs.google.com' → tipo: 'Google Doc'
3. Si la URL contiene 'sheets.google.com' → tipo: 'Google Sheet'
4. Si la URL contiene 'drive.google.com' → tipo: 'Google Drive'
5. Si la URL contiene 'datastudio' o 'lookerstudio' → tipo: 'Dashboard / Reporte'
6. Si la URL contiene 'slides.google.com' → tipo: 'Presentación'
7. Si el contexto menciona 'dashboard', 'reporte', 'métricas' → tipo: 'Dashboard / Reporte'
8. Si el contexto menciona 'propuesta', 'presupuesto', 'cotización' → tipo: 'Propuesta'
9. Si el contexto menciona 'contrato', 'acuerdo' → tipo: 'Contrato'
10. Si el contexto menciona 'calendario', 'contenido', 'pauta' → tipo: 'Calendario de Contenido'
11. file_name debe ser descriptivo, nunca 'link' ni 'documento'. Ejemplo: 'Dashboard Ari - Alucinando', 'Reporte Meta Ads Marzo', 'Propuesta Claro 2024'
12. description debe ser una oración clara y útil de máximo 20 palabras
13. tags debe incluir: plataforma (Meta, Google, TikTok si aplica), tipo de contenido, y palabras clave del cliente

Responde SOLO con JSON válido, sin markdown, sin explicaciones.`;

const INTENT_SYSTEM_PROMPT = `Eres un clasificador de intenciones para un bot de gestión de documentos.
Clasifica el mensaje del usuario en exactamente una de estas categorías:

- "search": el usuario quiere buscar o recuperar un documento (ej: "pásame el contrato de...", "dame el archivo de...", "busca el logo de...")
- "confirm": el usuario confirma o acepta algo (ej: "sí", "ok", "dale", "perfecto", "correcto", "guardá", "listo", "sí guardalo")
- "correction": el usuario quiere corregir algo (ej: "el cliente es...", "cambia el tipo a...", "la descripción debería ser...")
- "command": el usuario usa un comando especial (ej: "listar todo", "documentos de [cliente]", "ayuda")
- "unknown": no encaja en ninguna categoría anterior

Responde ÚNICAMENTE con el nombre de la categoría (una sola palabra en minúsculas).`;

const CORRECTIONS_SYSTEM_PROMPT = `Eres un asistente que actualiza metadatos de documentos según las instrucciones del usuario.

Dado un JSON de metadatos actuales y las correcciones del usuario, retorna el JSON actualizado.
Mantén los campos que no se mencionen y actualiza solo los indicados.

Responde ÚNICAMENTE con el JSON actualizado, sin texto adicional.`;

// ──────────────────────────────────────────────
// Funciones principales
// ──────────────────────────────────────────────

/**
 * Extrae metadatos estructurados del contenido de un documento.
 * @param {string} content     - Texto extraído del archivo o URL
 * @param {string} filename    - Nombre original del archivo
 * @param {object} options     - { url, userMessage } opcionales para contexto extra
 * Retorna { client_name, doc_type, file_name, description, tags }
 */
async function extractDocumentMetadata(content, filename = '', { url = '', userMessage = '' } = {}) {
  try {
    const userPrompt =
      `Analiza este contenido y extrae los metadatos:\n` +
      `URL: ${url || 'N/A'}\n` +
      `Nombre del archivo: ${filename || 'N/A'}\n` +
      `Mensaje del usuario: ${userMessage || 'N/A'}\n` +
      `Contenido extraído: ${content.slice(0, 7000)}\n\n` +
      `Responde con este JSON exacto:\n` +
      `{\n` +
      `  "client_name": null,\n` +
      `  "doc_type": "tipo específico aquí",\n` +
      `  "file_name": "nombre descriptivo aquí",\n` +
      `  "description": "descripción clara en una oración",\n` +
      `  "tags": ["tag1", "tag2", "tag3"]\n` +
      `}`;

    const response = await openai.chat.completions.create({
      model: config.OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: METADATA_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0].message.content;
    const metadata = JSON.parse(raw);

    // Sanidad: doc_type nunca debe quedar como 'otro' o 'link'
    let docType = (metadata.doc_type ?? '').trim();
    if (!docType || docType.toLowerCase() === 'otro' || docType.toLowerCase() === 'link') {
      docType = _inferDocTypeFromUrl(url);
    }

    return {
      client_name: metadata.client_name ?? null,
      doc_type: docType,
      file_name: (metadata.file_name ?? filename).trim() || filename,
      description: (metadata.description ?? '').trim(),
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    };
  } catch (err) {
    console.error('[openai] Error en extractDocumentMetadata:', err.message);
    return {
      client_name: null,
      doc_type: _inferDocTypeFromUrl(url),
      file_name: filename,
      description: '',
      tags: [],
    };
  }
}

function _inferDocTypeFromUrl(url = '') {
  if (url.includes('docs.google.com'))    return 'Google Doc';
  if (url.includes('sheets.google.com'))  return 'Google Sheet';
  if (url.includes('slides.google.com'))  return 'Presentación';
  if (url.includes('drive.google.com'))   return 'Google Drive';
  if (url.includes('datastudio') || url.includes('lookerstudio')) return 'Dashboard / Reporte';
  return 'Documento';
}

/**
 * Detecta la intención del mensaje.
 * Retorna: "search" | "confirm" | "correction" | "command" | "unknown"
 */
async function detectIntent(text) {
  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const intent = response.choices[0].message.content.trim().toLowerCase();
    const valid = new Set(['search', 'confirm', 'correction', 'command', 'unknown']);
    if (!valid.has(intent)) {
      console.warn(`[openai] Intención inválida: "${intent}", usando "unknown"`);
      return 'unknown';
    }
    return intent;
  } catch (err) {
    console.error('[openai] Error en detectIntent:', err.message);
    return 'unknown';
  }
}

/**
 * Genera un embedding de 1536 dimensiones con text-embedding-3-small.
 * Retorna el vector o null si falla.
 */
async function generateEmbedding(text) {
  try {
    const cleanText = text.replace(/\n/g, ' ').trim().slice(0, 8000);
    if (!cleanText) return null;

    const response = await openai.embeddings.create({
      model: config.OPENAI_EMBEDDING_MODEL,
      input: cleanText,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.error('[openai] Error generando embedding:', err.message);
    return null;
  }
}

/**
 * Extrae texto/descripción de una imagen usando GPT-4o-mini vision.
 */
async function readImageContent(buffer, mimetype) {
  try {
    const base64 = buffer.toString('base64');
    const imageDataUrl = `data:${mimetype};base64,${base64}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analiza esta imagen y proporcioná:\n1. Una descripción detallada del contenido\n2. Si es un logo, identificá la empresa\n3. Si contiene texto, transcribilo\n4. Contexto relevante para clasificación documental\nRespondé en español.',
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    return response.choices[0].message.content;
  } catch (err) {
    console.error('[openai] Error leyendo imagen:', err.message);
    return 'Imagen sin contenido extraíble';
  }
}

/**
 * Aplica correcciones del usuario a los metadatos propuestos.
 */
async function applyCorrectionsToMetadata(originalMetadata, correctionText) {
  try {
    const userMessage =
      `Metadatos actuales:\n${JSON.stringify(originalMetadata, null, 2)}\n\n` +
      `Correcciones del usuario:\n${correctionText}`;

    const response = await openai.chat.completions.create({
      model: config.OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: CORRECTIONS_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const updated = JSON.parse(response.choices[0].message.content);
    return {
      client_name: updated.client_name ?? originalMetadata.client_name,
      doc_type: updated.doc_type ?? originalMetadata.doc_type,
      description: updated.description ?? originalMetadata.description,
      tags: Array.isArray(updated.tags) ? updated.tags : originalMetadata.tags,
    };
  } catch (err) {
    console.error('[openai] Error aplicando correcciones:', err.message);
    return originalMetadata;
  }
}

/**
 * Descarga el contenido textual de una URL.
 */
async function fetchUrlContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocBot/2.0)' },
      responseType: 'text',
    });

    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      // Extracción básica de texto desde HTML
      return response.data
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 8000);
    }

    return String(response.data).slice(0, 8000);
  } catch (err) {
    console.error(`[openai] Error descargando URL ${url}:`, err.message);
    return `No se pudo acceder al contenido de la URL: ${url}`;
  }
}

module.exports = {
  extractDocumentMetadata,
  detectIntent,
  generateEmbedding,
  readImageContent,
  applyCorrectionsToMetadata,
  fetchUrlContent,
};
