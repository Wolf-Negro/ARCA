const { readImageContent } = require('./openai');

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

const SUPPORTED_DOC_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
]);

/**
 * Extrae el texto/contenido de un archivo según su tipo MIME.
 * @param {Buffer} buffer  - Contenido del archivo
 * @param {string} mimetype
 * @param {string} filename
 * @returns {Promise<string>} Texto extraído
 */
async function processIncomingFile(buffer, mimetype, filename = '') {
  const mime = mimetype.toLowerCase().split(';')[0].trim();

  if (mime === 'application/pdf') {
    return extractPdf(buffer);
  }

  if (SUPPORTED_IMAGE_TYPES.has(mime)) {
    return readImageContent(buffer, mime);
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) {
    return extractDocx(buffer);
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return extractXlsx(buffer);
  }

  if (mime === 'text/plain' || mime === 'text/csv') {
    return extractText(buffer);
  }

  console.warn(`[fileHandler] Tipo MIME no soportado: ${mime} (${filename})`);
  return `Archivo: ${filename}. Tipo: ${mime}. Contenido no extraíble automáticamente.`;
}

async function extractPdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || '';
    if (!text) return 'PDF sin texto extraíble (posiblemente escaneado)';
    console.log(`[fileHandler] PDF extraído: ${text.length} caracteres`);
    return text.slice(0, 10_000);
  } catch (err) {
    console.error('[fileHandler] Error extrayendo PDF:', err.message);
    return 'No se pudo extraer el contenido del PDF';
  }
}

async function extractDocx(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim() || '';
    console.log(`[fileHandler] DOCX extraído: ${text.length} caracteres`);
    return text.slice(0, 10_000) || 'Documento Word vacío';
  } catch (err) {
    console.error('[fileHandler] Error extrayendo DOCX:', err.message);
    return 'No se pudo extraer el contenido del documento Word';
  }
}

async function extractXlsx(buffer) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      parts.push(`[Hoja: ${sheetName}]`);

      // sheet_to_json con header:1 da arrays por fila
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let rowCount = 0;
      for (const row of rows) {
        if (rowCount >= 100) break;
        const cells = row.filter((c) => c !== '').map(String);
        if (cells.length > 0) {
          parts.push(cells.join(' | '));
          rowCount++;
        }
      }
    }

    const text = parts.join('\n');
    console.log(`[fileHandler] XLSX extraído: ${text.length} caracteres`);
    return text.slice(0, 10_000) || 'Archivo Excel vacío';
  } catch (err) {
    console.error('[fileHandler] Error extrayendo XLSX:', err.message);
    return 'No se pudo extraer el contenido del archivo Excel';
  }
}

function extractText(buffer) {
  try {
    const text = buffer.toString('utf-8').trim();
    return text.slice(0, 10_000) || 'Archivo de texto vacío';
  } catch {
    try {
      return buffer.toString('latin1').trim().slice(0, 10_000);
    } catch (err) {
      console.error('[fileHandler] Error leyendo texto:', err.message);
      return 'No se pudo leer el archivo de texto';
    }
  }
}

function isSupportedFile(mimetype) {
  const mime = mimetype.toLowerCase().split(';')[0].trim();
  return SUPPORTED_IMAGE_TYPES.has(mime) || SUPPORTED_DOC_TYPES.has(mime);
}

function isImage(mimetype) {
  return SUPPORTED_IMAGE_TYPES.has(mimetype.toLowerCase().split(';')[0].trim());
}

module.exports = {
  processIncomingFile,
  isSupportedFile,
  isImage,
};
