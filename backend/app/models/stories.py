"""Public Write / Stories models (Medium-style freeform posts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

StoryStatus = Literal["draft", "published"]


class Story(BaseModel):
    story_id: str
    slug: str
    title: str
    body_md: str = ""
    excerpt: str = ""
    author_user_id: str
    author_name: str = ""
    author_researcher_id: str = ""
    status: StoryStatus = "draft"
    created_at: str
    updated_at: str
    published_at: str | None = None


class StoryCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body_md: str = Field(default="", max_length=200_000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned


class StoryUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body_md: str | None = Field(default=None, max_length=200_000)

    @field_validator("title")
    @classmethod
    def title_not_blank_if_set(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title cannot be empty.")
        return cleaned


class StoryListItem(BaseModel):
    story_id: str
    slug: str
    title: str
    excerpt: str = ""
    author_user_id: str
    author_name: str = ""
    author_researcher_id: str = ""
    status: StoryStatus
    created_at: str
    updated_at: str
    published_at: str | None = None


class StoryListResponse(BaseModel):
    stories: list[StoryListItem]
    total: int


class PublicStory(BaseModel):
    """Published story payload safe for anonymous readers."""

    story_id: str
    slug: str
    title: str
    body_md: str
    excerpt: str = ""
    author_name: str = ""
    author_researcher_id: str = ""
    published_at: str | None = None
    updated_at: str
