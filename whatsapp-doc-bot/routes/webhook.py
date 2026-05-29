import logging
import threading
from flask import Blueprint, request, jsonify
from config import Config
import services.whatsapp as wa
import services.openai_service as ai
import services.database as db
import services.file_handler as fh

logger = logging.getLogger(__name__)
webhook_bp = Blueprint("webhook", __name__)


# ──────────────────────────────────────────────
# Verificación de Meta
# ──────────────────────────────────────────────

@webhook_bp.route("/webhook", methods=["GET"])
def verify_webhook():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == Config.WHATSAPP_VERIFY_TOKEN:
        logger.info("Webhook verificado correctamente")
        return challenge, 200

    logger.warning("Fallo en verificación del webhook (token incorrecto)")
    return jsonify({"error": "Token de verificación incorrecto"}), 403


# ──────────────────────────────────────────────
# Recepción de mensajes
# ──────────────────────────────────────────────

@webhook_bp.route("/webhook", methods=["POST"])
def receive_message():
    payload = request.get_json(silent=True) or {}

    # Responder 200 OK a WhatsApp inmediatamente
    thread = threading.Thread(target=_process_message, args=(payload,), daemon=True)
    thread.start()

    return jsonify({"status": "ok"}), 200


# ──────────────────────────────────────────────
# Procesamiento en background
# ──────────────────────────────────────────────

def _process_message(payload: dict):
    try:
        parsed = wa.parse_webhook_message(payload)
        if not parsed:
            return  # no es un mensaje de usuario, puede ser status update

        phone = parsed["phone_number"]
        msg_type = parsed["message_type"]
        text = parsed.get("text", "")
        media_id = parsed.get("media_id")
        filename = parsed.get("filename", "documento")
        mime_type = parsed.get("mime_type", "")

        logger.info("Mensaje de %s | tipo: %s", phone, msg_type)

        # ── Verificar si hay una confirmación pendiente ──
        pending = db.get_pending(phone)

        if pending and msg_type == "text":
            _handle_pending_response(phone, text, pending)
            return

        # ── Mensaje con archivo ──
        if msg_type in ("document", "image", "video", "audio") and media_id:
            _handle_file_upload(phone, media_id, filename, mime_type)
            return

        # ── Mensaje de texto sin pendiente ──
        if msg_type == "text" and text:
            # Detectar si el texto contiene una URL
            url = wa.extract_url_from_text(text)
            if url:
                _handle_url_upload(phone, url, text)
                return
            _handle_text_message(phone, text)
            return

        logger.info("Tipo de mensaje no manejado: %s", msg_type)

    except Exception as e:
        logger.error("Error procesando mensaje: %s", e, exc_info=True)


# ──────────────────────────────────────────────
# Flujo 1A — Guardar archivo
# ──────────────────────────────────────────────

def _handle_file_upload(phone: str, media_id: str, filename: str, mime_type: str):
    wa.send_text_message(phone, "⏳ Descargando y analizando el archivo, un momento...")

    # Descargar archivo
    file_bytes, actual_mime = wa.download_media(media_id)
    if not file_bytes:
        wa.send_text_message(phone, "❌ No pude descargar el archivo. Intenta enviarlo de nuevo.")
        return

    effective_mime = actual_mime or mime_type

    # Subir a Supabase Storage para conservar la URL permanente
    public_url = db.upload_file_to_storage(file_bytes, filename, effective_mime)
    if not public_url:
        wa.send_text_message(
            phone,
            "⚠️ No pude subir el archivo al almacenamiento, pero continuaré analizándolo.",
        )

    # Extraer contenido del archivo
    content = fh.process_incoming_file(file_bytes, effective_mime, filename)

    # Extraer metadatos con OpenAI
    metadata = ai.extract_document_metadata(content, filename)

    # Guardar confirmación pendiente
    db.save_pending(
        phone=phone,
        metadata=metadata,
        file_url=public_url,
        file_name=filename,
        mime_type=effective_mime,
        raw_content=content,
    )

    # Enviar propuesta al usuario
    from models.document import Document
    doc = Document(
        uploaded_by=phone,
        file_url=public_url,
        file_name=filename,
        mime_type=effective_mime,
        **metadata,
    )
    response = (
        "📋 *Analicé el archivo. Aquí están los metadatos que detecté:*\n\n"
        f"{doc.metadata_summary()}\n\n"
        "¿Lo guardo así o querés corregir algo? (respondé *sí* para guardar o indicá los cambios)"
    )
    wa.send_text_message(phone, response)


# ──────────────────────────────────────────────
# Flujo 1B — Guardar link/URL
# ──────────────────────────────────────────────

