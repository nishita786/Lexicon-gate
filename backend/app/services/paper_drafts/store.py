"""Per-user IEEE paper draft persistence."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ...config import BACKEND_ROOT
from ...models.paper_drafts import (
    PaperDraft,
    PaperFigure,
    empty_sections,
    normalize_figures,
    normalize_sections,
)

_ROOT = BACKEND_ROOT / "data" / "paper_drafts"
_LOCK = threading.RLock()
_MAX_PER_USER = 40


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_path(user_id: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (user_id or "anon"))
    root = _ROOT.resolve()
    path = (root / f"{safe}.json").resolve()
    if path.parent != root:
        raise ValueError("Invalid paper draft path.")
    return path


def _read(user_id: str) -> list[dict]:
    path = _user_path(user_id)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = payload.get("drafts", []) if isinstance(payload, dict) else payload
    return items if isinstance(items, list) else []


def _write(user_id: str, items: list[dict]) -> None:
    path = _user_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"drafts": items}, indent=2) + "\n", encoding="utf-8")


def create_draft(
    user_id: str,
    *,
    prompt: str,
    title: str = "",
    authors: str = "",
    sections: dict[str, str] | None = None,
    references: list[str] | None = None,
    figures: list[PaperFigure] | list[dict] | None = None,
    document_ids: list[str] | None = None,
    status: str = "ready",
    grounded: bool = False,
    provider: str = "",
    notes: list[str] | None = None,
    generation_steps: list[str] | None = None,
    paper_format: str = "ieee_conference",
) -> PaperDraft:
    stamp = _now()
    draft = PaperDraft(
        draft_id=str(uuid.uuid4()),
        user_id=user_id,
        prompt=(prompt or "").strip(),
        format=paper_format,  # type: ignore[arg-type]
        title=(title or "").strip() or "Untitled draft",
        authors=(authors or "").strip(),
        sections=normalize_sections(sections) if sections else empty_sections(),
        references=[str(r).strip() for r in (references or []) if str(r).strip()],
        figures=normalize_figures(figures),
        document_ids=list(document_ids or []),
        status=status,
        grounded=grounded,
        provider=provider or "",
        notes=list(notes or []),
        generation_steps=list(generation_steps or []),
        created_at=stamp,
        updated_at=stamp,
    )
    with _LOCK:
        items = _read(user_id)
        items.append(draft.model_dump(mode="json"))
        items = items[-_MAX_PER_USER:]
        _write(user_id, items)
    return draft


def list_drafts(user_id: str, limit: int = 20) -> list[PaperDraft]:
    with _LOCK:
        items = _read(user_id)
    out: list[PaperDraft] = []
    for raw in reversed(items):
        try:
            out.append(PaperDraft.model_validate(raw))
        except Exception:
            continue
        if len(out) >= limit:
            break
    return out


def get_draft(user_id: str, draft_id: str) -> PaperDraft | None:
    with _LOCK:
        items = _read(user_id)
    for raw in reversed(items):
        if str(raw.get("draft_id")) == draft_id:
            try:
                return PaperDraft.model_validate(raw)
            except Exception:
                return None
    return None


def update_draft(
    user_id: str,
    draft_id: str,
    *,
    title: str | None = None,
    authors: str | None = None,
    sections: dict[str, str] | None = None,
    references: list[str] | None = None,
    figures: list[PaperFigure] | list[dict] | None = None,
) -> PaperDraft | None:
    with _LOCK:
        items = _read(user_id)
        for idx, raw in enumerate(items):
            if str(raw.get("draft_id")) != draft_id:
                continue
            try:
                draft = PaperDraft.model_validate(raw)
            except Exception:
                return None
            if title is not None:
                draft.title = title.strip() or draft.title
            if authors is not None:
                draft.authors = authors.strip()
            if sections is not None:
                merged = dict(draft.sections)
                merged.update({k: str(v) for k, v in sections.items()})
                draft.sections = normalize_sections(merged)
            if references is not None:
                draft.references = [str(r).strip() for r in references if str(r).strip()]
            if figures is not None:
                draft.figures = normalize_figures(figures)
            draft.updated_at = _now()
            items[idx] = draft.model_dump(mode="json")
            _write(user_id, items)
            return draft
    return None


def delete_draft(user_id: str, draft_id: str) -> bool:
    with _LOCK:
        items = _read(user_id)
        kept = [raw for raw in items if str(raw.get("draft_id")) != draft_id]
        if len(kept) == len(items):
            return False
        _write(user_id, kept)
        return True
