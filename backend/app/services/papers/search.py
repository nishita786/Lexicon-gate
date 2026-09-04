"""Semantic Scholar + OpenAlex paper search.

Google Scholar is not queried. Hits are normalized to ``PaperHit``.
"""

from __future__ import annotations

import logging
from typing import Any, Callable
from urllib.parse import quote

import httpx

from ...config import Settings, get_settings
from ...models.papers import PaperHit

logger = logging.getLogger(__name__)

SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search"
SS_PAPER = "https://api.semanticscholar.org/graph/v1/paper/{paper_id}"
SS_FIELDS = (
    "title,authors,year,venue,citationCount,abstract,externalIds,openAccessPdf,url"
)
OPENALEX_WORKS = "https://api.openalex.org/works"
OPENALEX_WORK = "https://api.openalex.org/works/{paper_id}"

JsonGetter = Callable[..., dict[str, Any]]
BytesGetter = Callable[..., tuple[bytes, str]]


def _timeout(settings: Settings | None = None) -> float:
    return float((settings or get_settings()).paper_search_timeout_s)


def _ss_headers(settings: Settings | None = None) -> dict[str, str]:
    settings = settings or get_settings()
    headers = {"User-Agent": "Enhanced-Self-RAG/1.0"}
    if settings.semantic_scholar_api_key:
        headers["x-api-key"] = settings.semantic_scholar_api_key
    return headers


def default_get_json(
    url: str,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    with httpx.Client(timeout=timeout or _timeout(), follow_redirects=True) as client:
        response = client.get(url, params=params, headers=headers or {})
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return {"data": payload}
        return payload


DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
}


def default_get_bytes(
    url: str,
    timeout: float | None = None,
    max_bytes: int | None = None,
) -> tuple[bytes, str]:
    settings = get_settings()
    cap = max_bytes if max_bytes is not None else settings.paper_pdf_max_bytes
    with httpx.Client(timeout=timeout or _timeout(), follow_redirects=True) as client:
        with client.stream("GET", url, headers=DOWNLOAD_HEADERS) as response:
            response.raise_for_status()
            ctype = response.headers.get("content-type", "")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > cap:
                    raise ValueError("PDF exceeds size limit")
                chunks.append(chunk)
            return b"".join(chunks), ctype


def search_papers(
    query: str,
    limit: int = 10,
    *,
    get_json: JsonGetter | None = None,
    settings: Settings | None = None,
) -> tuple[list[PaperHit], str]:
    """Return (hits, provider_used). Falls back to OpenAlex when SS is empty or errors."""

    query = (query or "").strip()
    if not query:
        return [], "none"
    get_json = get_json or default_get_json
    settings = settings or get_settings()
    limit = max(1, min(int(limit), 25))

    try:
        hits = search_semantic_scholar(query, limit, get_json=get_json, settings=settings)
        if hits:
            return hits, "semantic_scholar"
    except Exception as exc:
        logger.warning("Semantic Scholar search failed: %s", exc)

    hits = search_openalex(query, limit, get_json=get_json, settings=settings)
    return hits, "openalex"


def search_semantic_scholar(
    query: str,
    limit: int,
    *,
    get_json: JsonGetter,
    settings: Settings,
) -> list[PaperHit]:
    payload = get_json(
        SS_SEARCH,
        params={"query": query, "limit": limit, "fields": SS_FIELDS},
        headers=_ss_headers(settings),
        timeout=_timeout(settings),
    )
    rows = payload.get("data") or []
    return [hit for row in rows if (hit := paper_from_semantic_scholar(row))]


def search_openalex(
    query: str,
    limit: int,
    *,
    get_json: JsonGetter,
    settings: Settings,
) -> list[PaperHit]:
    payload = get_json(
        OPENALEX_WORKS,
        params={"search": query, "per_page": limit},
        headers={"User-Agent": "Enhanced-Self-RAG/1.0"},
        timeout=_timeout(settings),
    )
    rows = payload.get("results") or []
    return [hit for row in rows if (hit := paper_from_openalex(row))]