def _handle_url_upload(phone: str, url: str, original_text: str):
    wa.send_text_message(phone, "⏳ Analizando el link, un momento...")

    content = ai.fetch_url_content(url)
    filename = url.split("/")[-1][:100] or "link"
    metadata = ai.extract_document_metadata(content, filename)

    db.save_pending(
        phone=phone,
        metadata=metadata,
        file_url=url,
        file_name=filename,
        mime_type="text/html",
        raw_content=content,
    )

    from models.document import Document
    doc = Document(uploaded_by=phone, file_url=url, file_name=filename, **metadata)
    response = (
        "🔗 *Analicé el link. Aquí están los metadatos:*\n\n"
        f"{doc.metadata_summary()}\n\n"
        "¿Lo guardo así o querés corregir algo?"
    )
    wa.send_text_message(phone, response)


# ──────────────────────────────────────────────
# Flujo — Respuesta a confirmación pendiente
# ──────────────────────────────────────────────

def _handle_pending_response(phone: str, text: str, pending: dict):
    intent = ai.detect_intent(text)
    metadata = pending.get("proposed_metadata", {})

    if intent == "confirm":
        _save_confirmed_document(phone, pending, metadata)

    elif intent == "correction":
        # Aplicar correcciones y volver a preguntar
        updated_metadata = ai.apply_corrections_to_metadata(metadata, text)
        db.save_pending(
            phone=phone,
            metadata=updated_metadata,
            file_url=pending.get("file_url"),
            file_name=pending.get("file_name"),
            mime_type=pending.get("mime_type"),
            raw_content=pending.get("raw_content"),
        )
        from models.document import Document
        doc = Document(
            uploaded_by=phone,
            file_url=pending.get("file_url"),
            file_name=pending.get("file_name"),
            **updated_metadata,
        )
        response = (
            "✏️ *Actualicé los metadatos:*\n\n"
            f"{doc.metadata_summary()}\n\n"
            "¿Ahora sí lo guardo?"
        )
        wa.send_text_message(phone, response)

    else:
        # Si no es confirm ni correction, tratar como confirm si hay palabras positivas,
        # sino pedir aclaración
        wa.send_text_message(
            phone,
            "No entendí bien. Respondé *sí* para guardar o decime qué querés cambiar "
            "(ej: \"el cliente es Martínez\", \"el tipo es factura\").",
        )


def _save_confirmed_document(phone: str, pending: dict, metadata: dict):
    # Generar embedding del texto del documento
    embed_text = (
        f"{metadata.get('client_name', '')} "
        f"{metadata.get('doc_type', '')} "
        f"{metadata.get('description', '')} "
        f"{' '.join(metadata.get('tags', []))}"
    ).strip()

    raw_content = pending.get("raw_content", "")
    if raw_content:
        embed_text = f"{embed_text}\n{raw_content[:3000]}"

    embedding = ai.generate_embedding(embed_text)
    if not embedding:
        wa.send_text_message(
            phone,
            "❌ Hubo un error generando el índice. Intenta de nuevo.",
        )
        return

    saved = db.save_document(
        metadata=metadata,
        embedding=embedding,
        uploaded_by=phone,
        file_url=pending.get("file_url"),
        file_name=pending.get("file_name"),
        mime_type=pending.get("mime_type"),
        raw_content=raw_content,
    )

    db.delete_pending(phone)

    if saved:
        wa.send_text_message(
            phone,
            f"Guardado ✅\n📄 *{pending.get('file_name', 'Documento')}* quedó registrado correctamente.",
        )
    else:
        wa.send_text_message(
            phone,
            "❌ Hubo un error al guardar. Por favor intentá de nuevo.",
        )


# ──────────────────────────────────────────────
# Flujo 2 — Buscar documento / Comandos
# ──────────────────────────────────────────────

def _handle_text_message(phone: str, text: str):
    intent = ai.detect_intent(text)
    logger.info("Intención detectada para '%s': %s", text[:50], intent)

    if intent == "search":
        _handle_search(phone, text)
    elif intent == "command":
        _handle_command(phone, text)
    else:
        # Intentar buscar de todas formas
        _handle_search(phone, text)


def _handle_search(phone: str, query: str):
    wa.send_text_message(phone, "🔍 Buscando...")

    embedding = ai.generate_embedding(query)
    if not embedding:
        wa.send_text_message(phone, "❌ No pude procesar tu búsqueda. Intenta de nuevo.")
        return

    results = db.search_documents(embedding, limit=Config.MAX_SEARCH_RESULTS)

    if not results:
        wa.send_text_message(
            phone,
            "🔎 No encontré nada con esa descripción. ¿Podés darme más detalles?",
        )
        return

    if len(results) == 1:
        _send_document_result(phone, results[0])
        return

    # Múltiples resultados
    response_lines = ["📂 *Encontré estos documentos:*\n"]
    for i, doc in enumerate(results, 1):
        client = doc.get("client_name") or "Sin cliente"
        doc_type = doc.get("doc_type") or "Documento"
        description = doc.get("description") or ""
        response_lines.append(
            f"*{i}.* {doc_type} — {client}\n   _{description[:80]}_"
        )

    response_lines.append(
        "\n¿Cuál necesitás? Respondé con el número (1, 2 o 3) "
        "o pedí más detalles de alguno."
    )
    wa.send_text_message(phone, "\n".join(response_lines))

    # Guardar contexto de búsqueda para que el usuario pueda elegir por número
    # (simplificado: enviamos todos los archivos directamente si hay pocos)
    if len(results) <= Config.MAX_SEARCH_RESULTS:
        for doc in results:
            _send_document_result(phone, doc, compact=True)


