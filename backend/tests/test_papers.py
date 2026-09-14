"""Academic paper search and import (mocked HTTP)."""

from __future__ import annotations

from app.config import get_settings
from app.models.papers import PaperHit, PaperImportRequest
from app.services.papers.import_paper import ABSTRACT_FALLBACK_WARNING, import_paper
from app.services.papers.pdf_resolve import (
    pdf_candidates,
    publisher_pdf_rewrite,
    unpaywall_pdf_urls,
)
from app.services.papers.search import (
    abstract_from_inverted,
    paper_from_crossref,
    paper_from_openalex,
    paper_from_semantic_scholar,
    search_papers,
)


SS_HIT = {
    "paperId": "abc123",
    "title": "Dropout: A Simple Way to Prevent Neural Networks from Overfitting",
    "authors": [{"name": "Nitish Srivastava"}, {"name": "Geoffrey Hinton"}],
    "year": 2014,
    "venue": "JMLR",
    "citationCount": 20000,
    "abstract": "We present dropout.",
    "externalIds": {"DOI": "10.5555/dropout"},
    "openAccessPdf": {"url": "https://example.com/dropout.pdf"},
    "url": "https://www.semanticscholar.org/paper/abc123",
}


def test_paper_from_semantic_scholar():
    hit = paper_from_semantic_scholar(SS_HIT)
    assert hit is not None
    assert hit.source == "semantic_scholar"
    assert hit.authors[0] == "Nitish Srivastava"
    assert hit.doi == "10.5555/dropout"
    assert hit.open_access is True
    assert hit.pdf_url.endswith(".pdf")


def test_paper_from_openalex_and_inverted_abstract():
    row = {
        "id": "https://openalex.org/W123",
        "display_name": "Dropout",
        "publication_year": 2014,
        "authorships": [{"author": {"display_name": "N. Srivastava"}}],
        "cited_by_count": 9,
        "primary_location": {"source": {"display_name": "JMLR"}},
        "abstract_inverted_index": {"We": [0], "present": [1], "dropout": [2]},
        "doi": "https://doi.org/10.1/x",
        "best_oa_location": {"pdf_url": None},
    }
    hit = paper_from_openalex(row)
    assert hit is not None
    assert hit.paper_id == "W123"
    assert hit.venue == "JMLR"
    assert hit.doi == "10.1/x"
    assert abstract_from_inverted(row["abstract_inverted_index"]) == "We present dropout"


def test_search_uses_semantic_scholar_when_hits_exist():
    def get_json(url, params=None, headers=None, timeout=None):
        assert "semanticscholar" in url
        return {"data": [SS_HIT]}

    hits, provider = search_papers("dropout", get_json=get_json)
    assert provider == "semantic_scholar"
    assert hits[0].paper_id == "abc123"


def test_search_falls_back_to_openalex_when_ss_empty():
    def get_json(url, params=None, headers=None, timeout=None):
        if "semanticscholar" in url:
            return {"data": []}
        return {
            "results": [
                {
                    "id": "https://openalex.org/W9",
                    "display_name": "OpenAlex Dropout",
                    "publication_year": 2015,
                    "authorships": [],
                }
            ]
        }

    hits, provider = search_papers("dropout", get_json=get_json)
    assert provider == "openalex"
    assert hits[0].title == "OpenAlex Dropout"


def test_search_falls_back_when_ss_errors():
    def get_json(url, params=None, headers=None, timeout=None):
        if "semanticscholar" in url:
            raise RuntimeError("429")
        return {"results": [{"id": "W1", "display_name": "Fallback paper"}]}

    hits, provider = search_papers("dropout", get_json=get_json)
    assert provider == "openalex"
    assert hits[0].title == "Fallback paper"


def test_search_falls_back_to_crossref_when_ss_and_openalex_fail():
    def get_json(url, params=None, headers=None, timeout=None):
        if "semanticscholar" in url or "openalex" in url:
            raise RuntimeError("429")
        return {
            "message": {
                "items": [
                    {
                        "DOI": "10.1/dl",
                        "title": ["Deep Learning"],
                        "author": [{"given": "Yoshua", "family": "Bengio"}],
                        "issued": {"date-parts": [[2015]]},
                        "container-title": ["Nature"],
                        "is-referenced-by-count": 12,
                        "URL": "https://doi.org/10.1/dl",
                    }
                ]
            }
        }

    hits, provider = search_papers("deep learning", get_json=get_json)
    assert provider == "crossref"
    assert hits[0].title == "Deep Learning"
    assert hits[0].authors[0] == "Yoshua Bengio"
    assert hits[0].year == 2015


def test_search_all_providers_fail_returns_empty():
    def get_json(url, params=None, headers=None, timeout=None):
        raise RuntimeError("429 Too Many Requests")

    hits, provider = search_papers("deep learning", get_json=get_json)
    assert hits == []
    assert provider in {"semantic_scholar", "openalex", "crossref"}


def test_paper_from_crossref():
    hit = paper_from_crossref(
        {
            "DOI": "10.1/x",
            "title": ["A Survey of Deep Learning"],
            "author": [{"given": "Ian", "family": "Goodfellow"}],
            "published-print": {"date-parts": [[2016, 1]]},
            "container-title": ["Book"],
            "URL": "https://doi.org/10.1/x",
        }
    )
    assert hit is not None
    assert hit.source == "crossref"
    assert hit.paper_id == "10.1/x"
    assert hit.year == 2016


