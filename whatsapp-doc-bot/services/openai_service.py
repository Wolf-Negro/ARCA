import base64
import json
import logging
from typing import Optional
from openai import OpenAI
from config import Config

logger = logging.getLogger(__name__)
client = OpenAI(api_key=Config.OPENAI_API_KEY)

METADATA_SYSTEM_PROMPT = """Eres un asistente especializado en clasificar documentos para una agencia.
Analiza el contenido del documento y extrae la siguiente información en formato JSON estricto.

Responde ÚNICAMENTE con un objeto JSON válido con estas claves:
- client_name: nombre del cliente o empresa mencionada (null si no se detecta)
- doc_type: tipo de documento (ej: "contrato", "presupuesto", "factura", "propuesta", "logo", "informe", "manual", "otro")
- description: descripción breve de 1-2 oraciones del contenido del documento
- tags: lista de 3-5 etiquetas relevantes en minúsculas (ej: ["marketing", "2024", "diseño"])

No incluyas texto adicional fuera del JSON."""

INTENT_SYSTEM_PROMPT = """Eres un clasificador de intenciones para un bot de gestión de documentos.
Clasifica el mensaje del usuario en exactamente una de estas categorías:

- "search": el usuario quiere buscar o recuperar un documento (ej: "pásame el contrato de...", "dame el archivo de...", "busca el logo de...")
- "confirm": el usuario confirma o acepta algo (ej: "sí", "ok", "dale", "perfecto", "correcto", "guardá", "listo")
- "correction": el usuario quiere corregir algo (ej: "el cliente es...", "cambia el tipo a...", "la descripción debería ser...")
- "command": el usuario usa un comando especial (ej: "listar todo", "documentos de [cliente]", "ayuda")
- "link": el mensaje contiene solo una URL o link
- "unknown": no encaja en ninguna categoría anterior

Responde ÚNICAMENTE con el nombre de la categoría (una sola palabra en minúsculas)."""


def extract_document_metadata(content: str, filename: str = "") -> dict:
    """Usa GPT-4o-mini para extraer metadatos estructurados del contenido de un documento."""
    user_message = f"Archivo: {filename}\n\nContenido:\n{content[:8000]}"
    try:
        response = client.chat.completions.create(
            model=Config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": METADATA_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.1,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        metadata = json.loads(raw)
        # Normalizar estructura
        return {
            "client_name": metadata.get("client_name"),
            "doc_type": metadata.get("doc_type", "otro"),
            "description": metadata.get("description", ""),
            "tags": metadata.get("tags", []),
        }
    except (json.JSONDecodeError, KeyError) as e:
        logger.error("Error parseando metadatos de OpenAI: %s", e)
        return {
            "client_name": None,
            "doc_type": "otro",
            "description": "Documento sin descripción automática",
            "tags": [],
        }
    except Exception as e:
        logger.error("Error en extract_document_metadata: %s", e)
        return {
            "client_name": None,
            "doc_type": "otro",
            "description": "No se pudo analizar el documento",
            "tags": [],
        }


def detect_intent(message_text: str) -> str:
    """Detecta la intención del mensaje. Retorna uno de: search, confirm, correction, command, link, unknown."""
    try:
        response = client.chat.completions.create(
            model=Config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": message_text},
            ],
            temperature=0,
            max_tokens=20,
        )
        intent = response.choices[0].message.content.strip().lower()
        valid_intents = {"search", "confirm", "correction", "command", "link", "unknown"}
        if intent not in valid_intents:
            logger.warning("Intención inválida recibida: '%s', usando 'unknown'", intent)
            return "unknown"
        return intent
    except Exception as e:
        logger.error("Error en detect_intent: %s", e)
        return "unknown"


def generate_embedding(text: str) -> Optional[list[float]]:
    """Genera un embedding de 1536 dimensiones usando text-embedding-3-small."""
    try:
        text = text.replace("\n", " ").strip()
        if not text:
            logger.warning("Texto vacío para generar embedding")
            return None
        response = client.embeddings.create(
            model=Config.OPENAI_EMBEDDING_MODEL,
            input=text[:8000],
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error("Error generando embedding: %s", e)
        return None


def read_image_content(image_bytes: bytes, mime_type: str) -> str:
    """Extrae texto/descripción de una imagen usando GPT-4o-mini vision."""
    try:
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
        image_data_url = f"data:{mime_type};base64,{base64_image}"

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analiza esta imagen y proporciona:\n"
                                "1. Una descripción detallada del contenido\n"
                                "2. Si es un logo, identifica la empresa\n"
                                "3. Si contiene texto, transcríbelo\n"
                                "4. Contexto relevante para clasificación documental\n"
                                "Responde en español."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": image_data_url}},
                    ],
                }
            ],
            max_tokens=1000,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error("Error leyendo imagen con visión: %s", e)
        return "Imagen sin contenido extraíble"


def apply_corrections_to_metadata(original_metadata: dict, correction_text: str) -> dict:
    """Aplica las correcciones del usuario a los metadatos propuestos."""
    system_prompt = """Eres un asistente que actualiza metadatos de documentos según las instrucciones del usuario.

Dado un JSON de metadatos actuales y las correcciones del usuario, retorna el JSON actualizado.
Mantén los campos que no se mencionen y actualiza solo los indicados.

Responde ÚNICAMENTE con el JSON actualizado, sin texto adicional."""

    user_message = (
        f"Metadatos actuales:\n{json.dumps(original_metadata, ensure_ascii=False, indent=2)}\n\n"
        f"Correcciones del usuario:\n{correction_text}"
    )

    try:
        response = client.chat.completions.create(
            model=Config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.1,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        updated = json.loads(response.choices[0].message.content)
        return {
            "client_name": updated.get("client_name", original_metadata.get("client_name")),
            "doc_type": updated.get("doc_type", original_metadata.get("doc_type")),
            "description": updated.get("description", original_metadata.get("description")),
            "tags": updated.get("tags", original_metadata.get("tags", [])),
        }
    except Exception as e:
        logger.error("Error aplicando correcciones: %s", e)
        return original_metadata


def fetch_url_content(url: str) -> str:
    """Descarga el contenido textual de una URL para procesarlo como documento."""
    import requests
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; DocBot/1.0)"
            )
        }
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")

        if "text/html" in content_type:
            # Extraer texto plano de HTML básico
            from html.parser import HTMLParser

            class TextExtractor(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts = []
                    self._skip = False

                def handle_starttag(self, tag, attrs):
                    if tag in ("script", "style"):
                        self._skip = True

                def handle_endtag(self, tag):
                    if tag in ("script", "style"):
                        self._skip = False

                def handle_data(self, data):
                    if not self._skip:
                        stripped = data.strip()
                        if stripped:
                            self.parts.append(stripped)

            parser = TextExtractor()
            parser.feed(resp.text)
            return " ".join(parser.parts)[:8000]

        return resp.text[:8000]
    except Exception as e:
        logger.error("Error descargando URL %s: %s", url, e)
        return f"No se pudo acceder al contenido de la URL: {url}"
