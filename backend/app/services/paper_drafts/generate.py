"""Generate conference-oriented IEEE paper drafts from a topic + optional Library sources."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Sequence

from ...models.paper_drafts import (
    BODY_SECTIONS,
    SECTION_ORDER,
    empty_sections,
    normalize_figures,
    normalize_sections,
)
from ...models.query import EvidenceItem
from ...retrieval.hybrid import HybridRetriever, RetrievalMode
from ...services.llm.base import LLMRequest, LLMResponse, LLMTask
from ...services.llm.registry import get_llm_provider
from ...services.store.knowledge_base import KnowledgeBase, get_knowledge_base
from .figures import build_figures_from_specs

logger = logging.getLogger(__name__)

_JSON_RE = re.compile(r"\{.*\}", re.S)

ProgressCb = Callable[[str], None]

_OUTLINE_SYSTEM = (
    "You are an IEEE conference paper planner for a full-length (~10+ two-column page) draft. "
    "Return JSON only with keys: title, keywords (comma-separated string), outlines (object with "
    "keys introduction, related_work, methodology, results — each an array of 6-10 detailed bullet "
    "strings covering background, setup, method detail, and discussion), "
    "figures (array of 2-3 objects: caption, kind in [pipeline,architecture,comparison], "
    "section_anchor, nodes array of 3-6 short labels, edges array of [from,to] pairs). "
    "Plan citations using only evidence ids [n]. Never invent DOIs or paper titles. "
    "Do not plan a one-page summary; plan manuscript-length sections."
)

_SECTION_SYSTEM = (
    "You write IEEE conference manuscript body text. Return JSON only: "
    '{"text": "...", "keywords_extra": ""}. '
    "Target 900–1400 words and 8–14 paragraphs for a full body section (or the requested half). "
    "Use optional I-A / I-B style subsection headings inside the text where helpful. "
    "Write substantial academic English — forbid one-page or outline-only summaries. "
    "Use citations like [1] only for provided evidence ids. "
    "Do not fabricate experimental numbers, datasets, or bibliographic entries. "
    "If evidence is thin, state limitations and use [Source needed] sparingly. "
    "When describing results without measured data, label them as proposed evaluation / expected analysis."
)

_ABSTRACT_SYSTEM = (
    "You write IEEE abstracts and conclusions. Return JSON only with keys abstract and conclusion. "
    "Abstract: 180–250 words, self-contained, problem/method/contribution. "
    "Conclusion: 4–6 paragraphs summarizing contributions, limitations, and future work. "
    "Do not invent citations or metrics."
)

# Approximate targets for hosted-LLM drafts (~10+ IEEE two-column pages).
_SECTION_WORD_TARGET = "900–1400"
_SECTION_MAX_TOKENS = 5000
_OUTLINE_MAX_TOKENS = 3000
_ABSTRACT_MAX_TOKENS = 2000


def generate_ieee_draft(
    *,
    prompt: str,
    author_name: str = "",
    document_ids: Sequence[str] | None = None,
    title_hint: str | None = None,
    kb: KnowledgeBase | None = None,
    top_k_per_doc: int = 6,
    on_progress: ProgressCb | None = None,
) -> dict[str, Any]:
    text = (prompt or "").strip()
    if not text:
        raise ValueError("Prompt is required.")

    def progress(msg: str) -> None:
        if on_progress:
            on_progress(msg)

    steps: list[str] = []

    def track(msg: str) -> None:
        steps.append(msg)
        progress(msg)

    knowledge = kb or get_knowledge_base()
    doc_ids = [d for d in (document_ids or []) if d]
    track("Retrieving Library evidence…")
    evidence = _retrieve_balanced(
        knowledge, query=text, document_ids=doc_ids, top_k_per_doc=top_k_per_doc
    )
    grounded = bool(evidence)
    provider = get_llm_provider()
    notes: list[str] = []

    if provider.deterministic or provider.name == "extractive":
        track("Building extractive skeleton…")
        parsed = _extractive_skeleton(
            prompt=text,
            evidence=evidence,
            title_hint=title_hint,
            author_name=author_name,
        )
        notes.append(
            "Using extractive / offline mode: short skeleton only (~1 page). "
            "Configure OpenAI (SELFRAG_OPENAI_API_KEY) or Ollama (SELFRAG_OLLAMA_MODEL) "
            "and restart the backend for ~10+ page conference-style multi-pass drafting."
        )
        if not grounded:
            notes.append(
                "Select 2–3 Library papers for grounded citations; otherwise placeholders "
                "([Source needed]) are used."
            )
        provider_name = provider.name
        figures = build_figures_from_specs(parsed.get("figure_specs"), topic=text)
        sections = normalize_sections(parsed.get("sections"))
        references = [str(r).strip() for r in (parsed.get("references") or []) if str(r).strip()]
        title = str(parsed.get("title") or title_hint or "").strip() or _title_from_prompt(text)
        authors = str(parsed.get("authors") or author_name or "").strip() or author_name or "Author"
        notes.append(_length_note(sections, target_pages=False))
    else:
        track("Outlining manuscript and figures…")
        outline = _pass_outline(
            provider=provider,
            prompt=text,
            evidence=evidence,
            title_hint=title_hint,
            author_name=author_name,
        )
        title = str(outline.get("title") or title_hint or "").strip() or _title_from_prompt(text)
        authors = author_name or "Author"
        keywords = str(outline.get("keywords") or "").strip() or ", ".join(_keywords_from_prompt(text))
        outlines = outline.get("outlines") if isinstance(outline.get("outlines"), dict) else {}
        figure_specs = outline.get("figures") if isinstance(outline.get("figures"), list) else []

        sections = empty_sections()
        sections["keywords"] = keywords
        for key in BODY_SECTIONS:
            track(f"Writing {key.replace('_', ' ').title()}…")
            body = _pass_section(
                provider=provider,
                section_key=key,
                title=title,
                prompt=text,
                bullets=outlines.get(key) or [],
                evidence=evidence,
                grounded=grounded,
            )
            sections[key] = body
            # Pull optional keyword hints from last section responses already applied.

        track("Writing Abstract and Conclusion…")
        abs_conc = _pass_abstract_conclusion(
            provider=provider,
            title=title,
            prompt=text,
            sections=sections,
            evidence=evidence,
        )
        sections["abstract"] = str(abs_conc.get("abstract") or sections.get("abstract") or "").strip()
        sections["conclusion"] = str(abs_conc.get("conclusion") or sections.get("conclusion") or "").strip()
        if not sections["abstract"]:
            sections["abstract"] = _fallback_abstract(title, text, grounded)
        if not sections["conclusion"]:
            sections["conclusion"] = _fallback_conclusion(title)

        track("Drawing original figures…")
        figures = build_figures_from_specs(figure_specs, topic=text)
        # Insert figure callouts into anchored sections.
        sections = _inject_figure_callouts(sections, figures)

        references = _references_from_evidence(evidence) if grounded else [
            "[Source needed] — add real citations before submission.",
        ]
        provider_name = provider.name
        if not grounded:
            notes.append(
                "No Library sources selected — exploratory draft; replace [Source needed] "
                "and verify claims before any conference submission."
            )
        notes.append(
            "AI conference-style draft with original figures. Human review is required; "
            "acceptance is not guaranteed. Do not treat proposed results as measured findings."
        )
        notes.append("PDF/DOCX are IEEE-style drafting layouts, not camera-ready Xplore uploads.")
        notes.append(_length_note(sections, target_pages=True))

    if grounded and not references:
        references = _references_from_evidence(evidence)

    status = "ready" if grounded else "draft_outline"
    track("Draft ready.")
    return {
        "title": title,
        "authors": authors,
        "sections": normalize_sections(sections),
        "references": references,
        "figures": [f.model_dump() for f in normalize_figures(figures)],
        "document_ids": list(doc_ids),
        "status": status,
        "grounded": grounded,
        "provider": provider_name,
        "notes": notes,
        "generation_steps": steps,
    }


def _retrieve_balanced(
    knowledge: KnowledgeBase,
    *,
    query: str,
    document_ids: Sequence[str],
    top_k_per_doc: int,
) -> list[EvidenceItem]:
    if not document_ids or knowledge.is_empty():
        return []
    retriever = HybridRetriever(knowledge, mode=RetrievalMode.hybrid)
    merged: list[EvidenceItem] = []
    seen_chunks: set[str] = set()
    for doc_id in document_ids:
        hits = retriever.retrieve(query, top_k=top_k_per_doc, document_ids=[doc_id])
        for hit in hits:
            if hit.chunk_id in seen_chunks:
                continue
            seen_chunks.add(hit.chunk_id)
            merged.append(hit)
    # Global top-up if few docs
    if len(merged) < 8:
        extra = retriever.retrieve(
            query, top_k=12, document_ids=list(document_ids)
        )
        for hit in extra:
            if hit.chunk_id in seen_chunks:
                continue
            seen_chunks.add(hit.chunk_id)
            merged.append(hit)
    for idx, item in enumerate(merged, start=1):
        item.citation_id = idx
    return merged


def _pass_outline(*, provider, prompt, evidence, title_hint, author_name) -> dict[str, Any]:
    evidence_block = _format_evidence(evidence)
    user = (
        f"Author: {author_name or 'Author'}\n"
        f"Title hint: {title_hint or '(none)'}\n"
        f"Topic / request:\n{prompt}\n\n"
        f"Evidence (cite as [n]):\n{evidence_block or '(none)'}\n\n"
        "Produce a conference-paper outline JSON."
    )
    response = provider.generate(
        LLMRequest(
            task=LLMTask.paper_draft,
            system=_OUTLINE_SYSTEM,
            prompt=user,
            payload={
                "query": prompt,
                "evidence": _evidence_payload(evidence),
                "title_hint": title_hint or "",
                "author_name": author_name or "",
                "mode": "outline",
            },
            temperature=0.35,
            max_tokens=_OUTLINE_MAX_TOKENS,
        )
    )
    data = _response_json(response) or {}
    return data


def _pass_section(
    *,
    provider,
    section_key: str,
    title: str,
    prompt: str,
    bullets: list[Any],
    evidence: list[EvidenceItem],
    grounded: bool,
) -> str:
    """Write a body section in two chunks (first half + continuation) then concatenate."""
    bullet_lines = "\n".join(f"- {b}" for b in bullets if str(b).strip()) or (
        "- Develop the section thoroughly with background, method detail, and discussion."
    )
    evidence_block = _format_evidence(evidence) or "(none — use [Source needed] where needed)"
    shared = (
        f"Paper title: {title}\n"
        f"User topic: {prompt}\n"
        f"Section: {section_key}\n"
        f"Outline bullets:\n{bullet_lines}\n\n"
        f"Evidence:\n{evidence_block}\n\n"
        f"Grounded mode: {grounded}\n"
        f"Overall section target: {_SECTION_WORD_TARGET} words, 8–14 paragraphs "
        "(optional I-A / I-B style subheads). Not a one-page summary.\n"
    )
    first = _generate_section_chunk(
        provider=provider,
        prompt=prompt,
        evidence=evidence,
        section_key=section_key,
        user=(
            shared
            + "Write PART 1 of this section only: background, motivation, and setup "
            "(roughly the first half). Return JSON with key text."
        ),
        chunk_mode="section_part1",
    )
    second = _generate_section_chunk(
        provider=provider,
        prompt=prompt,
        evidence=evidence,
        section_key=section_key,
        user=(
            shared
            + "Write PART 2 of this section only: method detail, analysis, and discussion "
            "(roughly the second half). Continue seamlessly from the prior text below; "
            "do not repeat headings already covered.\n\n"
            f"Prior text (PART 1):\n{first[:6000]}\n\n"
            "Return JSON with key text containing only the continuation."
        ),
        chunk_mode="section_part2",
    )
    text = _concatenate_section_chunks(first, second)
    return text or _fallback_section(section_key, prompt, evidence, grounded)


def _generate_section_chunk(
    *,
    provider,
    prompt: str,
    evidence: list[EvidenceItem],
    section_key: str,
    user: str,
    chunk_mode: str,
) -> str:
    response = provider.generate(
        LLMRequest(
            task=LLMTask.paper_draft,
            system=_SECTION_SYSTEM,
            prompt=user,
            payload={
                "query": prompt,
                "evidence": _evidence_payload(evidence),
                "section": section_key,
                "mode": chunk_mode,
            },
            temperature=0.45,
            max_tokens=_SECTION_MAX_TOKENS,
        )
    )
    data = _response_json(response) or {}
    text = str(data.get("text") or response.text or "").strip()
    if text.startswith("{"):
        parsed = _safe_json(text)
        if parsed:
            text = str(parsed.get("text") or "").strip()
    return text


def _concatenate_section_chunks(first: str, second: str) -> str:
    """Join two section halves with a blank line; ignore empty parts."""
    a = (first or "").strip()
    b = (second or "").strip()
    if a and b:
        return f"{a}\n\n{b}"
    return a or b


def _word_count_sections(sections: dict[str, str]) -> int:
    text = " ".join(str(sections.get(k) or "") for k in SECTION_ORDER)
    return len(re.findall(r"\b\w+\b", text))


def _length_note(sections: dict[str, str], *, target_pages: bool) -> str:
    words = _word_count_sections(sections)
    if target_pages:
        return (
            f"Draft length ≈ {words} words (target ~5000+ ≈ 10+ IEEE two-column pages); "
            "expand further in an editor if needed."
        )
    return (
        f"Skeleton length ≈ {words} words — extractive mode cannot reach 10-page targets; "
        "enable OpenAI or Ollama for full drafting."
    )


def _pass_abstract_conclusion(*, provider, title, prompt, sections, evidence) -> dict[str, Any]:
    body_preview = "\n\n".join(
        f"## {k}\n{(sections.get(k) or '')[:1800]}" for k in BODY_SECTIONS
    )
    user = (
        f"Title: {title}\nTopic: {prompt}\n\n"
        f"Body excerpts:\n{body_preview}\n\n"
        f"Evidence ids available: {', '.join(str(e.citation_id) for e in evidence) or 'none'}\n"
        "Write abstract (180–250 words) and conclusion (4–6 paragraphs) JSON."
    )
    response = provider.generate(
        LLMRequest(
            task=LLMTask.paper_draft,
            system=_ABSTRACT_SYSTEM,
            prompt=user,
            payload={"query": prompt, "evidence": _evidence_payload(evidence), "mode": "abstract"},
            temperature=0.35,
            max_tokens=_ABSTRACT_MAX_TOKENS,
        )
    )
    return _response_json(response) or {}


def _inject_figure_callouts(sections: dict[str, str], figures) -> dict[str, str]:
    out = dict(sections)
    for fig in figures:
        anchor = fig.section_anchor if fig.section_anchor in out else "methodology"
        callout = f"\n\n[{fig.figure_id.upper()}: {fig.caption}]\n"
        body = out.get(anchor) or ""
        if fig.figure_id.upper() in body.upper():
            continue
        out[anchor] = (body + callout).strip()
    return out


def _response_json(response: LLMResponse) -> dict[str, Any] | None:
    if isinstance(response.structured, dict):
        return response.structured
    return _safe_json(response.text)


def _safe_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        match = _JSON_RE.search(raw)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def _evidence_payload(evidence: list[EvidenceItem]) -> list[dict[str, Any]]:
    return [
        {
            "citation_id": e.citation_id,
            "document_name": e.document_name,
            "text": e.text,
            "apa": e.apa,
            "title": e.title,
            "authors": e.authors,
            "year": e.year,
            "document_id": e.document_id,
            "chunk_id": e.chunk_id,
        }
        for e in evidence
    ]


def _extractive_skeleton(
    *,
    prompt: str,
    evidence: list[EvidenceItem],
    title_hint: str | None,
    author_name: str,
) -> dict[str, Any]:
    title = (title_hint or "").strip() or _title_from_prompt(prompt)
    sections = empty_sections()
    keywords = _keywords_from_prompt(prompt)
    sections["keywords"] = ", ".join(keywords)
    topic = prompt.strip()

    if evidence:
        by_doc: dict[str, list[EvidenceItem]] = {}
        for item in evidence:
            by_doc.setdefault(item.document_name or item.document_id, []).append(item)

        intro_paras = [
            f"I-A Motivation. This manuscript studies {topic}.",
            "We ground the discussion in selected Library sources and outline a conference-style "
            "argument suitable for later expansion with a hosted language model.",
            "I-B Scope. The draft states the research question, situates prior evidence, and "
            "sketches a methodology and evaluation plan without fabricating measured results.",
        ]
        for name, items in list(by_doc.items())[:4]:
            cites = ", ".join(f"[{i.citation_id}]" for i in items[:3])
            intro_paras.append(
                f"Prior work in {name} ({cites}) informs the framing of the problem and "
                "highlights gaps that the proposed approach aims to address."
            )
        intro_paras.append(
            "Full ~10-page elaboration requires OpenAI or Ollama; this extractive skeleton "
            "is intentionally short."
        )
        sections["introduction"] = "\n\n".join(intro_paras)

        related = [
            "II-A Related literature. The following passages summarize retrieved Library evidence:",
        ]
        for item in evidence[:8]:
            related.append(f"[{item.citation_id}] {item.document_name}: {_clip(item.text, 280)}")
        related.append(
            "II-B Gap. Remaining open questions include stronger empirical validation and "
            "clearer baselines [Source needed]."
        )
        sections["related_work"] = "\n\n".join(related)

        sections["methodology"] = "\n\n".join(
            [
                "III-A Overview. We propose a methodology that integrates retrieval, generation, "
                "and verification consistent with the evidence above.",
                "III-B Procedure. Detailed algorithms, datasets, and hyperparameters should be "
                "filled from primary sources [Source needed].",
                f"Primary citation ids in this draft: "
                f"{', '.join(str(e.citation_id) for e in evidence[:6])}.",
                "III-C Limitations of this skeleton. Extractive mode cannot expand each "
                "subsection to manuscript length; enable a hosted LLM for full drafting.",
            ]
        )
        result_bits = [
            "IV-A Proposed evaluation. Report only findings supported by retrieved passages; "
            "otherwise label analyses as proposed evaluation plans.",
        ]
        for item in evidence[:5]:
            span = (item.supporting_spans[0] if item.supporting_spans else item.text)[:220]
            result_bits.append(f"[{item.citation_id}] {span}")
        result_bits.append(
            "IV-B Discussion. Authors should replace placeholders and verify every claim "
            "before conference submission."
        )
        sections["results"] = "\n\n".join(result_bits)
        sections["conclusion"] = _fallback_conclusion(title)
        sections["abstract"] = (
            f"We present a conference-style draft on {title}, synthesizing {len(evidence)} "
            f"retrieved passages related to: {topic[:160]}. This extractive skeleton outlines "
            "motivation, related work, methodology, and a proposed evaluation agenda. "
            "Hosted LLM drafting is required for manuscript-length (~10+ page) expansion."
        )
        references = _references_from_evidence(evidence)
    else:
        sections["abstract"] = _fallback_abstract(title, prompt, False)
        sections["introduction"] = "\n\n".join(
            [
                f"I-A Motivation. This draft explores: {topic}",
                "I-B Background. Background claims require citations [Source needed].",
                "I-C Contribution sketch. We outline motivation, related work, methodology, "
                "and a proposed evaluation agenda for later expansion.",
                "Note: extractive mode cannot produce 10-page papers; configure OpenAI or Ollama.",
            ]
        )
        sections["related_work"] = "\n\n".join(
            [
                "II-A Prior approaches. Summarize prior work and replace placeholders before submission.",
                "- Prior approach A [Source needed]",
                "- Prior approach B [Source needed]",
                "- Research gap [Source needed]",
                "II-B Positioning. Clarify how the proposed work differs once Library sources are attached.",
            ]
        )
        sections["methodology"] = "\n\n".join(
            [
                "III-A Overview. Describe method, data, and evaluation protocol without inventing numbers.",
                "III-B Missing citations. Mark gaps as [Source needed].",
                "III-C Next steps. Expand with a hosted LLM after selecting 2–3 Library papers.",
            ]
        )
        sections["results"] = "\n\n".join(
            [
                "IV-A Proposed evaluation. Discussion only — do not fabricate metrics. [Source needed]",
                "IV-B Expected analysis. State qualitative success criteria and baselines once evidence is available.",
            ]
        )
        sections["conclusion"] = _fallback_conclusion(title)
        references = ["[Source needed] — add real citations before submission."]

    return {
        "title": title,
        "authors": author_name or "Author",
        "sections": sections,
        "references": references,
        "figure_specs": None,
    }


def _fallback_section(key: str, prompt: str, evidence: list[EvidenceItem], grounded: bool) -> str:
    if evidence:
        bits = [f"This section develops {key.replace('_', ' ')} for: {prompt.strip()}."]
        for item in evidence[:4]:
            bits.append(f"[{item.citation_id}] {_clip(item.text, 200)}")
        bits.append(
            "Expand further with a hosted LLM for manuscript-length paragraphs and subsections."
        )
        return "\n\n".join(bits)
    return (
        f"{key.replace('_', ' ').title()} for {prompt.strip()}. "
        "Expand with Library-grounded citations [Source needed]."
    )


def _fallback_abstract(title: str, prompt: str, grounded: bool) -> str:
    g = "grounded in selected Library sources" if grounded else "as an exploratory outline"
    return (
        f"This paper drafts a conference-style treatment of {title}, {g}. "
        f"The topic addressed is: {prompt[:200]}. We outline motivation, related work, "
        "methodology, and a proposed evaluation agenda. Claims requiring evidence are marked "
        "for citation before submission. Manuscript-length expansion needs a hosted LLM "
        "(OpenAI or Ollama)."
    )


def _fallback_conclusion(title: str) -> str:
    return "\n\n".join(
        [
            f"We outlined contributions toward {title} and positioned the draft relative to "
            "retrieved or placeholder evidence.",
            "Limitations of the current draft include incomplete empirical validation, "
            "possible gaps in related work coverage, and reliance on proposed rather than "
            "measured results where data were unavailable.",
            "Future work includes stronger baselines, broader datasets, and careful human "
            "review of every citation and figure before conference submission.",
            "Authors should verify claims against primary sources and expand sections to "
            "full manuscript length when a hosted language model is configured.",
        ]
    )


def _references_from_evidence(evidence: list[EvidenceItem]) -> list[str]:
    seen: set[str] = set()
    refs: list[str] = []
    for item in evidence:
        key = item.document_id or item.document_name
        if key in seen:
            continue
        seen.add(key)
        if item.apa:
            refs.append(f"[{item.citation_id}] {item.apa}")
        else:
            authors = ", ".join(item.authors[:4]) if item.authors else "Unknown"
            year = f" ({item.year})" if item.year else ""
            title = item.title or item.document_name or "Untitled"
            refs.append(f"[{item.citation_id}] {authors}{year}. {title}.")
    return refs


def _format_evidence(evidence: list[EvidenceItem]) -> str:
    if not evidence:
        return ""
    lines = []
    for item in evidence:
        meta = item.document_name
        if item.page is not None:
            meta += f", p.{item.page}"
        lines.append(f"[{item.citation_id}] ({meta}) {_clip(item.text, 500)}")
    return "\n".join(lines)


def _title_from_prompt(prompt: str) -> str:
    cleaned = re.sub(r"\s+", " ", prompt.strip())
    if len(cleaned) <= 80:
        return cleaned[0].upper() + cleaned[1:] if cleaned else "Untitled draft"
    return cleaned[:77].rstrip() + "…"


def _keywords_from_prompt(prompt: str, limit: int = 5) -> list[str]:
    stop = {
        "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "with", "about",
        "write", "paper", "draft", "ieee", "conference",
    }
    words = re.findall(r"[A-Za-z][A-Za-z\-]{2,}", prompt.lower())
    out: list[str] = []
    for w in words:
        if w in stop or w in out:
            continue
        out.append(w)
        if len(out) >= limit:
            break
    return out or ["research", "draft"]


def _clip(text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= n:
        return t
    return t[: n - 1].rstrip() + "…"