def _send_document_result(phone: str, doc: dict, compact: bool = False):
    file_url = doc.get("file_url")
    file_name = doc.get("file_name") or "documento"
    client = doc.get("client_name") or "Sin cliente"
    doc_type = doc.get("doc_type") or "Documento"
    description = doc.get("description") or ""
    mime_type = doc.get("mime_type") or ""
    tags = doc.get("tags") or []

    caption = f"📄 *{doc_type}* — {client}"
    if description and not compact:
        caption += f"\n{description}"
    if tags and not compact:
        caption += f"\n🏷️ {', '.join(tags)}"

    if not file_url:
        wa.send_text_message(phone, f"ℹ️ {caption}\n_(Sin archivo adjunto)_")
        return

    # Determinar cómo enviar según tipo
    if mime_type.startswith("image/"):
        wa.send_image(phone, file_url, caption)
    else:
        wa.send_document(phone, file_url, file_name, caption)


def _handle_command(phone: str, text: str):
    text_lower = text.lower().strip()

    if "listar" in text_lower or "lista todo" in text_lower or "listar todo" in text_lower:
        _cmd_list_recent(phone)
        return

    if "documento" in text_lower and " de " in text_lower:
        # Extraer nombre del cliente: "documentos de Martínez"
        parts = text_lower.split(" de ", 1)
        if len(parts) > 1:
            client_query = parts[1].strip().title()
            _cmd_search_by_client(phone, client_query)
            return

    if "ayuda" in text_lower or "help" in text_lower:
        _cmd_help(phone)
        return

    # Si no reconoce el comando, redirigir a búsqueda
    _handle_search(phone, text)


def _cmd_list_recent(phone: str):
    docs = db.get_recent_documents(limit=Config.RECENT_DOCS_LIMIT)
    if not docs:
        wa.send_text_message(phone, "📭 No hay documentos guardados todavía.")
        return

    lines = [f"📂 *Últimos {len(docs)} documentos:*\n"]
    for i, doc in enumerate(docs, 1):
        client = doc.get("client_name") or "Sin cliente"
        doc_type = doc.get("doc_type") or "Documento"
        file_name = doc.get("file_name") or ""
        created = doc.get("created_at", "")[:10]
        lines.append(f"*{i}.* {doc_type} — {client}\n   📎 {file_name} | 📅 {created}")

    wa.send_text_message(phone, "\n".join(lines))


def _cmd_search_by_client(phone: str, client_name: str):
    docs = db.search_by_client(client_name)
    if not docs:
        wa.send_text_message(
            phone,
            f"🔎 No encontré documentos del cliente *{client_name}*.",
        )
        return

    lines = [f"📂 *Documentos de {client_name}:*\n"]
    for i, doc in enumerate(docs, 1):
        doc_type = doc.get("doc_type") or "Documento"
        file_name = doc.get("file_name") or ""
        description = doc.get("description") or ""
        lines.append(
            f"*{i}.* {doc_type} — {file_name}\n   _{description[:60]}_"
        )

    wa.send_text_message(phone, "\n".join(lines))

    # Enviar los archivos si son pocos
    if len(docs) <= 3:
        for doc in docs:
            _send_document_result(phone, doc, compact=True)


def _cmd_help(phone: str):
    help_text = (
        "🤖 *¿Cómo usar el bot de documentos?*\n\n"
        "📤 *Guardar un documento:*\n"
        "Enviame un archivo (PDF, imagen, Word, Excel) o un link y lo clasifico automáticamente.\n\n"
        "🔍 *Buscar un documento:*\n"
        "Escribí lo que buscás, por ejemplo:\n"
        "  • _pásame el contrato de Martínez_\n"
        "  • _dame el logo de Coca Cola_\n"
        "  • _el presupuesto de enero_\n\n"
        "📋 *Comandos disponibles:*\n"
        "  • *listar todo* → últimos 10 documentos\n"
        "  • *documentos de [cliente]* → filtra por cliente\n"
        "  • *ayuda* → muestra este mensaje\n\n"
        "💡 El bot entiende lenguaje natural, ¡escribí como quieras!"
    )
    wa.send_text_message(phone, help_text)
