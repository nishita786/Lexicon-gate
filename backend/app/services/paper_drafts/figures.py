"""Build original research-style SVG figures for IEEE drafts.

Figures are generated uniquely for each draft (not scraped from PDFs) so they
contribute original visual content for plagiarism originality.
"""

from __future__ import annotations

import hashlib
import re
from html import escape
from typing import Any

from ...models.paper_drafts import PaperFigure


def build_figures_from_specs(
    specs: list[dict[str, Any]] | list[PaperFigure] | None,
    *,
    topic: str = "",
) -> list[PaperFigure]:
    figures: list[PaperFigure] = []
    raw_specs = list(specs or [])
    if not raw_specs:
        raw_specs = _default_specs(topic)

    for idx, spec in enumerate(raw_specs[:3], start=1):
        if isinstance(spec, PaperFigure):
            data = spec.model_dump()
        elif isinstance(spec, dict):
            data = spec
        else:
            continue
        nodes = [str(n).strip() for n in (data.get("nodes") or []) if str(n).strip()]
        edges = _normalize_edges(data.get("edges") or [], nodes)
        if len(nodes) < 2:
            nodes = _fallback_nodes(topic, idx)
            edges = [[nodes[i], nodes[i + 1]] for i in range(len(nodes) - 1)]
        kind = str(data.get("kind") or "pipeline").strip().lower()
        if kind not in ("pipeline", "architecture", "comparison"):
            kind = "pipeline"
        caption = str(data.get("caption") or "").strip() or _default_caption(kind, topic, idx)
        anchor = str(data.get("section_anchor") or "methodology").strip() or "methodology"
        svg = render_figure_svg(
            figure_id=f"fig{idx}",
            kind=kind,
            nodes=nodes,
            edges=edges,
            caption=caption,
            seed=f"{topic}|{caption}|{idx}",
        )
        figures.append(
            PaperFigure(
                figure_id=f"fig{idx}",
                caption=caption,
                kind=kind,
                section_anchor=anchor,
                svg=svg,
                nodes=nodes,
                edges=edges,
            )
        )
    return figures


def render_figure_svg(
    *,
    figure_id: str,
    kind: str,
    nodes: list[str],
    edges: list[list[str]],
    caption: str,
    seed: str = "",
) -> str:
    digest = hashlib.sha256((seed or figure_id).encode("utf-8")).hexdigest()
    accent = f"#{digest[0:6]}"
    accent2 = f"#{digest[6:12]}"
    width = 520
    height = 220 if kind != "architecture" else 260

    if kind == "comparison":
        body = _comparison_layout(nodes, accent, accent2, width, height)
    elif kind == "architecture":
        body = _architecture_layout(nodes, edges, accent, accent2, width, height)
    else:
        body = _pipeline_layout(nodes, accent, accent2, width, height)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="100%" role="img" aria-label="{escape(caption)}">'
        f"<rect width='{width}' height='{height}' fill='#fafafa' stroke='#333' stroke-width='1'/>"
        f"{body}"
        f"</svg>"
    )