def test_import_abstract_snapshot(kb):
    request = PaperImportRequest(
        paper_id="abc123",
        source="semantic_scholar",
        title="Dropout study",
        authors=["N. Srivastava"],
        year=2014,
        venue="JMLR",
        abstract="Dropout reduces overfitting.",
        doi="10.1/x",
    )
    def get_json(url, params=None, headers=None, timeout=None):
        return {}

    result = import_paper(request, kb, get_json=get_json)
    assert result.ingested == "abstract"
    assert result.document.title == "Dropout study"
    assert result.document.authors == ["N. Srivastava"]
    assert result.document.year == 2014
    assert result.document.doi == "10.1/x"
    assert not result.warnings
    assert result.paper_url == "https://doi.org/10.1/x"


def test_import_pdf_failure_falls_back_to_abstract(kb):
    request = PaperImportRequest(
        paper_id="abc123",
        source="semantic_scholar",
        title="Dropout study",
        abstract="Dropout reduces overfitting.",
        pdf_url="https://example.com/missing.pdf",
    )

    def get_json(url, params=None, headers=None, timeout=None):
        return {}

    def get_bytes(url, timeout=None, max_bytes=None):
        return b"<html>not a pdf</html>", "text/html"

    result = import_paper(request, kb, get_json=get_json, get_bytes=get_bytes)
    assert result.ingested == "abstract"
    assert ABSTRACT_FALLBACK_WARNING in result.warnings
    assert result.document.title == "Dropout study"


def _tiny_pdf() -> bytes:
    from io import BytesIO

    from pypdf import PdfWriter

    buffer = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(buffer)
    return buffer.getvalue()


def test_mdpi_html_expands_to_pdf_and_is_tried_first():
    html = "https://www.mdpi.com/2227-7390/13/5/856"
    assert publisher_pdf_rewrite(html) == f"{html}/pdf"
    hit = PaperHit(
        paper_id="856",
        title="MDPI article",
        source="semantic_scholar",
        pdf_url=html,
        url=html,
    )
    candidates = pdf_candidates(hit, get_json=lambda *args, **kwargs: {})
    assert candidates[0] == f"{html}/pdf"
    assert html not in candidates


def test_pmc_html_expands_to_pdf_and_is_tried():
    html = "https://www.ncbi.nlm.nih.gov/pmc/articles/3037419"
    pdf = "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3037419/pdf/"
    assert publisher_pdf_rewrite(html) == pdf
    assert (
        publisher_pdf_rewrite("https://pmc.ncbi.nlm.nih.gov/articles/PMC3037419")
        == "https://pmc.ncbi.nlm.nih.gov/articles/PMC3037419/pdf/"
    )
    hit = PaperHit(
        paper_id="W2103017472",
        title="Gene Ontology",
        source="openalex",
        url=html,
        doi="10.1038/75556",
    )
    candidates = pdf_candidates(hit, get_json=lambda *args, **kwargs: {})
    assert candidates[0] == pdf
    assert html not in candidates


def test_unpaywall_landing_page_is_rewritten_to_pmc_pdf():
    html = "https://www.ncbi.nlm.nih.gov/pmc/articles/3037419"

    def get_json(url, params=None, headers=None, timeout=None):
        if "unpaywall.org" in url:
            return {"best_oa_location": {"url": html, "url_for_pdf": None}}
        return {"results": []}

    hit = PaperHit(
        paper_id="W1",
        title="Gene Ontology",
        source="openalex",
        doi="10.1038/75556",
    )
    candidates = pdf_candidates(hit, get_json=get_json)
    assert "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3037419/pdf/" in candidates
    assert html not in candidates


def test_unpaywall_maps_best_oa_pdf_url():
    def get_json(url, params=None, headers=None, timeout=None):
        assert "unpaywall.org" in url
        assert params and "email" in params
        return {
            "best_oa_location": {"url_for_pdf": "https://oa.example/paper.pdf"},
            "oa_locations": [{"url_for_pdf": "https://oa.example/other.pdf"}],
        }

    urls = unpaywall_pdf_urls("10.3390/math13050856", get_json=get_json, settings=get_settings())
    assert urls[0] == "https://oa.example/paper.pdf"
    assert "https://oa.example/other.pdf" in urls


def test_import_403_then_real_pdf(kb):
    pdf = _tiny_pdf()
    request = PaperImportRequest(
        paper_id="abc123",
        source="semantic_scholar",
        title="OA paper",
        abstract="Body.",
        doi="10.1/x",
        pdf_url="https://example.com/blocked.pdf",
    )

    def get_json(url, params=None, headers=None, timeout=None):
        if "unpaywall.org" in url:
            return {"best_oa_location": {"url_for_pdf": "https://example.com/ok.pdf"}}
        return {"results": []}

    def get_bytes(url, timeout=None, max_bytes=None):
        if url.endswith("blocked.pdf"):
            raise RuntimeError("403 Forbidden")
        if url.endswith("ok.pdf"):
            return pdf, "application/pdf"
        raise AssertionError(f"unexpected url {url}")

    result = import_paper(request, kb, get_json=get_json, get_bytes=get_bytes)
    assert result.ingested == "pdf"
    assert result.pdf_url == "https://example.com/ok.pdf"
    assert result.paper_url == "https://doi.org/10.1/x"


def test_import_all_candidates_fail_stays_abstract(kb):
    request = PaperImportRequest(
        paper_id="paywall",
        source="semantic_scholar",
        title="Closed paper",
        abstract="Only the abstract is public.",
        doi="10.1/closed",
        pdf_url="https://example.com/paywall.pdf",
        url="https://publisher.example/article",
    )

    def get_json(url, params=None, headers=None, timeout=None):
        return {}

    def get_bytes(url, timeout=None, max_bytes=None):
        raise RuntimeError("403 Forbidden")

    result = import_paper(request, kb, get_json=get_json, get_bytes=get_bytes)
    assert result.ingested == "abstract"
    assert ABSTRACT_FALLBACK_WARNING in result.warnings
    assert result.pdf_url is None
    assert result.paper_url == "https://doi.org/10.1/closed"