def fetch_paper(
    paper_id: str,
    source: str,
    *,
    get_json: JsonGetter | None = None,
    settings: Settings | None = None,
) -> PaperHit | None:
    get_json = get_json or default_get_json
    settings = settings or get_settings()
    if source == "semantic_scholar":
        payload = get_json(
            SS_PAPER.format(paper_id=quote(paper_id, safe="")),
            params={"fields": SS_FIELDS},
            headers=_ss_headers(settings),
            timeout=_timeout(settings),
        )
        return paper_from_semantic_scholar(payload)
    if source == "openalex":
        oid = paper_id
        if oid.startswith("https://"):
            oid = oid.rsplit("/", 1)[-1]
        payload = get_json(
            OPENALEX_WORK.format(paper_id=oid),
            headers={"User-Agent": "Enhanced-Self-RAG/1.0"},
            timeout=_timeout(settings),
        )
        return paper_from_openalex(payload)
    return None


def paper_from_semantic_scholar(row: dict[str, Any] | None) -> PaperHit | None:
    if not row or not row.get("title"):
        return None
    authors = []
    for author in row.get("authors") or []:
        name = author.get("name") if isinstance(author, dict) else str(author)
        if name:
            authors.append(name)
    ids = row.get("externalIds") or {}
    doi = ids.get("DOI") if isinstance(ids, dict) else None
    oa = row.get("openAccessPdf") or {}
    pdf_url = oa.get("url") if isinstance(oa, dict) else None
    year = row.get("year")
    try:
        year_int = int(year) if year is not None else None
    except (TypeError, ValueError):
        year_int = None
    return PaperHit(
        paper_id=str(row.get("paperId") or row.get("paper_id") or ""),
        title=str(row["title"]).strip(),
        authors=authors,
        year=year_int,
        venue=(str(row["venue"]).strip() if row.get("venue") else None) or None,
        citation_count=int(row.get("citationCount") or 0),
        abstract=(str(row["abstract"]).strip() if row.get("abstract") else None) or None,
        doi=str(doi).strip() if doi else None,
        pdf_url=pdf_url,
        source="semantic_scholar",
        open_access=bool(pdf_url),
        url=row.get("url"),
    )


def paper_from_openalex(row: dict[str, Any] | None) -> PaperHit | None:
    if not row:
        return None
    title = row.get("display_name") or row.get("title")
    if not title:
        return None
    authors = []
    for item in row.get("authorships") or []:
        author = (item or {}).get("author") or {}
        name = author.get("display_name")
        if name:
            authors.append(name)
    venue = None
    loc = row.get("primary_location") or {}
    source = loc.get("source") or {}
    if source.get("display_name"):
        venue = source["display_name"]
    pdf_url = None
    oa = row.get("open_access") or {}
    best = row.get("best_oa_location") or {}
    pdf_url = best.get("pdf_url") or loc.get("pdf_url") or oa.get("oa_url")
    doi = row.get("doi")
    if isinstance(doi, str):
        doi = doi.replace("https://doi.org/", "").replace("http://doi.org/", "")
    raw_id = str(row.get("id") or "")
    paper_id = raw_id.rsplit("/", 1)[-1] if raw_id else ""
    year = row.get("publication_year")
    try:
        year_int = int(year) if year is not None else None
    except (TypeError, ValueError):
        year_int = None
    return PaperHit(
        paper_id=paper_id or raw_id,
        title=str(title).strip(),
        authors=authors,
        year=year_int,
        venue=venue,
        citation_count=int(row.get("cited_by_count") or 0),
        abstract=abstract_from_inverted(row.get("abstract_inverted_index")),
        doi=doi or None,
        pdf_url=pdf_url,
        source="openalex",
        open_access=bool(pdf_url),
        url=raw_id or None,
    )


def abstract_from_inverted(index: dict[str, list[int]] | None) -> str | None:
    if not index or not isinstance(index, dict):
        return None
    positions: list[tuple[int, str]] = []
    for word, slots in index.items():
        for slot in slots or []:
            positions.append((int(slot), str(word)))
    if not positions:
        return None
    positions.sort()
    return " ".join(word for _slot, word in positions)


def hit_from_import_request(payload: Any) -> PaperHit | None:
    """Use a client-supplied snapshot when title is present; otherwise None (caller fetches)."""

    title = getattr(payload, "title", None)
    if not title:
        return None
    return PaperHit(
        paper_id=payload.paper_id,
        title=title,
        authors=list(payload.authors or []),
        year=payload.year,
        venue=payload.venue,
        abstract=payload.abstract,
        doi=payload.doi,
        pdf_url=payload.pdf_url,
        source=payload.source,
        open_access=bool(payload.pdf_url),
        url=getattr(payload, "url", None),
    )
