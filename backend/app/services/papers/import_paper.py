"""Import a searched paper into the knowledge base."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ...config import get_settings
from ...models.documents import Document
from ...models.papers import PaperHit, PaperImportRequest
from ...services.store.document_store import slugify
from ...services.store.knowledge_base import KnowledgeBase
from .pdf_resolve import official_paper_url, pdf_candidates
from .search import (
    BytesGetter,
    JsonGetter,
    default_get_bytes,
    default_get_json,
    fetch_paper,
    hit_from_import_request,
)

logger = logging.getLogger(__name__)

ABSTRACT_FALLBACK_WARNING = (
    "Could not fetch a PDF (publisher blocked or paywalled). "
    "Abstract saved. Use Open paper for the official copy."
)


@dataclass
class PaperImportResult:
    document: Document
    ingested: str
    warnings: list[str] = field(default_factory=list)
    paper_url: str | None = None
    pdf_url: str | None = None


def import_paper(
    request: PaperImportRequest,
    kb: KnowledgeBase,
    *,
    get_json: JsonGetter | None = None,
    get_bytes: BytesGetter | None = None,
) -> PaperImportResult:
    """Return a result whose ingested kind is pdf or abstract."""

    get_json = get_json or default_get_json
    get_bytes = get_bytes or default_get_bytes
    warnings: list[str] = []
    hit = hit_from_import_request(request)
    if hit is None:
        hit = fetch_paper(request.paper_id, request.source, get_json=get_json)
    if hit is None:
        raise ValueError("Paper not found.")

    settings = get_settings()
    slug = slugify(hit.title or hit.paper_id, max_len=48)
    paper_url = official_paper_url(hit)
    last_error: str | None = None

    for url in pdf_candidates(hit, get_json=get_json, settings=settings):
        try:
            data, _content_type = get_bytes(
                url,
                timeout=settings.paper_search_timeout_s,
                max_bytes=settings.paper_pdf_max_bytes,
            )
        except Exception as exc:
            logger.warning("PDF download failed for %s (%s): %s", hit.paper_id, url, exc)
            last_error = str(exc)
            continue
        if data[:5] == b"%PDF-":
            document, _chunks = kb.ingest_bytes(
                f"{slug}.pdf",
                data,
                source=hit.source,
                title=hit.title,
                authors=hit.authors,
                year=hit.year,
                venue=hit.venue,
                doi=hit.doi,
            )
            return PaperImportResult(
                document=document,
                ingested="pdf",
                warnings=warnings,
                paper_url=paper_url,
                pdf_url=url,
            )
        last_error = "response was not a PDF"
        logger.warning("Downloaded file was not a PDF for %s (%s)", hit.paper_id, url)

    if last_error:
        warnings.append(ABSTRACT_FALLBACK_WARNING)

    markdown = _abstract_markdown(hit)
    document, _chunks = kb.ingest_bytes(
        f"{slug}.md",
        markdown.encode("utf-8"),
        source=hit.source,
        title=hit.title,
        authors=hit.authors,
        year=hit.year,
        venue=hit.venue,
        doi=hit.doi,
    )
    return PaperImportResult(
        document=document,
        ingested="abstract",
        warnings=warnings,
        paper_url=paper_url,
        pdf_url=None,
    )


def _abstract_markdown(hit: PaperHit) -> str:
    authors = ", ".join(hit.authors) if hit.authors else "Unknown"
    year = hit.year or "n.d."
    doi_line = f"DOI: {hit.doi}\n\n" if hit.doi else ""
    abstract = (hit.abstract or "").strip() or "No abstract was provided by the index."
    return (
        f"# {hit.title}\n\n"
        f"{authors} ({year})"
        + (f". {hit.venue}" if hit.venue else "")
        + ".\n\n"
        + doi_line
        + abstract
        + "\n"
    )
