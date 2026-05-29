const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const config = require('../config');

let _supabase = null;

function getClient() {
  if (!_supabase) {
    _supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
      realtime: { transport: WebSocket },
    });
  }
  return _supabase;
}

// ──────────────────────────────────────────────
// Documentos
// ──────────────────────────────────────────────

/**
 * Inserta un documento en la tabla documents.
 * Retorna el registro creado o null.
 */
async function saveDocument({
  metadata,
  embedding,
  uploadedBy,
  fileUrl = null,
  fileName = null,
  mimeType = null,
  rawContent = null,
}) {
  const db = getClient();
  const record = {
    uploaded_by: uploadedBy,
    client_name: metadata.client_name ?? null,
    doc_type: metadata.doc_type ?? 'otro',
    description: metadata.description ?? '',
    tags: metadata.tags ?? [],
    file_url: fileUrl,
    file_name: fileName,
    mime_type: mimeType,
    embedding,
    raw_content: (rawContent ?? '').slice(0, 50_000),
  };

  try {
    const { data, error } = await db.from('documents').insert(record).select().single();
    if (error) throw error;
    console.log(`[database] Documento guardado: ${data.id}`);
    return data;
  } catch (err) {
    console.error('[database] Error guardando documento:', err.message);
    return null;
  }
}

/**
 * Búsqueda semántica usando pgvector (RPC match_documents).
 * Retorna hasta `limit` resultados ordenados por similitud.
 */
async function searchDocuments(queryEmbedding, limit = 3) {
  const db = getClient();
  try {
    const { data, error } = await db.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: limit,
    });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('[database] Error en búsqueda semántica:', err.message);
    // Fallback: últimos documentos
    return getRecentDocuments(limit);
  }
}

/**
 * Filtra documentos por nombre de cliente (búsqueda parcial, case-insensitive).
 */
async function searchByClient(clientName) {
  const db = getClient();
  try {
    const { data, error } = await db
      .from('documents')
      .select('*')
      .ilike('client_name', `%${clientName}%`)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error(`[database] Error buscando cliente "${clientName}":`, err.message);
    return [];
  }
}

/**
 * Retorna los documentos más recientes.
 */
async function getRecentDocuments(limit = 10) {
  const db = getClient();
  try {
    const { data, error } = await db
      .from('documents')
      .select('id, created_at, client_name, doc_type, description, file_name, file_url, tags, mime_type')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('[database] Error obteniendo recientes:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Confirmaciones pendientes
// ──────────────────────────────────────────────

/**
 * Guarda (o reemplaza) la confirmación pendiente de un número.
 */
async function savePending(phone, metadata, fileInfo = {}) {
  const db = getClient();
  // Eliminar pendiente anterior
  await deletePending(phone);

  const record = {
    phone_number: phone,
    proposed_metadata: metadata,
    file_url: fileInfo.fileUrl ?? null,
    file_name: fileInfo.fileName ?? null,
    mime_type: fileInfo.mimeType ?? null,
    raw_content: (fileInfo.rawContent ?? '').slice(0, 20_000),
  };

  try {
    const { error } = await db.from('pending_confirmations').insert(record);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`[database] Error guardando pendiente para ${phone}:`, err.message);
    return false;
  }
}

/**
 * Obtiene la confirmación pendiente activa (no expirada) para un número.
 */
async function getPending(phone) {
  const db = getClient();
  try {
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('pending_confirmations')
      .select('*')
      .eq('phone_number', phone)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0] ?? null;
  } catch (err) {
    console.error(`[database] Error obteniendo pendiente para ${phone}:`, err.message);
    return null;
  }
}

/**
 * Elimina todas las confirmaciones pendientes de un número.
 */
async function deletePending(phone) {
  const db = getClient();
  try {
    const { error } = await db
      .from('pending_confirmations')
      .delete()
      .eq('phone_number', phone);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`[database] Error eliminando pendiente para ${phone}:`, err.message);
    return false;
  }
}

// ──────────────────────────────────────────────
// Storage (Supabase Storage)
// ──────────────────────────────────────────────

/**
 * Sube un archivo al bucket de Supabase Storage.
 * Retorna la URL pública o null si falla.
 */
async function uploadFileToStorage(buffer, filename, mimetype) {
  const db = getClient();
  const bucket = config.SUPABASE_BUCKET;

  try {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const ts = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${yyyy}/${mm}/${dd}/${ts}_${safeName}`;

    const { error: uploadError } = await db.storage
      .from(bucket)
      .upload(path, buffer, { contentType: mimetype, upsert: false });

    if (uploadError) throw uploadError;

    const { data } = db.storage.from(bucket).getPublicUrl(path);
    console.log(`[database] Archivo subido: ${path}`);
    return data.publicUrl;
  } catch (err) {
    console.error('[database] Error subiendo archivo a storage:', err.message);
    return null;
  }
}

module.exports = {
  saveDocument,
  searchDocuments,
  searchByClient,
  getRecentDocuments,
  savePending,
  getPending,
  deletePending,
  uploadFileToStorage,
};
