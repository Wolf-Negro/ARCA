const whatsapp = require('../services/whatsapp');
const openai = require('../services/openai');
const db = require('../services/database');
const fileHandler = require('../services/fileHandler');
const config = require('../config');

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────

async function handleMessage(msg) {
  console.log(`[DEBUG handler] handleMessage llamado | from: ${msg.from} | isIndividual: ${whatsapp.isIndividualChat(msg)}`);

  if (!whatsapp.isIndividualChat(msg)) {
    console.log(`[DEBUG handler] Mensaje descartado — no es chat individual: ${msg.from}`);
    return;
  }

  const phone = msg.from; // chatId completo: soporta @c.us y @lid
  const msgType = msg.type;
  const text = (msg.body ?? '').trim();

  console.log(`[handler] Mensaje de ${phone} | tipo: ${msgType} | texto: "${text.slice(0, 60)}"`);

  try {
    // ── 1. ¿Hay confirmación pendiente? ──
    const pending = await db.getPending(phone);
    if (pending && msgType === 'chat') {
      await handlePendingResponse(phone, text, pending);
      return;
    }

    // ── 2. ¿Tiene archivo adjunto? ──
    if (msg.hasMedia && ['document', 'image', 'video', 'audio', 'ptt'].includes(msgType)) {
      await handleFileUpload(phone, msg);
      return;
    }

    // ── 3. ¿Texto con URL? ──
    if (msgType === 'chat' && text) {
      const url = whatsapp.extractUrl(text);
      if (url) {
        await handleUrlUpload(phone, url);
        return;
      }

      // ── 4. Texto sin pendiente → detectar intención ──
      await handleTextMessage(phone, text);
    }
  } catch (err) {
    console.error(`[handler] Error procesando mensaje de ${phone}:`, err);
    await whatsapp.sendText(phone, '❌ Ocurrió un error. Intenta de nuevo.');
  }
}

// ──────────────────────────────────────────────
// Helpers de estado
// ──────────────────────────────────────────────

// Retorna true si el cliente no pudo detectarse
function needsClientName(metadata) {
  const name = (metadata.client_name ?? '').trim().toLowerCase();
  return !name || name === 'sin cliente';
}

// ──────────────────────────────────────────────
// Flujo 1A — Guardar archivo adjunto
// ──────────────────────────────────────────────

async function handleFileUpload(phone, msg) {
  await whatsapp.sendText(phone, '⏳ Analizando el archivo...');

  const media = await whatsapp.downloadMedia(msg);
  if (!media) {
    await whatsapp.sendText(phone, '❌ No pude descargar el archivo. Intenta enviarlo de nuevo.');
    return;
  }

  const { buffer, mimetype, filename } = media;

  const fileUrl = await db.uploadFileToStorage(buffer, filename, mimetype);
  const content = await fileHandler.processIncomingFile(buffer, mimetype, filename);
  const metadata = await openai.extractDocumentMetadata(content, filename);

  const displayName = metadata.file_name || filename;
  const fileInfo = { fileUrl, fileName: displayName, mimeType: mimetype, rawContent: content };

  if (needsClientName(metadata)) {
    await db.savePending(phone, { ...metadata, _awaiting_client: true }, fileInfo);
    const docType = metadata.doc_type || 'archivo';
    await whatsapp.sendText(phone, `¿A qué cliente pertenece este ${docType}?`);
    return;
  }

  await db.savePending(phone, metadata, fileInfo);
  await whatsapp.sendText(phone, buildSummaryMessage(metadata, displayName));
}

// ──────────────────────────────────────────────
// Flujo 1B — Guardar link/URL
// ──────────────────────────────────────────────

async function handleUrlUpload(phone, url) {
  await whatsapp.sendText(phone, '⏳ Analizando el link...');

  const content = await openai.fetchUrlContent(url);
  const rawFilename = url.split('/').pop().slice(0, 100) || '';
  const metadata = await openai.extractDocumentMetadata(content, rawFilename, { url });

  const displayName = metadata.file_name || rawFilename || url.slice(0, 60);
  const fileInfo = { fileUrl: url, fileName: displayName, mimeType: 'text/html', rawContent: content };

  if (needsClientName(metadata)) {
    await db.savePending(phone, { ...metadata, _awaiting_client: true }, fileInfo);
    const docType = metadata.doc_type || 'link';
    await whatsapp.sendText(phone, `¿A qué cliente pertenece este ${docType}?`);
    return;
  }

  await db.savePending(phone, metadata, fileInfo);
  await whatsapp.sendText(phone, buildSummaryMessage(metadata, displayName));
}

// ──────────────────────────────────────────────
// Flujo — Respuesta a confirmación pendiente
// ──────────────────────────────────────────────

