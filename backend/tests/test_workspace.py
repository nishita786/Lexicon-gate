"""Workspace research recents tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.models.query import AnswerStatus, PipelineName, PipelineResult
from app.services.auth.sessions import clear_sessions
from app.services.auth.users import create_user
from app.services.store.history import history
from app.services.workspace import paper_searches


def _auth_client(settings, monkeypatch, tmp_path, email: str):
    monkeypatch.setenv("SELFRAG_AUTH_REQUIRED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_sessions()
    monkeypatch.setattr(paper_searches, "_ROOT", tmp_path / "workspace")
    create_user(settings, email, "secret-pass", "Workspace")
    app = create_app()
    client = TestClient(app)
    login = client.post("/api/auth/login", json={"email": email, "password": "secret-pass"})
    assert login.status_code == 200
    return client


def test_workspace_paper_search_and_recents(settings, monkeypatch, tmp_path):
    client = _auth_client(settings, monkeypatch, tmp_path, "workspace.user@example.com")

    saved = client.post(
        "/api/workspace/paper-searches",
        json={
            "query": "self-rag verification",
            "provider": "semantic_scholar",
            "papers": [
                {
                    "paper_id": "p1",
                    "title": "Self-RAG",
                    "authors": ["A"],
                    "year": 2024,
                    "source": "semantic_scholar",
                    "url": "https://example.com/p1",
                }
            ],
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["query"] == "self-rag verification"
    assert body["search_id"]
    assert len(body["papers"]) == 1

    detail = client.get(f"/api/workspace/paper-searches/{body['search_id']}")
    assert detail.status_code == 200
    assert detail.json()["papers"][0]["title"] == "Self-RAG"

    recents = client.get("/api/workspace/recents")
    assert recents.status_code == 200
    payload = recents.json()
    assert payload["total"] >= 1
    assert any(item["kind"] == "papers" and item["query"] == "self-rag verification" for item in payload["items"])


def test_workspace_delete_paper_and_ask_recents(settings, monkeypatch, tmp_path):
    client = _auth_client(settings, monkeypatch, tmp_path, "workspace.delete@example.com")

    saved = client.post(
        "/api/workspace/paper-searches",
        json={
            "query": "delete me papers",
            "provider": "openalex",
            "papers": [
                {
                    "paper_id": "p-del",
                    "title": "Delete Paper",
                    "authors": ["B"],
                    "year": 2023,
                    "source": "openalex",
                    "url": "https://example.com/p-del",
                }
            ],
        },
    )
    assert saved.status_code == 200
    search_id = saved.json()["search_id"]

    deleted = client.delete(f"/api/workspace/recents/papers/{search_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/workspace/paper-searches/{search_id}").status_code == 404
    assert client.delete(f"/api/workspace/recents/papers/{search_id}").status_code == 404

    ask_id = "ask-delete-test-id"
    history.add(
        PipelineResult(
            query_id=ask_id,
            pipeline=PipelineName.enhanced,
            pipeline_label="Enhanced",
            query="delete me ask",
            answer="gone",
            status=AnswerStatus.answered,
        )
    )
    assert any(item["id"] == ask_id for item in client.get("/api/workspace/recents").json()["items"])

    ask_deleted = client.delete(f"/api/workspace/recents/ask/{ask_id}")
    assert ask_deleted.status_code == 204
    assert client.delete(f"/api/workspace/recents/ask/{ask_id}").status_code == 404
    assert not any(
        item["kind"] == "ask" and item["id"] == ask_id
        for item in client.get("/api/workspace/recents").json()["items"]
    )
    assert not any(
        item["kind"] == "papers" and item["id"] == search_id
        for item in client.get("/api/workspace/recents").json()["items"]
    )
