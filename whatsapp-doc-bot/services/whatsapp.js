const { MessageMedia } = require('whatsapp-web.js');

let _client = null;

/**
 * Debe llamarse en index.js antes de usar cualquier otra función.
 */
function init(client) {
  _client = client;
}

/**
 * Formatea el número de teléfono al chatId de WhatsApp.
 * Acepta tanto "521234567890" como "521234567890@c.us".
 */
function toChatId(phone) {
  if (phone.includes('@')) return phone;
  return `${phone}@c.us`;
}

/**
 * Extrae el número limpio del `msg.from` (sin @c.us ni @g.us).
 */
function extractPhone(from) {
  return from.split('@')[0];
}

/**
 * Envía un mensaje de texto.
 */
async function sendText(phone, text) {
  try {
    await _client.sendMessage(toChatId(phone), text);
  } catch (err) {
    console.error(`[whatsapp] Error enviando texto a ${phone}:`, err.message);
  }
}

/**
 * Envía un documento (PDF, DOCX, XLSX, etc.) desde una URL pública de Supabase Storage.
 */
async function sendDocument(phone, fileUrl, filename, caption = '') {
  try {
    let media;
    if (fileUrl.startsWith('http')) {
      media = await MessageMedia.fromUrl(fileUrl, { unsafeMime: true });
      if (filename) media.filename = filename;
    } else {
      throw new Error('URL inválida para enviar documento');
    }
    await _client.sendMessage(toChatId(phone), media, {
      sendMediaAsDocument: true,
      caption,
    });
  } catch (err) {
    console.error(`[whatsapp] Error enviando documento a ${phone}:`, err.message);
    // Fallback: enviar solo el link en texto
    await sendText(phone, `📎 ${caption}\n🔗 ${fileUrl}`);
  }
}

/**
 * Envía una imagen desde una URL pública.
 */
async function sendImage(phone, imageUrl, caption = '') {
  try {
    const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
    await _client.sendMessage(toChatId(phone), media, { caption });
  } catch (err) {
    console.error(`[whatsapp] Error enviando imagen a ${phone}:`, err.message);
    await sendText(phone, `🖼️ ${caption}\n🔗 ${imageUrl}`);
  }
}

/**
 * Envía un archivo desde un Buffer en memoria.
 */
async function sendMediaFromBuffer(phone, buffer, mimetype, filename, caption = '', asDocument = true) {
  try {
    const base64 = buffer.toString('base64');
    const media = new MessageMedia(mimetype, base64, filename);
    await _client.sendMessage(toChatId(phone), media, {
      sendMediaAsDocument: asDocument,
      caption,
    });
  } catch (err) {
    console.error(`[whatsapp] Error enviando media (buffer) a ${phone}:`, err.message);
  }
}

/**
 * Descarga el archivo adjunto de un mensaje.
 * Retorna { buffer, mimetype, filename } o null si falla.
 */
async function downloadMedia(msg) {
  try {
    const media = await msg.downloadMedia();
    if (!media) return null;

    const buffer = Buffer.from(media.data, 'base64');
    const filename =
      msg.filename ||
      msg._data?.filename ||
      media.filename ||
      `file_${Date.now()}`;

    return {
      buffer,
      mimetype: media.mimetype || 'application/octet-stream',
      filename,
    };
  } catch (err) {
    console.error('[whatsapp] Error descargando media:', err.message);
    return null;
  }
}

/**
 * Detecta si el texto contiene una URL.
 * Retorna la primera URL encontrada o null.
 */
function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0] : null;
}

/**
 * Verifica si un mensaje proviene de un chat individual (no grupo).
 */
function isIndividualChat(msg) {
  return msg.from.endsWith('@c.us') || msg.from.endsWith('@lid');
}

module.exports = {
  init,
  extractPhone,
  sendText,
  sendDocument,
  sendImage,
  sendMediaFromBuffer,
  downloadMedia,
  extractUrl,
  isIndividualChat,
};
