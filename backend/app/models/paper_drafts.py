"""IEEE / conference paper draft models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

PaperFormat = Literal["ieee_conference"]

SECTION_ORDER: tuple[str, ...] = (
    "abstract",
    "keywords",
    "introduction",
    "related_work",
    "methodology",
    "results",
    "conclusion",
)

SECTION_LABELS: dict[str, str] = {
    "abstract": "Abstract",
    "keywords": "Keywords",
    "introduction": "I. Introduction",
    "related_work": "II. Related Work",
    "methodology": "III. Methodology",
    "results": "IV. Results / Discussion",
    "conclusion": "V. Conclusion",
}

BODY_SECTIONS: tuple[str, ...] = (
    "introduction",
    "related_work",
    "methodology",
    "results",
)


class PaperFigure(BaseModel):
    figure_id: str = ""
    caption: str = ""
    kind: str = "pipeline"  # pipeline | architecture | comparison
    section_anchor: str = "methodology"
    svg: str = ""
    nodes: list[str] = Field(default_factory=list)
    edges: list[list[str]] = Field(default_factory=list)


class PaperDraftRequest(BaseModel):
    prompt: str = Field(min_length=1)
    format: PaperFormat = "ieee_conference"
    document_ids: list[str] = Field(default_factory=list)
    title_hint: str | None = None


class PaperDraftUpdate(BaseModel):
    title: str | None = None
    authors: str | None = None
    sections: dict[str, str] | None = None
    references: list[str] | None = None
    figures: list[PaperFigure] | None = None


class PaperDraft(BaseModel):
    draft_id: str
    user_id: str
    prompt: str
    format: PaperFormat = "ieee_conference"
    title: str = ""
    authors: str = ""
    sections: dict[str, str] = Field(default_factory=dict)
    references: list[str] = Field(default_factory=list)
    figures: list[PaperFigure] = Field(default_factory=list)
    document_ids: list[str] = Field(default_factory=list)
    status: str = "ready"
    grounded: bool = False
    provider: str = ""
    notes: list[str] = Field(default_factory=list)
    generation_steps: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class PaperDraftListResponse(BaseModel):
    drafts: list[PaperDraft] = Field(default_factory=list)
    total: int = 0


def empty_sections() -> dict[str, str]:
    return {key: "" for key in SECTION_ORDER}


def normalize_sections(raw: dict[str, Any] | None) -> dict[str, str]:
    out = empty_sections()
    if not isinstance(raw, dict):
        return out
    for key in SECTION_ORDER:
        value = raw.get(key)
        if value is None:
            continue
        out[key] = str(value).strip()
    return out


def normalize_figures(raw: list[Any] | None) -> list[PaperFigure]:
    out: list[PaperFigure] = []
    if not raw:
        return out
    for idx, item in enumerate(raw, start=1):
        if isinstance(item, PaperFigure):
            fig = item
        elif isinstance(item, dict):
            try:
                fig = PaperFigure.model_validate(item)
            except Exception:
                continue
        else:
            continue
        if not fig.figure_id:
            fig.figure_id = f"fig{idx}"
        out.append(fig)
    return out