async function handlePendingResponse(phone, text, pending) {
  const metadata = pending.proposed_metadata ?? {};

  // ── Estado: esperando nombre de cliente ──
  if (metadata._awaiting_client) {
    const updatedMetadata = { ...metadata };
    delete updatedMetadata._awaiting_client;
    updatedMetadata.client_name = text.trim();

    await db.savePending(phone, updatedMetadata, {
      fileUrl: pending.file_url,
      fileName: pending.file_name,
      mimeType: pending.mime_type,
      rawContent: pending.raw_content,
    });

    await whatsapp.sendText(phone, buildSummaryMessage(updatedMetadata, pending.file_name));
    return;
  }

  // ── Estado: esperando confirmación o corrección ──
  const intent = await openai.detectIntent(text);

  if (intent === 'confirm') {
    await saveConfirmedDocument(phone, pending, metadata);
    return;
  }

  if (intent === 'correction') {
    const updated = await openai.applyCorrectionsToMetadata(metadata, text);
    await db.savePending(phone, updated, {
      fileUrl: pending.file_url,
      fileName: pending.file_name,
      mimeType: pending.mime_type,
      rawContent: pending.raw_content,
    });
    const summary = formatMetadataSummary(updated, pending.file_name);
    await whatsapp.sendText(phone, `✏️ Actualizado:\n\n${summary}\n\n¿Lo guardo así?`);
    return;
  }

  await whatsapp.sendText(
    phone,
    'Responde *sí* para guardar o dime qué cambiar. Ejemplo: "el cliente es Martínez".'
  );
}

async function saveConfirmedDocument(phone, pending, metadata) {
  const embedParts = [
    metadata.client_name ?? '',
    metadata.doc_type ?? '',
    metadata.description ?? '',
    ...(metadata.tags ?? []),
  ];
  if (pending.raw_content) embedParts.push(pending.raw_content.slice(0, 3_000));

  const embedding = await openai.generateEmbedding(embedParts.join(' ').trim());
  if (!embedding) {
    await whatsapp.sendText(phone, '❌ Error generando índice. Intenta de nuevo.');
    return;
  }

  const saved = await db.saveDocument({
    metadata,
    embedding,
    uploadedBy: phone,
    fileUrl: pending.file_url,
    fileName: pending.file_name,
    mimeType: pending.mime_type,
    rawContent: pending.raw_content,
  });

  await db.deletePending(phone);

  await whatsapp.sendText(
    phone,
    saved
      ? `Guardado ✅`
      : '❌ Error al guardar. Intenta de nuevo.'
  );
}

// ──────────────────────────────────────────────
// Flujo 2 — Buscar / Comandos
// ──────────────────────────────────────────────

async function handleTextMessage(phone, text) {
  const intent = await openai.detectIntent(text);
  console.log(`[handler] Intención: "${intent}" | "${text.slice(0, 50)}"`);

  if (intent === 'command') {
    await handleCommand(phone, text);
  } else {
    // search + unknown → intentar búsqueda
    await handleSearch(phone, text);
  }
}

async function handleSearch(phone, query) {
  await whatsapp.sendText(phone, '🔍 Buscando...');

  const embedding = await openai.generateEmbedding(query);
  if (!embedding) {
    await whatsapp.sendText(phone, '❌ No pude procesar la búsqueda. Intenta de nuevo.');
    return;
  }

  const results = await db.searchDocuments(embedding, config.MAX_SEARCH_RESULTS);

  if (!results || results.length === 0) {
    await whatsapp.sendText(phone, '🔎 No encontré nada. ¿Puedes darme más detalles?');
    return;
  }

  if (results.length === 1) {
    await sendDocumentResult(phone, results[0]);
    return;
  }

  const lines = ['📂 *Encontré estos documentos:*\n'];
  results.forEach((doc, i) => {
    const client = doc.client_name || 'Sin cliente';
    const type = doc.doc_type || 'Documento';
    const desc = (doc.description || '').slice(0, 80);
    lines.push(`*${i + 1}.* ${type} — ${client}\n   _${desc}_`);
  });
  await whatsapp.sendText(phone, lines.join('\n'));

  for (const doc of results) {
    await sendDocumentResult(phone, doc, true);
  }
}

// Retorna true si el archivo está en Supabase Storage (no es un link externo)
function isStorageFile(url) {
  return url.includes('supabase');
}

