"""Resolve legally available PDF URLs. Does not bypass paywalls."""

from __future__ import annotations

import logging
from urllib.parse import quote, urlparse

from ...config import Settings, get_settings
from ...models.papers import PaperHit
from .search import JsonGetter, OPENALEX_WORKS, default_get_json, openalex_headers

logger = logging.getLogger(__name__)

UNPAYWALL = "https://api.unpaywall.org/v2/{doi}"


def looks_like_pdf_url(url: str | None) -> bool:
    if not url:
        return False
    path = urlparse(url).path.lower()
    return (
        path.endswith(".pdf")
        or path.endswith("/pdf")
        or "/pdf/" in path
        or "arxiv.org/pdf/" in url.lower()
    )


def publisher_pdf_rewrite(url: str | None) -> str | None:
    """Turn known OA article HTML pages into the publisher PDF path."""

    if not url:
        return None
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    base = url.split("?")[0].rstrip("/")
    if looks_like_pdf_url(base):
        return None
    if "mdpi.com" in host:
        return f"{base}/pdf"
    if "frontiersin.org" in host:
        return f"{base}/pdf"
    return None


def official_paper_url(hit: PaperHit) -> str | None:
    if hit.doi:
        doi = hit.doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
        return f"https://doi.org/{doi}"
    if hit.url:
        return hit.url
    if hit.pdf_url:
        return hit.pdf_url
    return None


def pdf_candidates(
    hit: PaperHit,
    *,
    get_json: JsonGetter | None = None,
    settings: Settings | None = None,
) -> list[str]:
    """Ordered unique URLs that might be an open PDF."""

    get_json = get_json or default_get_json
    settings = settings or get_settings()
    ordered: list[str] = []

    def add(url: str | None) -> None:
        if not url:
            return
        url = url.strip()
        if url and url not in ordered:
            ordered.append(url)

    if looks_like_pdf_url(hit.pdf_url):
        add(hit.pdf_url)
    for source in (hit.pdf_url, hit.url):
        add(publisher_pdf_rewrite(source))
    for url in unpaywall_pdf_urls(hit.doi, get_json=get_json, settings=settings):
        add(url)
    for url in openalex_pdf_urls_by_doi(hit.doi, get_json=get_json, settings=settings):
        add(url)
    return ordered


def unpaywall_pdf_urls(
    doi: str | None,
    *,
    get_json: JsonGetter,
    settings: Settings,
) -> list[str]:
    if not doi:
        return []
    doi = doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
    email = settings.unpaywall_email or "selfrag@localhost"
    try:
        payload = get_json(
            UNPAYWALL.format(doi=quote(doi, safe="/")),
            params={"email": email},
            timeout=settings.paper_search_timeout_s,
        )
    except Exception as exc:
        logger.warning("Unpaywall lookup failed for %s: %s", doi, exc)
        return []
    urls: list[str] = []
    best = payload.get("best_oa_location") or {}
    if best.get("url_for_pdf"):
        urls.append(best["url_for_pdf"])
    for loc in payload.get("oa_locations") or []:
        pdf = (loc or {}).get("url_for_pdf")
        if pdf:
            urls.append(pdf)
    return urls


def openalex_pdf_urls_by_doi(
    doi: str | None,
    *,
    get_json: JsonGetter,
    settings: Settings,
) -> list[str]:
    if not doi:
        return []
    doi = doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
    try:
        payload = get_json(
            OPENALEX_WORKS,
            params={
                "filter": f"doi:{doi}",
                "per_page": 1,
                "mailto": settings.unpaywall_email or "selfrag@localhost",
            },
            headers=openalex_headers(settings),
            timeout=settings.paper_search_timeout_s,
        )
    except Exception as exc:
        logger.warning("OpenAlex DOI lookup failed for %s: %s", doi, exc)
        return []
    rows = payload.get("results") or []
    if not rows:
        return []
    row = rows[0]
    urls: list[str] = []
    best = row.get("best_oa_location") or {}
    loc = row.get("primary_location") or {}
    oa = row.get("open_access") or {}
    for key in (best.get("pdf_url"), loc.get("pdf_url"), oa.get("oa_url")):
        if key:
            urls.append(key)
    return urls
