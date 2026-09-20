"""JSON persistence for Write / Stories.

Stories: ``backend/data/stories/{story_id}.json``
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from ...config import BACKEND_ROOT
from ...models.stories import Story, StoryListItem

_ROOT = BACKEND_ROOT / "data" / "stories"
_LOCK = threading.RLock()
_LOCK_STATE = threading.local()

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_EXCERPT_LEN = 220


@contextmanager
def _store_lock() -> Iterator[None]:
    depth = getattr(_LOCK_STATE, "depth", 0)
    _ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = _ROOT / ".store.lock"
    with _LOCK:
        if depth == 0:
            fh = lock_path.open("a+")
            try:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            except (ImportError, OSError):
                pass
            _LOCK_STATE.fh = fh
        _LOCK_STATE.depth = depth + 1
        try:
            yield
        finally:
            _LOCK_STATE.depth = depth
            if depth == 0:
                fh = getattr(_LOCK_STATE, "fh", None)
                if fh is not None:
                    try:
                        import fcntl

                        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
                    except (ImportError, OSError):
                        pass
                    fh.close()
                    _LOCK_STATE.fh = None


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_id(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (value or ""))
    if not safe or safe != value:
        raise ValueError("Invalid story id.")
    return safe


def _path_for(story_id: str) -> Path:
    safe = _safe_id(story_id)
    root = _ROOT.resolve()
    path = (root / f"{safe}.json").resolve()
    if not str(path).startswith(str(root)):
        raise ValueError("Invalid story id.")
    return path


def slugify(title: str) -> str:
    base = _SLUG_RE.sub("-", (title or "").lower()).strip("-")
    return base[:80] or "story"


def make_excerpt(body_md: str) -> str:
    text = re.sub(r"[#>*`_\[\]()]+", " ", body_md or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= _EXCERPT_LEN:
        return text
    return text[:_EXCERPT_LEN].rsplit(" ", 1)[0].strip() + "…"


def _to_list_item(story: Story) -> StoryListItem:
    return StoryListItem(
        story_id=story.story_id,
        slug=story.slug,
        title=story.title,
        excerpt=story.excerpt,
        author_user_id=story.author_user_id,
        author_name=story.author_name,
        author_researcher_id=story.author_researcher_id,
        status=story.status,
        created_at=story.created_at,
        updated_at=story.updated_at,
        published_at=story.published_at,
    )


def _load(story_id: str) -> Story | None:
    path = _path_for(story_id)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return Story.model_validate(data)


def _save(story: Story) -> Story:
    path = _path_for(story.story_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(story.model_dump_json(indent=2), encoding="utf-8")
    return story


def _all_stories() -> list[Story]:
    _ROOT.mkdir(parents=True, exist_ok=True)
    stories: list[Story] = []
    for path in _ROOT.glob("*.json"):
        if path.name.startswith("."):
            continue
        try:
            stories.append(Story.model_validate(json.loads(path.read_text(encoding="utf-8"))))
        except Exception:
            continue
    return stories


def _unique_slug(base: str, *, exclude_id: str | None = None) -> str:
    candidate = slugify(base)
    existing = {
        s.slug
        for s in _all_stories()
        if exclude_id is None or s.story_id != exclude_id
    }
    if candidate not in existing:
        return candidate
    n = 2
    while f"{candidate}-{n}" in existing:
        n += 1
    return f"{candidate}-{n}"


def create_story(
    *,
    title: str,
    body_md: str,
    author_user_id: str,
    author_name: str = "",
    author_researcher_id: str = "",
) -> Story:
    with _store_lock():
        now = _utcnow_iso()
        story_id = uuid.uuid4().hex
        story = Story(
            story_id=story_id,
            slug=_unique_slug(title),
            title=title.strip(),
            body_md=body_md or "",
            excerpt=make_excerpt(body_md or ""),
            author_user_id=author_user_id,
            author_name=author_name or "",
            author_researcher_id=author_researcher_id or "",
            status="draft",
            created_at=now,
            updated_at=now,
            published_at=None,
        )
        return _save(story)


def get_story(story_id: str) -> Story | None:
    with _store_lock():
        try:
            return _load(story_id)
        except ValueError:
            return None


def list_mine(author_user_id: str) -> list[StoryListItem]:
    with _store_lock():
        mine = [s for s in _all_stories() if s.author_user_id == author_user_id]
        mine.sort(key=lambda s: s.updated_at, reverse=True)
        return [_to_list_item(s) for s in mine]


def list_public(*, limit: int = 50) -> list[StoryListItem]:
    with _store_lock():
        published = [s for s in _all_stories() if s.status == "published"]
        published.sort(
            key=lambda s: s.published_at or s.updated_at,
            reverse=True,
        )
        return [_to_list_item(s) for s in published[: max(1, min(limit, 100))]]


def get_public_by_slug(slug: str) -> Story | None:
    with _store_lock():
        needle = (slug or "").strip().lower()
        if not needle:
            return None
        for story in _all_stories():
            if story.slug == needle and story.status == "published":
                return story
        return None


def update_story(
    story_id: str,
    *,
    author_user_id: str,
    title: str | None = None,
    body_md: str | None = None,
) -> Story:
    with _store_lock():
        story = _load(story_id)
        if story is None:
            raise LookupError("Story not found.")
        if story.author_user_id != author_user_id:
            raise PermissionError("Only the author can edit this story.")
        if title is not None:
            story.title = title.strip()
            # Keep slug stable after first publish; refresh when still draft.
            if story.status == "draft":
                story.slug = _unique_slug(story.title, exclude_id=story.story_id)
        if body_md is not None:
            story.body_md = body_md
            story.excerpt = make_excerpt(body_md)
        story.updated_at = _utcnow_iso()
        return _save(story)


def publish_story(story_id: str, *, author_user_id: str) -> Story:
    with _store_lock():
        story = _load(story_id)
        if story is None:
            raise LookupError("Story not found.")
        if story.author_user_id != author_user_id:
            raise PermissionError("Only the author can publish this story.")
        if not (story.title or "").strip():
            raise ValueError("Add a title before publishing.")
        if not (story.body_md or "").strip():
            raise ValueError("Add some writing before publishing.")
        now = _utcnow_iso()
        story.status = "published"
        story.published_at = story.published_at or now
        story.updated_at = now
        story.excerpt = make_excerpt(story.body_md)
        return _save(story)


def unpublish_story(story_id: str, *, author_user_id: str) -> Story:
    with _store_lock():
        story = _load(story_id)
        if story is None:
            raise LookupError("Story not found.")
        if story.author_user_id != author_user_id:
            raise PermissionError("Only the author can unpublish this story.")
        story.status = "draft"
        story.updated_at = _utcnow_iso()
        return _save(story)


def delete_story(story_id: str, *, author_user_id: str) -> None:
    with _store_lock():
        story = _load(story_id)
        if story is None:
            raise LookupError("Story not found.")
        if story.author_user_id != author_user_id:
            raise PermissionError("Only the author can delete this story.")
        path = _path_for(story_id)
        if path.exists():
            path.unlink()
