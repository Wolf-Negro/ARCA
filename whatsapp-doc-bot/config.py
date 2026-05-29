import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-prod")
    DEBUG = os.environ.get("DEBUG", "false").lower() == "true"

    # WhatsApp Cloud API
    WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN")
    WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
    WHATSAPP_VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "mi_token_secreto_123")
    WHATSAPP_API_VERSION = os.environ.get("WHATSAPP_API_VERSION", "v19.0")

    # OpenAI
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
    OPENAI_CHAT_MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    # Supabase
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

    # App settings
    MAX_SEARCH_RESULTS = int(os.environ.get("MAX_SEARCH_RESULTS", 3))
    RECENT_DOCS_LIMIT = int(os.environ.get("RECENT_DOCS_LIMIT", 10))
    PENDING_EXPIRY_MINUTES = int(os.environ.get("PENDING_EXPIRY_MINUTES", 10))

    @classmethod
    def validate(cls):
        required = [
            "WHATSAPP_TOKEN",
            "WHATSAPP_PHONE_NUMBER_ID",
            "OPENAI_API_KEY",
            "SUPABASE_URL",
            "SUPABASE_KEY",
        ]
        missing = [var for var in required if not getattr(cls, var)]
        if missing:
            raise EnvironmentError(
                f"Variables de entorno requeridas no configuradas: {', '.join(missing)}"
            )
