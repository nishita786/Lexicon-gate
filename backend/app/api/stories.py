"""Write / Stories API — draft, publish, and public read."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, Response

from .auth import current_user_from_request
from ..models.stories import (
    PublicStory,
    Story,
    StoryCreate,
    StoryListResponse,
    StoryUpdate,
)
from ..services.stories import store as story_store

router = APIRouter(prefix="/stories", tags=["stories"])


def _require_user(request: Request) -> dict:
    user = current_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


def _user_id(user: dict) -> str:
    return str(user.get("user_id") or user.get("id") or "")


def _to_public(story: Story) -> PublicStory:
    return PublicStory(
        story_id=story.story_id,
        slug=story.slug,
        title=story.title,
        body_md=story.body_md,
        excerpt=story.excerpt,
        author_name=story.author_name,
        author_researcher_id=story.author_researcher_id,
        published_at=story.published_at,
        updated_at=story.updated_at,
    )


@router.get("/public", response_model=StoryListResponse)
def public_feed(limit: int = Query(default=40, ge=1, le=100)) -> StoryListResponse:
    stories = story_store.list_public(limit=limit)
    return StoryListResponse(stories=stories, total=len(stories))


@router.get("/public/{slug}", response_model=PublicStory)
def public_story(slug: str) -> PublicStory:
    story = story_store.get_public_by_slug(slug)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found.")
    return _to_public(story)


@router.get("/mine", response_model=StoryListResponse)
def list_mine(request: Request) -> StoryListResponse:
    user = _require_user(request)
    stories = story_store.list_mine(_user_id(user))
    return StoryListResponse(stories=stories, total=len(stories))


@router.post("", response_model=Story)
def create_story(payload: StoryCreate, request: Request) -> Story:
    user = _require_user(request)
    return story_store.create_story(
        title=payload.title,
        body_md=payload.body_md or "",
        author_user_id=_user_id(user),
        author_name=str(user.get("name") or ""),
        author_researcher_id=str(user.get("researcher_id") or ""),
    )


@router.get("/{story_id}", response_model=Story)
def get_story(story_id: str, request: Request) -> Story:
    user = _require_user(request)
    story = story_store.get_story(story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found.")
    if story.author_user_id != _user_id(user):
        raise HTTPException(status_code=403, detail="Only the author can view this draft.")
    return story


@router.patch("/{story_id}", response_model=Story)
def update_story(story_id: str, payload: StoryUpdate, request: Request) -> Story:
    user = _require_user(request)
    try:
        return story_store.update_story(
            story_id,
            author_user_id=_user_id(user),
            title=payload.title,
            body_md=payload.body_md,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{story_id}/publish", response_model=Story)
def publish_story(story_id: str, request: Request) -> Story:
    user = _require_user(request)
    try:
        return story_store.publish_story(story_id, author_user_id=_user_id(user))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{story_id}/unpublish", response_model=Story)
def unpublish_story(story_id: str, request: Request) -> Story:
    user = _require_user(request)
    try:
        return story_store.unpublish_story(story_id, author_user_id=_user_id(user))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete("/{story_id}", status_code=204)
def delete_story(story_id: str, request: Request) -> Response:
    user = _require_user(request)
    try:
        story_store.delete_story(story_id, author_user_id=_user_id(user))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=204)
