"""Workspace research recents API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from .auth import current_user_from_request
from ..models.workspace import (
    PaperSearchRecord,
    PaperSearchSaveRequest,
    WorkspaceRecentItem,
    WorkspaceRecentsResponse,
)
from ..services.store.history import history
from ..services.workspace import paper_searches

router = APIRouter(prefix="/workspace", tags=["workspace"])


def _require_user(request: Request) -> dict:
    user = current_user_from_request(request)
    if user is None or not user.get("user_id"):
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


@router.get("/recents", response_model=WorkspaceRecentsResponse)
def workspace_recents(
    request: Request,
    limit: int = Query(default=24, ge=1, le=50),
) -> WorkspaceRecentsResponse:
    user = _require_user(request)
    user_id = str(user["user_id"])
    items: list[WorkspaceRecentItem] = []

    for result in history.recent(limit):
        items.append(
            WorkspaceRecentItem(
                kind="ask",
                id=result.query_id,
                query=result.query,
                created_at=None,
                status=result.status,
                confidence=result.confidence.confidence if result.confidence else None,
                meta={
                    "pipeline": result.pipeline,
                    "pipeline_label": result.pipeline_label,
                    "latency_ms": result.metrics.latency_ms if result.metrics else None,
                },
            )
        )

    for record in paper_searches.list_paper_searches(user_id, limit=limit):
        items.append(
            WorkspaceRecentItem(
                kind="papers",
                id=record.search_id,
                query=record.query,
                created_at=record.created_at,
                provider=record.provider,
                paper_count=len(record.papers),
            )
        )

    # Prefer explicit timestamps for papers; Ask items (no stamp) stay near top by insertion order.
    items.sort(
        key=lambda item: item.created_at or "",
        reverse=True,
    )
    # Stable-ish merge: papers with timestamps first by time; ask items without stamps
    # should still appear. Put ask items (None created_at) after dated paper items by
    # interleaving with ask first when stamps missing.
    ask_items = [i for i in items if i.kind == "ask"]
    paper_items = [i for i in items if i.kind == "papers"]
    merged: list[WorkspaceRecentItem] = []
    # Papers already newest-first; ask already newest-first from history.recent.
    # Interleave by taking from ask then papers to keep both visible.
    ai = pi = 0
    while len(merged) < limit and (ai < len(ask_items) or pi < len(paper_items)):
        if ai < len(ask_items):
            merged.append(ask_items[ai])
            ai += 1
        if len(merged) >= limit:
            break
        if pi < len(paper_items):
            merged.append(paper_items[pi])
            pi += 1

    return WorkspaceRecentsResponse(items=merged, total=len(merged))


@router.post("/paper-searches", response_model=PaperSearchRecord)
def save_paper_search(payload: PaperSearchSaveRequest, request: Request) -> PaperSearchRecord:
    user = _require_user(request)
    try:
        return paper_searches.save_paper_search(
            str(user["user_id"]),
            query=payload.query,
            provider=payload.provider,
            papers=payload.papers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/paper-searches/{search_id}", response_model=PaperSearchRecord)
def get_paper_search(search_id: str, request: Request) -> PaperSearchRecord:
    user = _require_user(request)
    record = paper_searches.get_paper_search(str(user["user_id"]), search_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Paper search not found.")
    return record


@router.delete("/recents/ask/{query_id}", status_code=204)
def delete_ask_recent(query_id: str, request: Request) -> None:
    _require_user(request)
    if not history.delete(query_id):
        raise HTTPException(status_code=404, detail="Ask recent not found.")


@router.delete("/recents/papers/{search_id}", status_code=204)
def delete_papers_recent(search_id: str, request: Request) -> None:
    user = _require_user(request)
    if not paper_searches.delete_paper_search(str(user["user_id"]), search_id):
        raise HTTPException(status_code=404, detail="Paper search not found.")
