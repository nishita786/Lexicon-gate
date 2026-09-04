"""Public academic paper search (not Google Scholar scraping)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PaperSource = Literal["semantic_scholar", "openalex"]


class PaperHit(BaseModel):
    paper_id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    citation_count: int = 0
    abstract: str | None = None
    doi: str | None = None
    pdf_url: str | None = None
    source: PaperSource
    open_access: bool = False
    url: str | None = None


class PaperSearchResponse(BaseModel):
    query: str
    provider: str
    papers: list[PaperHit]


class PaperImportRequest(BaseModel):
    paper_id: str
    source: PaperSource
    title: str | None = None
    authors: list[str] | None = None
    year: int | None = None
    venue: str | None = None
    abstract: str | None = None
    doi: str | None = None
    pdf_url: str | None = None
    url: str | None = None


class PaperImportResponse(BaseModel):
    document: dict
    ingested: str
    warnings: list[str] = Field(default_factory=list)
    paper_url: str | None = None
    pdf_url: str | None = None
