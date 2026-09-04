"""Document, chunk and ingestion schemas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ChunkMetadata(BaseModel):
    document_id: str
    document_name: str
    page: int | None = None
    section: str | None = None
    chunk_index: int = 0
    source: str = "upload"
    source_quality: float = 0.6
    created_at: datetime = Field(default_factory=_utcnow)
    extra: dict[str, Any] = Field(default_factory=dict)


class Chunk(BaseModel):
    chunk_id: str
    text: str
    metadata: ChunkMetadata

    @property
    def citation_label(self) -> str:
        page = self.metadata.page
        if page is None:
            return self.metadata.document_name
        return f"{self.metadata.document_name} — page {page}"


class Document(BaseModel):
    document_id: str
    name: str
    source: str = "upload"
    media_type: str = "text/plain"
    n_pages: int = 1
    n_chunks: int = 0
    n_characters: int = 0
    source_quality: float = 0.6
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    title: str = ""
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    doi: str | None = None


class DocumentBiblioUpdate(BaseModel):
    title: str | None = None
    authors: list[str] | None = None
    year: int | None = None
    venue: str | None = None
    doi: str | None = None


class UploadResponse(BaseModel):
    documents: list[Document]
    total_chunks: int
    warnings: list[str] = Field(default_factory=list)


class DocumentListResponse(BaseModel):
    documents: list[Document]
    total_documents: int
    total_chunks: int
    embedding_provider: str
    vector_store: str
