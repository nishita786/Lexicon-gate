"""API endpoint tests via FastAPI's TestClient."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.services.embeddings.registry import reset_embedding_cache
from app.services.llm.registry import reset_llm_cache
from app.services.store.knowledge_base import reset_knowledge_base
from app.services.vectorstore.registry import reset_vector_store_cache


@pytest.fixture
def client(settings, monkeypatch):
    reset_knowledge_base()
    reset_llm_cache()
    reset_embedding_cache()
    reset_vector_store_cache()
    get_settings.cache_clear()
    monkeypatch.setenv("SELFRAG_DATA_DIR", str(settings.data_dir))
    monkeypatch.setenv("SELFRAG_LLM_PROVIDER", "extractive")
    monkeypatch.setenv("SELFRAG_EMBEDDING_PROVIDER", "lsa")
    monkeypatch.setenv("SELFRAG_VECTOR_STORE", "numpy")
    # Recreate settings cache so the app sees the temp dirs.
    from app import config as config_mod

    config_mod.settings = settings
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    reset_knowledge_base()
    get_settings.cache_clear()


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["knowledge_base"]["chunks"] == 0


def test_list_documents(client: TestClient):
    response = client.get("/api/documents")
    assert response.status_code == 200
    assert response.json()["total_documents"] == 0


LONG_PLAGIARISM = (
    "Dropout randomly disables units in a neural network during training so that "
    "hidden units cannot co-adapt and the model generalises better on unseen data."
)


def test_plagiarism_check_empty_library(client: TestClient, monkeypatch):
    monkeypatch.setattr("app.verification.plagiarism.search_papers", lambda *a, **k: ([], "none"))
    response = client.post(
        "/api/plagiarism/check",
        files={"file": ("unique.txt", b"A wholly original note about garden soil pH.\n", "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["similarity"] == 0
    assert body["originality"] == 1
    assert body["library_empty"] is True
    assert body["filename"] == "unique.txt"
    assert client.get("/api/documents").json()["total_documents"] == 0


def test_plagiarism_check_against_library_does_not_ingest(client: TestClient, monkeypatch):
    monkeypatch.setattr("app.verification.plagiarism.search_papers", lambda *a, **k: ([], "none"))
    ingested = client.post(
        "/api/documents/upload",
        files=[("files", ("handbook.md", f"# Handbook\n\n{LONG_PLAGIARISM}\n".encode(), "text/markdown"))],
    )
    assert ingested.status_code == 200
    before = client.get("/api/documents").json()["total_documents"]
    copied = (
        "Notes for class.\n\n"
        f"{LONG_PLAGIARISM}\n\n"
        "The rest of this draft is my own wording about coursework deadlines.\n"
    )
    checked = client.post(
        "/api/plagiarism/check",
        files={"file": ("draft.txt", copied.encode(), "text/plain")},
    )
    assert checked.status_code == 200
    body = checked.json()
    assert body["library_empty"] is False
    assert body["similarity"] > 0
    assert body["originality"] < 1
    assert body["sources"]
    assert "handbook" in body["sources"][0]["document_name"].lower()
    assert body["flagged_sentences"]
    after = client.get("/api/documents").json()["total_documents"]
    assert after == before


def test_plagiarism_check_academic_abstract(client: TestClient, monkeypatch):
    from app.models.papers import PaperHit

    def fake_search(query, limit=10, **kwargs):
        return (
            [
                PaperHit(
                    paper_id="abs-1",
                    title="Dropout regularisation",
                    abstract=LONG_PLAGIARISM,
                    source="semantic_scholar",
                    url="https://example.org/dropout",
                    doi="10.1/dropout",
                )
            ],
            "semantic_scholar",
        )

    monkeypatch.setattr("app.verification.plagiarism.search_papers", fake_search)
    copied = f"Class notes.\n\n{LONG_PLAGIARISM}\n"
    before = client.get("/api/documents").json()["total_documents"]
    checked = client.post(
        "/api/plagiarism/check",
        files={"file": ("draft.txt", copied.encode(), "text/plain")},
    )
    assert checked.status_code == 200
    body = checked.json()
    assert body["library_empty"] is True
    assert body["similarity"] > 0
    assert body["sources"]
    assert body["sources"][0]["origin"] == "academic"
    assert "dropout" in body["sources"][0]["document_name"].lower()
    assert body["sources"][0]["url"]
    assert client.get("/api/documents").json()["total_documents"] == before


def test_plagiarism_check_academic_search_fails(client: TestClient, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("index down")

    monkeypatch.setattr("app.verification.plagiarism.search_papers", boom)
    response = client.post(
        "/api/plagiarism/check",
        files={"file": ("unique.txt", b"A wholly original note about garden soil pH.\n", "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["similarity"] == 0
    assert any("unavailable" in flag.lower() for flag in body["flags"])


def test_clusters_empty(client: TestClient):
    response = client.get("/api/documents/clusters")
    assert response.status_code == 200
    body = response.json()
    assert body["total_documents"] == 0
    assert body["clusters"] == []


def test_clusters_after_upload(client: TestClient):
    first = client.post(
        "/api/documents/upload",
        files=[
            (
                "files",
                (
                    "dropout.md",
                    b"# Dropout regularisation\n\nDropout reduces overfitting in neural networks.\n",
                    "text/markdown",
                ),
            )
        ],
    )
    assert first.status_code == 200
    second = client.post(
        "/api/documents/upload",
        files=[
            (
                "files",
                (
                    "climate.md",
                    b"# Climate change adaptation\n\nCoastal cities adapt to flooding and heat.\n",
                    "text/markdown",
                ),
            )
        ],
    )
    assert second.status_code == 200
    clustered = client.get("/api/documents/clusters")
    assert clustered.status_code == 200
    body = clustered.json()
    assert body["total_documents"] == 2
    assert len(body["clusters"]) >= 1
    assigned = [doc_id for cluster in body["clusters"] for doc_id in cluster["document_ids"]]
    assert len(assigned) == 2
    assert all(cluster["label"] for cluster in body["clusters"])


def test_upload_and_query(client: TestClient):
    upload = client.post(
        "/api/documents/upload",
        files=[
            (
                "files",
                (
                    "notes.md",
                    b"# Notes\n\nThe main advantage of dropout is that it reduces overfitting.\n",
                    "text/markdown",
                ),
            )
        ],
    )
    assert upload.status_code == 200
    assert upload.json()["total_chunks"] >= 1

    queried = client.post(
        "/api/query",
        json={"query": "What is the main advantage of dropout?", "pipeline": "traditional_rag"},
    )
    assert queried.status_code == 200
    body = queried.json()
    assert body["answer"]
    assert body["query_id"]
    assert body["pipeline"] == "enhanced_self_rag"
    if body.get("evidence"):
        cite = body["evidence"][0]
        assert "apa" in cite
        assert "bibtex" in cite
        assert "title" in cite
    saved = client.get(f"/api/query/history/{body['query_id']}")
    assert saved.status_code == 200
    assert saved.json()["query_id"] == body["query_id"]
    trace = client.get(f"/api/query/{body['query_id']}/trace")
    assert trace.status_code == 200
    assert trace.json()["trace"]


def test_compare_endpoint(client: TestClient):
    seeded = client.post("/api/documents/demo")
    assert seeded.status_code == 200
    response = client.post(
        "/api/query/compare",
        json={"query": "What is the main advantage of dropout?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["rows"]) == 3
    assert body["winner"]


def test_evaluate_small(client: TestClient):
    response = client.post(
        "/api/evaluate",
        json={
            "pipelines": ["traditional_rag", "enhanced_self_rag"],
            "include_ablation": False,
            "limit": 4,
            "persist": False,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["n_questions"] == 4
    assert len(body["systems"]) == 2


def test_patch_document_endpoint(client: TestClient):
    upload = client.post(
        "/api/documents/upload",
        files=[("files", ("notes.md", b"# Notes\n\nDropout reduces overfitting.\n", "text/markdown"))],
    )
    assert upload.status_code == 200
    doc_id = upload.json()["documents"][0]["document_id"]
    patched = client.patch(
        f"/api/documents/{doc_id}",
        json={"title": "Dropout notes", "authors": ["A. Researcher"], "year": 2022},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["title"] == "Dropout notes"
    assert body["authors"] == ["A. Researcher"]
    assert body["year"] == 2022


def test_papers_search_requires_query(client: TestClient):
    response = client.get("/api/papers/search?q=")
    assert response.status_code == 400


def test_papers_search_endpoint(client: TestClient, monkeypatch):
    from app.models.papers import PaperHit

    def fake_search(query, limit=10, **kwargs):
        return (
            [
                PaperHit(
                    paper_id="abc",
                    title="Dropout",
                    authors=["N. Srivastava"],
                    year=2014,
                    source="semantic_scholar",
                )
            ],
            "semantic_scholar",
        )

    monkeypatch.setattr("app.api.routes.search_papers", fake_search)
    response = client.get("/api/papers/search", params={"q": "dropout"})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "semantic_scholar"
    assert body["papers"][0]["title"] == "Dropout"


def test_papers_search_does_not_500_when_indexes_fail(client: TestClient, monkeypatch):
    def fake_search(query, limit=10, **kwargs):
        return [], "crossref"

    monkeypatch.setattr("app.api.routes.search_papers", fake_search)
    response = client.get("/api/papers/search", params={"q": "deep learning"})
    assert response.status_code == 200
    assert response.json()["papers"] == []


def test_papers_import_endpoint(client: TestClient, monkeypatch):
    from app.models.documents import Document

    def fake_import(request, kb, **kwargs):
        doc = Document(
            document_id="doc-1",
            name="dropout.md",
            title=request.title or "Dropout",
            authors=request.authors or [],
            year=request.year,
        )
        from app.services.papers.import_paper import PaperImportResult

        return PaperImportResult(
            document=doc,
            ingested="abstract",
            warnings=[],
            paper_url="https://doi.org/10.1/x",
            pdf_url=None,
        )

    monkeypatch.setattr("app.api.routes.import_paper", fake_import)
    response = client.post(
        "/api/papers/import",
        json={
            "paper_id": "abc",
            "source": "semantic_scholar",
            "title": "Dropout",
            "authors": ["N. Srivastava"],
            "year": 2014,
            "abstract": "We present dropout.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ingested"] == "abstract"
    assert body["document"]["title"] == "Dropout"
    assert body["paper_url"] == "https://doi.org/10.1/x"
