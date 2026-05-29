import logging
import re
from typing import Optional
import requests
from config import Config

logger = logging.getLogger(__name__)

WHATSAPP_API_BASE = "https://graph.facebook.com/{version}/{phone_number_id}"


def _api_url(path: str = "") -> str:
    base = WHATSAPP_API_BASE.format(
        version=Config.WHATSAPP_API_VERSION,
        phone_number_id=Config.WHATSAPP_PHONE_NUMBER_ID,
    )
    return f"{base}{path}"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {Config.WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }


def send_text_message(phone: str, text: str) -> bool:
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone,
        "type": "text",
        "text": {"preview_url": False, "body": text},
    }
    try:
        resp = requests.post(_api_url("/messages"), json=payload, headers=_headers(), timeout=10)
        resp.raise_for_status()
        logger.info("Mensaje enviado a %s", phone)
        return True
    except requests.RequestException as e:
        logger.error("Error enviando mensaje a %s: %s", phone, e)
        return False


def send_document(
    phone: str,
    file_url: str,
    filename: str,
    caption: str = "",
) -> bool:
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone,
        "type": "document",
        "document": {
            "link": file_url,
            "caption": caption,
            "filename": filename,
        },
    }
    try:
        resp = requests.post(_api_url("/messages"), json=payload, headers=_headers(), timeout=10)
        resp.raise_for_status()
        logger.info("Documento enviado a %s: %s", phone, filename)
        return True
    except requests.RequestException as e:
        logger.error("Error enviando documento a %s: %s", phone, e)
        return False


def send_image(phone: str, image_url: str, caption: str = "") -> bool:
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone,
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    }
    try:
        resp = requests.post(_api_url("/messages"), json=payload, headers=_headers(), timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        logger.error("Error enviando imagen a %s: %s", phone, e)
        return False


def download_media(media_id: str) -> tuple[Optional[bytes], Optional[str]]:
    """Descarga un archivo de WhatsApp. Retorna (bytes, mime_type) o (None, None)."""
    try:
        # Paso 1: obtener la URL del archivo
        url = f"https://graph.facebook.com/{Config.WHATSAPP_API_VERSION}/{media_id}"
        headers = {"Authorization": f"Bearer {Config.WHATSAPP_TOKEN}"}
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        media_url = data.get("url")
        mime_type = data.get("mime_type", "application/octet-stream")

        if not media_url:
            logger.error("No se encontró URL para media_id %s", media_id)
            return None, None

        # Paso 2: descargar el archivo
        download_resp = requests.get(media_url, headers=headers, timeout=30)
        download_resp.raise_for_status()
        logger.info("Archivo descargado: %s bytes, tipo: %s", len(download_resp.content), mime_type)
        return download_resp.content, mime_type
    except requests.RequestException as e:
        logger.error("Error descargando media %s: %s", media_id, e)
        return None, None


def parse_webhook_message(payload: dict) -> Optional[dict]:
    """
    Extrae del payload de WhatsApp:
    - phone_number: str
    - message_type: 'text' | 'document' | 'image' | 'audio' | 'video' | 'unknown'
    - text: str (si es texto)
    - media_id: str (si es archivo)
    - filename: str (si aplica)
    - mime_type: str (si aplica)
    - message_id: str
    Retorna None si el payload no es un mensaje válido.
    """
    try:
        entry = payload.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})

        messages = value.get("messages")
        if not messages:
            return None

        msg = messages[0]
        phone_number = msg.get("from")
        message_id = msg.get("id")
        message_type = msg.get("type", "unknown")

        result = {
            "phone_number": phone_number,
            "message_type": message_type,
            "message_id": message_id,
            "text": None,
            "media_id": None,
            "filename": None,
            "mime_type": None,
        }

        if message_type == "text":
            result["text"] = msg.get("text", {}).get("body", "").strip()

        elif message_type == "document":
            doc = msg.get("document", {})
            result["media_id"] = doc.get("id")
            result["filename"] = doc.get("filename", "documento")
            result["mime_type"] = doc.get("mime_type", "application/octet-stream")

        elif message_type == "image":
            img = msg.get("image", {})
            result["media_id"] = img.get("id")
            result["mime_type"] = img.get("mime_type", "image/jpeg")
            result["filename"] = f"imagen_{message_id}.jpg"

        elif message_type == "video":
            vid = msg.get("video", {})
            result["media_id"] = vid.get("id")
            result["mime_type"] = vid.get("mime_type", "video/mp4")
            result["filename"] = f"video_{message_id}.mp4"

        elif message_type == "audio":
            aud = msg.get("audio", {})
            result["media_id"] = aud.get("id")
            result["mime_type"] = aud.get("mime_type", "audio/ogg")
            result["filename"] = f"audio_{message_id}.ogg"

        return result

    except (KeyError, IndexError, TypeError) as e:
        logger.error("Error parseando webhook payload: %s", e)
        return None


def extract_url_from_text(text: str) -> Optional[str]:
    """Detecta si el texto contiene una URL y la retorna."""
    url_pattern = re.compile(
        r"https?://[^\s<>\"{}|\\^`\[\]]+"
    )
    match = url_pattern.search(text)
    return match.group(0) if match else None
