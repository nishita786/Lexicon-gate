"""IEEE / conference paper draft API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from .auth import current_user_from_request
from ..models.paper_drafts import (
    PaperDraft,
    PaperDraftListResponse,
    PaperDraftRequest,
    PaperDraftUpdate,
)
from ..services.paper_drafts import generate_ieee_draft, store
from ..services.paper_drafts.export import build_docx, build_pdf, build_preview_html

router = APIRouter(prefix="/paper-drafts", tags=["paper-drafts"])


def _require_user(request: Request) -> dict:
    user = current_user_from_request(request)
    if user is None or not user.get("user_id"):
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


@router.post("/", response_model=PaperDraft)
def create_paper_draft(payload: PaperDraftRequest, request: Request) -> PaperDraft:
    user = _require_user(request)
    prompt = (payload.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")
    if payload.format != "ieee_conference":
        raise HTTPException(status_code=400, detail="Unsupported paper format.")
    try:
        generated = generate_ieee_draft(
            prompt=prompt,
            author_name=str(user.get("name") or ""),
            document_ids=payload.document_ids,
            title_hint=payload.title_hint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Draft generation failed: {exc}") from exc

    return store.create_draft(
        str(user["user_id"]),
        prompt=prompt,
        title=generated["title"],
        authors=generated["authors"],
        sections=generated["sections"],
        references=generated["references"],
        document_ids=generated["document_ids"],
        status=generated["status"],
        grounded=generated["grounded"],
        provider=generated["provider"],
        notes=generated["notes"],
        paper_format=payload.format,
    )


@router.get("/", response_model=PaperDraftListResponse)
def list_paper_drafts(
    request: Request,
    limit: int = Query(default=20, ge=1, le=50),
) -> PaperDraftListResponse:
    user = _require_user(request)
    drafts = store.list_drafts(str(user["user_id"]), limit=limit)
    return PaperDraftListResponse(drafts=drafts, total=len(drafts))


@router.get("/{draft_id}", response_model=PaperDraft)
def get_paper_draft(draft_id: str, request: Request) -> PaperDraft:
    user = _require_user(request)
    draft = store.get_draft(str(user["user_id"]), draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return draft


@router.put("/{draft_id}", response_model=PaperDraft)
def update_paper_draft(draft_id: str, payload: PaperDraftUpdate, request: Request) -> PaperDraft:
    user = _require_user(request)
    draft = store.update_draft(
        str(user["user_id"]),
        draft_id,
        title=payload.title,
        authors=payload.authors,
        sections=payload.sections,
        references=payload.references,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return draft


@router.delete("/{draft_id}", status_code=204)
def delete_paper_draft(draft_id: str, request: Request) -> Response:
    user = _require_user(request)
    if not store.delete_draft(str(user["user_id"]), draft_id):
        raise HTTPException(status_code=404, detail="Draft not found.")
    return Response(status_code=204)


@router.get("/{draft_id}/preview.html")
def preview_paper_html(draft_id: str, request: Request) -> Response:
    user = _require_user(request)
    draft = store.get_draft(str(user["user_id"]), draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found.")
    html = build_preview_html(draft)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/{draft_id}/export.docx")
def export_paper_docx(draft_id: str, request: Request) -> Response:
    user = _require_user(request)
    draft = store.get_draft(str(user["user_id"]), draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found.")
    data = build_docx(draft)
    filename = _safe_filename(draft.title or "paper") + ".docx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{draft_id}/export.pdf")
def export_paper_pdf(draft_id: str, request: Request) -> Response:
    user = _require_user(request)
    draft = store.get_draft(str(user["user_id"]), draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found.")
    try:
        data = build_pdf(draft)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc
    filename = _safe_filename(draft.title or "paper") + ".pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _safe_filename(title: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in title.strip())
    cleaned = "_".join(cleaned.split())[:80] or "paper"
    return cleaned
