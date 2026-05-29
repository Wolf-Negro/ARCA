from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import uuid


@dataclass
class Document:
    uploaded_by: str
    client_name: Optional[str] = None
    doc_type: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    embedding: Optional[list[float]] = None
    raw_content: Optional[str] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "uploaded_by": self.uploaded_by,
            "client_name": self.client_name,
            "doc_type": self.doc_type,
            "description": self.description,
            "tags": self.tags,
            "file_url": self.file_url,
            "file_name": self.file_name,
            "mime_type": self.mime_type,
            "raw_content": self.raw_content,
        }

    def metadata_summary(self) -> str:
        tags_str = ", ".join(self.tags) if self.tags else "ninguna"
        lines = [
            f"📄 *Nombre:* {self.file_name or 'Sin nombre'}",
            f"👤 *Cliente:* {self.client_name or 'Sin cliente'}",
            f"📁 *Tipo:* {self.doc_type or 'Sin tipo'}",
            f"📝 *Descripción:* {self.description or 'Sin descripción'}",
            f"🏷️ *Etiquetas:* {tags_str}",
        ]
        return "\n".join(lines)


@dataclass
class PendingConfirmation:
    phone_number: str
    proposed_metadata: dict
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)
