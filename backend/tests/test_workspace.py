"""Workspace research recents tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.auth.sessions import clear_sessions
from app.services.auth.users import create_user
from app.services.workspace import paper_searches


def test_workspace_paper_search_and_recents(settings, monkeypatch, tmp_path):
    monkeypatch.setenv("SELFRAG_AUTH_REQUIRED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_sessions()

    # Isolate paper-search store under tmp
    monkeypatch.setattr(paper_searches, "_ROOT", tmp_path / "workspace")

    user = create_user(settings, "workspace.user@example.com", "secret-pass", "Workspace")
    app = create_app()
    client = TestClient(app)
    login = client.post(
        "/api/auth/login",
        json={"email": "workspace.user@example.com", "password": "secret-pass"},
    )
    assert login.status_code == 200

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
    assert user["user_id"]