async function sendDocumentResult(phone, doc, compact = false) {
  const fileUrl = doc.file_url;
  const fileName = doc.file_name || 'documento';
  const client = doc.client_name || 'Sin cliente';
  const type = doc.doc_type || 'Documento';
  const description = doc.description || '';
  const mimetype = doc.mime_type || '';
  const tags = doc.tags || [];

  if (!fileUrl) {
    await whatsapp.sendText(phone, `ℹ️ *${type}* — ${client}\n_(Sin archivo adjunto)_`);
    return;
  }

  // ── Link externo (Google Drive, Docs, Looker, etc.) → solo texto con URL ──
  if (!isStorageFile(fileUrl)) {
    const tagsStr = tags.length > 0 ? `🏷️ ${tags.join(', ')}` : '';
    const lines = [
      `🔗 *${type} — ${client}*`,
      description,
      tagsStr,
      '',
      fileUrl,
    ].filter(Boolean);
    await whatsapp.sendText(phone, lines.join('\n'));
    return;
  }

  // ── Archivo en Supabase Storage → enviar como adjunto ──
  let caption = `📄 *${type}* — ${client}`;
  if (description && !compact) caption += `\n${description}`;
  if (tags.length > 0 && !compact) caption += `\n🏷️ ${tags.join(', ')}`;

  if (mimetype.startsWith('image/')) {
    await whatsapp.sendImage(phone, fileUrl, caption);
  } else {
    await whatsapp.sendDocument(phone, fileUrl, fileName, caption);
  }
}

// ──────────────────────────────────────────────
// Comandos especiales
// ──────────────────────────────────────────────

async function handleCommand(phone, text) {
  const lower = text.toLowerCase().trim();

  if (/listar?\s*todo/i.test(lower) || lower === 'lista' || lower === 'listar') {
    await cmdListRecent(phone);
    return;
  }

  const clientMatch = lower.match(/documentos?\s+de\s+(.+)/i);
  if (clientMatch) {
    await cmdSearchByClient(phone, clientMatch[1].trim());
    return;
  }

  if (/ayuda|help|\?/.test(lower)) {
    await cmdHelp(phone);
    return;
  }

  await handleSearch(phone, text);
}

async function cmdListRecent(phone) {
  const docs = await db.getRecentDocuments(config.RECENT_DOCS_LIMIT);
  if (!docs.length) {
    await whatsapp.sendText(phone, '📭 No hay documentos guardados todavía.');
    return;
  }

  const lines = [`📂 *Últimos ${docs.length} documentos:*\n`];
  docs.forEach((doc, i) => {
    const client = doc.client_name || 'Sin cliente';
    const type = doc.doc_type || 'Documento';
    const fileName = doc.file_name || '';
    const date = (doc.created_at || '').slice(0, 10);
    lines.push(`*${i + 1}.* ${type} — ${client}\n   📎 ${fileName} | 📅 ${date}`);
  });
  await whatsapp.sendText(phone, lines.join('\n'));
}

async function cmdSearchByClient(phone, clientName) {
  const docs = await db.searchByClient(clientName);
  if (!docs.length) {
    await whatsapp.sendText(phone, `🔎 No encontré documentos de *${clientName}*.`);
    return;
  }

  const title = clientName.charAt(0).toUpperCase() + clientName.slice(1);
  const lines = [`📂 *Documentos de ${title}:*\n`];
  docs.forEach((doc, i) => {
    const type = doc.doc_type || 'Documento';
    const fileName = doc.file_name || '';
    const desc = (doc.description || '').slice(0, 60);
    lines.push(`*${i + 1}.* ${type} — ${fileName}\n   _${desc}_`);
  });
  await whatsapp.sendText(phone, lines.join('\n'));

  for (const doc of docs.slice(0, 3)) {
    await sendDocumentResult(phone, doc, true);
  }
}

async function cmdHelp(phone) {
  await whatsapp.sendText(
    phone,
    '🤖 *Bot de documentos*\n\n' +
    '📤 *Guardar:* envía un archivo o link\n' +
    '🔍 *Buscar:* "pásame el contrato de Martínez"\n\n' +
    '📋 *Comandos:*\n' +
    '• *listar todo*\n' +
    '• *documentos de [cliente]*\n' +
    '• *ayuda*'
  );
}

// ──────────────────────────────────────────────
// Helpers de formato
// ──────────────────────────────────────────────

function formatMetadataSummary(metadata, filename = '') {
  const tags = (metadata.tags ?? []).join(', ') || 'ninguna';
  return [
    `📄 *Nombre:* ${filename || 'Sin nombre'}`,
    `👤 *Cliente:* ${metadata.client_name || 'Sin cliente'}`,
    `📁 *Tipo:* ${metadata.doc_type || 'Sin tipo'}`,
    `📝 *Descripción:* ${metadata.description || 'Sin descripción'}`,
    `🏷️ *Etiquetas:* ${tags}`,
  ].join('\n');
}

function buildSummaryMessage(metadata, filename) {
  return (
    `📋 *Metadatos detectados:*\n\n` +
    `${formatMetadataSummary(metadata, filename)}\n\n` +
    `¿Lo guardo así o corriges algo?`
  );
}

module.exports = { handleMessage };