def _pipeline_layout(
    nodes: list[str], accent: str, accent2: str, width: int, height: int
) -> str:
    n = min(len(nodes), 5)
    nodes = nodes[:n]
    margin = 24
    box_w = min(88, (width - 2 * margin - (n - 1) * 28) // max(n, 1))
    box_h = 44
    y = height // 2 - box_h // 2
    gap = (width - 2 * margin - n * box_w) / max(n - 1, 1) if n > 1 else 0
    parts: list[str] = []
    centers: list[tuple[float, float]] = []
    for i, label in enumerate(nodes):
        x = margin + i * (box_w + gap)
        centers.append((x + box_w / 2, y + box_h / 2))
        fill = accent if i % 2 == 0 else accent2
        parts.append(
            f"<rect x='{x:.1f}' y='{y}' width='{box_w}' height='{box_h}' rx='6' "
            f"fill='{fill}' fill-opacity='0.18' stroke='{fill}' stroke-width='1.5'/>"
        )
        parts.append(
            f"<text x='{x + box_w / 2:.1f}' y='{y + box_h / 2 + 4:.1f}' "
            f"text-anchor='middle' font-family='Times New Roman,serif' font-size='11' fill='#111'>"
            f"{escape(_clip_label(label, 14))}</text>"
        )
    for i in range(len(centers) - 1):
        x1, y1 = centers[i]
        x2, y2 = centers[i + 1]
        parts.append(
            f"<line x1='{x1 + box_w / 2 - 4:.1f}' y1='{y1:.1f}' x2='{x2 - box_w / 2 + 4:.1f}' "
            f"y2='{y2:.1f}' stroke='#333' stroke-width='1.5' marker-end='url(#arrow)'/>"
        )
    marker = (
        "<defs><marker id='arrow' markerWidth='8' markerHeight='8' refX='6' refY='3' "
        "orient='auto'><path d='M0,0 L6,3 L0,6 Z' fill='#333'/></marker></defs>"
    )
    return marker + "".join(parts)


def _architecture_layout(
    nodes: list[str],
    edges: list[list[str]],
    accent: str,
    accent2: str,
    width: int,
    height: int,
) -> str:
    n = min(len(nodes), 6)
    nodes = nodes[:n]
    cols = 3 if n > 3 else max(n, 1)
    rows = (n + cols - 1) // cols
    box_w, box_h = 120, 40
    x_gap = (width - cols * box_w) / (cols + 1)
    y_gap = (height - rows * box_h) / (rows + 1)
    pos: dict[str, tuple[float, float]] = {}
    parts: list[str] = []
    for i, label in enumerate(nodes):
        r, c = divmod(i, cols)
        x = x_gap + c * (box_w + x_gap)
        y = y_gap + r * (box_h + y_gap)
        pos[label] = (x + box_w / 2, y + box_h / 2)
        fill = accent if i % 2 == 0 else accent2
        parts.append(
            f"<rect x='{x:.1f}' y='{y:.1f}' width='{box_w}' height='{box_h}' rx='5' "
            f"fill='{fill}' fill-opacity='0.15' stroke='#222' stroke-width='1.2'/>"
        )
        parts.append(
            f"<text x='{x + box_w / 2:.1f}' y='{y + box_h / 2 + 4:.1f}' text-anchor='middle' "
            f"font-family='Times New Roman,serif' font-size='11' fill='#111'>"
            f"{escape(_clip_label(label, 16))}</text>"
        )
    for edge in edges:
        if len(edge) < 2:
            continue
        a, b = edge[0], edge[1]
        if a not in pos or b not in pos:
            continue
        x1, y1 = pos[a]
        x2, y2 = pos[b]
        parts.append(
            f"<line x1='{x1:.1f}' y1='{y1:.1f}' x2='{x2:.1f}' y2='{y2:.1f}' "
            f"stroke='#555' stroke-width='1' stroke-dasharray='3,2'/>"
        )
    return "".join(parts)


def _comparison_layout(
    nodes: list[str], accent: str, accent2: str, width: int, height: int
) -> str:
    left = nodes[0] if nodes else "Baseline"
    right = nodes[1] if len(nodes) > 1 else "Proposed"
    mid = nodes[2] if len(nodes) > 2 else "Evaluation"
    parts = [
        f"<rect x='40' y='50' width='160' height='90' rx='8' fill='{accent}' fill-opacity='0.15' stroke='#333'/>",
        f"<text x='120' y='100' text-anchor='middle' font-family='Times New Roman,serif' font-size='12'>"
        f"{escape(_clip_label(left, 18))}</text>",
        f"<rect x='320' y='50' width='160' height='90' rx='8' fill='{accent2}' fill-opacity='0.15' stroke='#333'/>",
        f"<text x='400' y='100' text-anchor='middle' font-family='Times New Roman,serif' font-size='12'>"
        f"{escape(_clip_label(right, 18))}</text>",
        f"<rect x='180' y='160' width='160' height='40' rx='6' fill='#eee' stroke='#333'/>",
        f"<text x='260' y='185' text-anchor='middle' font-family='Times New Roman,serif' font-size='11'>"
        f"{escape(_clip_label(mid, 20))}</text>",
        "<line x1='200' y1='140' x2='240' y2='160' stroke='#333'/>",
        "<line x1='320' y1='140' x2='280' y2='160' stroke='#333'/>",
    ]
    return "".join(parts)


def _default_specs(topic: str) -> list[dict[str, Any]]:
    t = (topic or "system").strip() or "system"
    short = _clip_label(t, 24)
    return [
        {
            "kind": "pipeline",
            "caption": f"Overview of the proposed {short} pipeline.",
            "section_anchor": "methodology",
            "nodes": ["Input", "Retrieve", "Generate", "Verify", "Output"],
            "edges": [],
        },
        {
            "kind": "architecture",
            "caption": f"System architecture for {short}.",
            "section_anchor": "methodology",
            "nodes": ["Corpus", "Retriever", "LLM", "Verifier", "Answer"],
            "edges": [
                ["Corpus", "Retriever"],
                ["Retriever", "LLM"],
                ["LLM", "Verifier"],
                ["Verifier", "Answer"],
            ],
        },
        {
            "kind": "comparison",
            "caption": f"Comparison of baseline versus proposed {short} approach.",
            "section_anchor": "results",
            "nodes": ["Baseline RAG", "Proposed method", "Metrics"],
            "edges": [],
        },
    ]


def _fallback_nodes(topic: str, idx: int) -> list[str]:
    base = [
        ["Query", "Retrieve", "Draft", "Critique", "Answer"],
        ["Data", "Encoder", "Fusion", "Decoder"],
        ["Baseline", "Proposed", "Evaluation"],
    ]
    return base[(idx - 1) % len(base)]


def _default_caption(kind: str, topic: str, idx: int) -> str:
    short = _clip_label(topic or "the proposed method", 40)
    if kind == "comparison":
        return f"Fig. {idx}. Comparison framework for {short}."
    if kind == "architecture":
        return f"Fig. {idx}. Architecture of {short}."
    return f"Fig. {idx}. Pipeline overview for {short}."


def _normalize_edges(edges: list[Any], nodes: list[str]) -> list[list[str]]:
    out: list[list[str]] = []
    node_set = set(nodes)
    for edge in edges:
        if isinstance(edge, (list, tuple)) and len(edge) >= 2:
            a, b = str(edge[0]).strip(), str(edge[1]).strip()
            if a in node_set and b in node_set:
                out.append([a, b])
    return out


def _clip_label(text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= n:
        return t
    return t[: n - 1].rstrip() + "…"
