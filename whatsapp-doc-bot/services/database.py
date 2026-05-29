import json
import logging
from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client
from config import Config

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None


def get_client() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)
    return _supabase_client


# ──────────────────────────────────────────────
# Documentos
# ──────────────────────────────────────────────

def save_document(
    metadata: dict,
    embedding: list[float],
    uploaded_by: str,
    file_url: Optional[str] = None,
    file_name: Optional[str] = None,
    mime_type: Optional[str] = None,
    raw_content: Optional[str] = None,
) -> Optional[dict]:
    """Inserta un documento en la tabla documents. Retorna el registro creado o None."""
    db = get_client()
    record = {
        "uploaded_by": uploaded_by,
        "client_name": metadata.get("client_name"),
        "doc_type": metadata.get("doc_type"),
        "description": metadata.get("description"),
        "tags": metadata.get("tags", []),
        "file_url": file_url,
        "file_name": file_name,
        "mime_type": mime_type,
        "embedding": embedding,
        "raw_content": (raw_content or "")[:50000],
    }
    try:
        result = db.table("documents").insert(record).execute()
        if result.data:
            logger.info("Documento guardado: %s", result.data[0].get("id"))
            return result.data[0]
        logger.error("Respuesta vacía al guardar documento")
        return None
    except Exception as e:
        logger.error("Error guardando documento: %s", e)
        return None


def search_documents(query_embedding: list[float], limit: int = 3) -> list[dict]:
    """
    Búsqueda semántica usando pgvector.
    Usa la función RPC match_documents definida en Supabase.
    """
    db = get_client()
    try:
        result = db.rpc(
            "match_documents",
            {
                "query_embedding": query_embedding,
                "match_threshold": 0.5,
                "match_count": limit,
            },
        ).execute()
        return result.data or []
    except Exception as e:
        logger.error("Error en búsqueda semántica: %s", e)
        # Fallback: búsqueda sin semántica (últimos documentos)
        return get_recent_documents(limit)


def search_by_client(client_name: str) -> list[dict]:
    """Filtra documentos por nombre de cliente (búsqueda parcial, case-insensitive)."""
    db = get_client()
    try:
        result = (
            db.table("documents")
            .select("*")
            .ilike("client_name", f"%{client_name}%")
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("Error buscando por cliente '%s': %s", client_name, e)
        return []


def get_recent_documents(limit: int = 10) -> list[dict]:
    """Retorna los documentos más recientes."""
    db = get_client()
    try:
        result = (
            db.table("documents")
            .select("id, created_at, client_name, doc_type, description, file_name, file_url, tags")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("Error obteniendo documentos recientes: %s", e)
        return []


def get_document_by_id(doc_id: str) -> Optional[dict]:
    db = get_client()
    try:
        result = db.table("documents").select("*").eq("id", doc_id).single().execute()
        return result.data
    except Exception as e:
        logger.error("Error obteniendo documento %s: %s", doc_id, e)
        return None


# ──────────────────────────────────────────────
# Confirmaciones pendientes
# ──────────────────────────────────────────────

def save_pending(
    phone: str,
    metadata: dict,
    file_url: Optional[str] = None,
    file_name: Optional[str] = None,
    mime_type: Optional[str] = None,
    raw_content: Optional[str] = None,
) -> bool:
    """Guarda una confirmación pendiente para un número de teléfono."""
    db = get_client()
    # Eliminar pendiente anterior si existe
    delete_pending(phone)

    record = {
        "phone_number": phone,
        "proposed_metadata": metadata,
        "file_url": file_url,
        "file_name": file_name,
        "mime_type": mime_type,
        "raw_content": (raw_content or "")[:20000],
    }
    try:
        result = db.table("pending_confirmations").insert(record).execute()
        return bool(result.data)
    except Exception as e:
        logger.error("Error guardando pendiente para %s: %s", phone, e)
        return False


def get_pending(phone: str) -> Optional[dict]:
    """Obtiene la confirmación pendiente activa para un número."""
    db = get_client()
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            db.table("pending_confirmations")
            .select("*")
            .eq("phone_number", phone)
            .gt("expires_at", now)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        data = result.data
        return data[0] if data else None
    except Exception as e:
        logger.error("Error obteniendo pendiente para %s: %s", phone, e)
        return None


def delete_pending(phone: str) -> bool:
    """Elimina todas las confirmaciones pendientes de un número."""
    db = get_client()
    try:
        db.table("pending_confirmations").delete().eq("phone_number", phone).execute()
        return True
    except Exception as e:
        logger.error("Error eliminando pendiente para %s: %s", phone, e)
        return False


# ──────────────────────────────────────────────
# Storage (archivos en Supabase Storage)
# ──────────────────────────────────────────────

def upload_file_to_storage(
    file_bytes: bytes,
    file_name: str,
    mime_type: str,
    bucket: str = "documents",
) -> Optional[str]:
    """
    Sube un archivo a Supabase Storage.
    Retorna la URL pública o None si falla.
    """
    db = get_client()
    try:
        path = f"{datetime.now(timezone.utc).strftime('%Y/%m/%d')}/{file_name}"
        db.storage.from_(bucket).upload(
            path,
            file_bytes,
            file_options={"content-type": mime_type},
        )
        public_url = db.storage.from_(bucket).get_public_url(path)
        logger.info("Archivo subido a storage: %s", path)
        return public_url
    except Exception as e:
        logger.error("Error subiendo archivo a storage: %s", e)
        return None
