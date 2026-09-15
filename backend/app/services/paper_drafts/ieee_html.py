"""IEEE conference-style HTML for live preview and PDF export."""

from __future__ import annotations

import re
from html import escape
from typing import Literal

from ...models.paper_drafts import SECTION_LABELS, SECTION_ORDER, PaperDraft

HtmlMode = Literal["preview", "pdf"]

# Abstract/keywords stay full-width; remaining keys flow in two columns.
_COLUMN_KEYS = tuple(k for k in SECTION_ORDER if k not in ("abstract", "keywords"))


def render_ieee_html(draft: PaperDraft, *, mode: HtmlMode = "preview") -> str:
    title = escape(draft.title or "Untitled draft")
    authors = escape(draft.authors or "Author")
    sections = draft.sections or {}
    abstract = sections.get("abstract") or ""
    keywords = sections.get("keywords") or ""

    style = _preview_css() if mode == "preview" else _pdf_css()
    parts = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'/>",
        f"<title>{title}</title>",
        f"<style>{style}</style></head><body>",
        '<div class="page">',
        f'<h1 class="paper-title">{title}</h1>',
        f'<p class="paper-authors">{authors}</p>',
        '<div class="band">',
        _section_block("Abstract", abstract, heading_class="band-h"),
        _section_block("Keywords", keywords, heading_class="band-h", body_class="keywords"),
        "</div>",
    ]

    body_html = _column_body_html(draft)
    if mode == "preview":
        parts.append(f'<div class="twocol">{body_html}</div>')
    else:
        # xhtml2pdf: split body into two table columns by approximate length.
        left, right = _split_body_columns(draft)
        parts.append(
            '<table class="cols" width="100%" cellspacing="0" cellpadding="0">'
            "<tr>"
            f'<td class="col" valign="top" width="48%">{left}</td>'
            '<td class="gutter" width="4%">&nbsp;</td>'
            f'<td class="col" valign="top" width="48%">{right}</td>'
            "</tr></table>"
        )

    parts.append(
        '<p class="footnote">IEEE conference-style draft layout — not a camera-ready IEEE Xplore upload.</p>'
    )
    parts.append("</div></body></html>")
    return "".join(parts)


def _column_body_html(draft: PaperDraft) -> str:
    parts: list[str] = []
    sections = draft.sections or {}
    for key in _COLUMN_KEYS:
        label = SECTION_LABELS.get(key, key.title())
        parts.append(_section_block(label, sections.get(key) or ""))
    if draft.references:
        parts.append('<h2 class="sec">References</h2>')
        for ref in draft.references:
            parts.append(f'<p class="ref">{escape(ref)}</p>')
    return "".join(parts)


def _split_body_columns(draft: PaperDraft) -> tuple[str, str]:
    """Balance section blocks across two columns for PDF table layout."""
    blocks: list[tuple[int, str]] = []
    sections = draft.sections or {}
    for key in _COLUMN_KEYS:
        label = SECTION_LABELS.get(key, key.title())
        body = sections.get(key) or ""
        html = _section_block(label, body)
        blocks.append((len(body), html))
    if draft.references:
        refs = ['<h2 class="sec">References</h2>']
        total = 0
        for ref in draft.references:
            refs.append(f'<p class="ref">{escape(ref)}</p>')
            total += len(ref)
        blocks.append((total, "".join(refs)))

    if not blocks:
        return "", ""
    target = sum(w for w, _ in blocks) / 2
    left: list[str] = []
    right: list[str] = []
    running = 0
    for weight, html in blocks:
        if running <= target:
            left.append(html)
            running += weight
        else:
            right.append(html)
    if not right and len(left) > 1:
        right.append(left.pop())
    return "".join(left), "".join(right)


def _section_block(
    label: str,
    body: str,
    *,
    heading_class: str = "sec",
    body_class: str = "",
) -> str:
    parts = [f'<h2 class="{heading_class}">{escape(label)}</h2>']
    cls = f' class="{body_class}"' if body_class else ""
    for para in _split_paras(body):
        parts.append(f"<p{cls}>{escape(para)}</p>")
    return "".join(parts)


def _split_paras(text: str) -> list[str]:
    chunks = re.split(r"\n\s*\n", (text or "").strip())
    out = [c.strip() for c in chunks if c.strip()]
    return out or [""]


def _preview_css() -> str:
    return """
@page { size: letter; margin: 0.75in; }
html, body { margin: 0; padding: 0; background: #e8e8e8; }
.page {
  max-width: 8.5in;
  margin: 16px auto;
  padding: 0.75in;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  font-family: "Times New Roman", Times, serif;
  font-size: 10pt;
  line-height: 1.2;
  color: #111;
}
.paper-title {
  font-size: 24pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 10px;
  line-height: 1.15;
}
.paper-authors {
  text-align: center;
  font-size: 11pt;
  margin: 0 0 18px;
}
.band { margin-bottom: 14px; }
.band-h {
  font-size: 10pt;
  font-weight: bold;
  font-style: italic;
  margin: 10px 0 4px;
  text-align: left;
}
.band p, .keywords {
  text-align: justify;
  margin: 0 0 6px;
  font-size: 9pt;
}
.keywords { font-style: italic; }
.twocol {
  column-count: 2;
  column-gap: 0.3in;
  column-rule: none;
}
.sec {
  font-size: 10pt;
  font-weight: bold;
  margin: 10px 0 4px;
  break-after: avoid;
  column-span: none;
}
.twocol p { text-align: justify; margin: 0 0 6px; font-size: 10pt; }
.ref { font-size: 8pt; margin: 0 0 4px; text-align: left; }
.footnote {
  margin-top: 18px;
  padding-top: 8px;
  border-top: 1px solid #ccc;
  font-size: 7.5pt;
  color: #555;
  text-align: center;
  column-span: all;
}
"""


def _pdf_css() -> str:
    return """
@page { size: letter; margin: 0.7in; }
body {
  font-family: "Times New Roman", Times, serif;
  font-size: 10pt;
  line-height: 1.15;
  color: #000;
}
.paper-title {
  font-size: 16pt;
  font-weight: bold;
  text-align: center;
  margin: 0 0 8px;
}
.paper-authors {
  text-align: center;
  font-size: 11pt;
  margin: 0 0 14px;
}
.band { margin-bottom: 10px; }
.band-h {
  font-size: 10pt;
  font-weight: bold;
  font-style: italic;
  margin: 8px 0 3px;
}
.band p, .keywords {
  text-align: justify;
  margin: 0 0 5px;
  font-size: 9pt;
}
.keywords { font-style: italic; }
table.cols { width: 100%; border-collapse: collapse; }
td.col { vertical-align: top; }
td.gutter { width: 4%; }
.sec {
  font-size: 10pt;
  font-weight: bold;
  margin: 8px 0 3px;
}
.col p { text-align: justify; margin: 0 0 5px; font-size: 9pt; }
.ref { font-size: 8pt; margin: 0 0 3px; }
.footnote {
  margin-top: 12px;
  padding-top: 6px;
  border-top: 1px solid #999;
  font-size: 7pt;
  color: #444;
  text-align: center;
}
"""
