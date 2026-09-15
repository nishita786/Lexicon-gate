"""Paper draft generation and export tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.auth.sessions import clear_sessions
from app.services.auth.users import create_user
from app.services.llm.registry import reset_llm_cache
from app.services.paper_drafts import store as paper_store


def _auth_client(settings, monkeypatch, tmp_path, email: str):
    monkeypatch.setenv("SELFRAG_AUTH_REQUIRED", "true")
    monkeypatch.setenv("SELFRAG_LLM_PROVIDER", "extractive")
    from app.config import get_settings

    get_settings.cache_clear()
    reset_llm_cache()
    clear_sessions()
    monkeypatch.setattr(paper_store, "_ROOT", tmp_path / "paper_drafts")
    create_user(settings, email, "secret-pass", "Ada Lovelace")
    app = create_app()
    client = TestClient(app)
    login = client.post("/api/auth/login", json={"email": email, "password": "secret-pass"})
    assert login.status_code == 200
    return client


def test_paper_draft_requires_auth(settings, monkeypatch, tmp_path):
    monkeypatch.setenv("SELFRAG_AUTH_REQUIRED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_sessions()
    monkeypatch.setattr(paper_store, "_ROOT", tmp_path / "paper_drafts")
    client = TestClient(create_app())
    response = client.post("/api/paper-drafts/", json={"prompt": "test draft"})
    assert response.status_code == 401


def test_paper_draft_generate_update_export(settings, monkeypatch, tmp_path):
    client = _auth_client(settings, monkeypatch, tmp_path, "paper.user@example.com")

    created = client.post(
        "/api/paper-drafts/",
        json={
            "prompt": "Write an IEEE conference paper on hybrid retrieval for document QA",
            "format": "ieee_conference",
            "title_hint": "Hybrid Retrieval for Grounded QA",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["draft_id"]
    assert body["title"]
    assert body["authors"]
    assert "introduction" in body["sections"]
    assert body["sections"]["introduction"]
    assert body["status"] == "draft_outline"
    assert body["grounded"] is False
    assert body["references"]
    assert body.get("figures")
    assert len(body["figures"]) >= 1
    assert body["figures"][0].get("svg")
    assert any("Source needed" in r for r in body["references"]) or any(
        "exploratory" in n.lower() or "library" in n.lower() or "extractive" in n.lower()
        for n in body["notes"]
    )

    draft_id = body["draft_id"]
    updated = client.put(
        f"/api/paper-drafts/{draft_id}",
        json={
            "title": "Hybrid Retrieval for Grounded QA",
            "sections": {"conclusion": "We outlined a grounded drafting workflow."},
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Hybrid Retrieval for Grounded QA"
    assert "grounded drafting" in updated.json()["sections"]["conclusion"]

    listed = client.get("/api/paper-drafts/")
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    detail = client.get(f"/api/paper-drafts/{draft_id}")
    assert detail.status_code == 200

    docx = client.get(f"/api/paper-drafts/{draft_id}/export.docx")
    assert docx.status_code == 200
    assert len(docx.content) > 1000
    assert docx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    pdf = client.get(f"/api/paper-drafts/{draft_id}/export.pdf")
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"
    assert len(pdf.content) > 500

    preview = client.get(f"/api/paper-drafts/{draft_id}/preview.html")
    assert preview.status_code == 200
    html = preview.text
    assert "Hybrid Retrieval for Grounded QA" in html
    assert "twocol" in html or "table" in html.lower()
    assert "I. Introduction" in html or "Introduction" in html
    assert "<svg" in html
    assert "Fig." in html or "figcap" in html
    assert "text/html" in preview.headers["content-type"]

    deleted = client.delete(f"/api/paper-drafts/{draft_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/paper-drafts/{draft_id}").status_code == 404


def test_paper_preview_requires_auth(settings, monkeypatch, tmp_path):
    monkeypatch.setenv("SELFRAG_AUTH_REQUIRED", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    clear_sessions()
    monkeypatch.setattr(paper_store, "_ROOT", tmp_path / "paper_drafts")
    client = TestClient(create_app())
    response = client.get("/api/paper-drafts/fake-id/preview.html")
    assert response.status_code == 401


def test_original_figures_builder():
    from app.services.paper_drafts.figures import build_figures_from_specs

    figs = build_figures_from_specs(None, topic="Self-RAG verification")
    assert len(figs) >= 2
    assert all(f.svg and "<svg" in f.svg for f in figs)
    assert all(f.caption for f in figs)


def test_section_system_prompt_has_word_target():
    from app.services.paper_drafts import generate as gen

    assert "900" in gen._SECTION_SYSTEM
    assert "1400" in gen._SECTION_SYSTEM or "–1400" in gen._SECTION_SYSTEM
    assert "one-page" in gen._SECTION_SYSTEM.lower() or "forbid" in gen._SECTION_SYSTEM.lower()
    assert gen._SECTION_MAX_TOKENS >= 4000
    assert "180" in gen._ABSTRACT_SYSTEM or "250" in gen._ABSTRACT_SYSTEM


def test_concatenate_section_chunks():
    from app.services.paper_drafts.generate import _concatenate_section_chunks

    assert _concatenate_section_chunks("First half.", "Second half.") == "First half.\n\nSecond half."
    assert _concatenate_section_chunks("Only first", "") == "Only first"
    assert _concatenate_section_chunks("", "Only second") == "Only second"
    assert _concatenate_section_chunks("  a  ", "  b  ") == "a\n\nb"


def test_length_note_reports_word_count():
    from app.services.paper_drafts.generate import _length_note

    sections = {
        "abstract": "one two three",
        "keywords": "",
        "introduction": "four five",
        "related_work": "",
        "methodology": "",
        "results": "",
        "conclusion": "six",
    }
    note = _length_note(sections, target_pages=True)
    assert "words" in note.lower()
    assert "10" in note
    skeleton = _length_note(sections, target_pages=False)
    assert "extractive" in skeleton.lower()
