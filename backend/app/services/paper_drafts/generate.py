"""Generate IEEE-style conference paper drafts from a prompt + optional Library sources."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Sequence

from ...models.paper_drafts import (
    SECTION_ORDER,
    empty_sections,
    normalize_sections,
)
from ...models.query import EvidenceItem
from ...retrieval.hybrid import HybridRetriever, RetrievalMode
from ...services.llm.base import LLMRequest, LLMResponse, LLMTask
from ...services.llm.registry import get_llm_provider
from ...services.store.knowledge_base import KnowledgeBase, get_knowledge_base

logger = logging.getLogger(__name__)

_JSON_RE = re.compile(r"\{.*\}", re.S)

_SYSTEM = (
    "You draft IEEE conference-style manuscript sections. "
    "Return a single JSON object with keys: title, abstract, keywords, introduction, "
    "related_work, methodology, results, conclusion, references (array of strings). "
    "When evidence is provided, cite with [n] matching evidence citation ids and only use "
    "those sources in references. Never invent bibliographic entries. "
    "When no evidence is provided, write an exploratory draft outline and put "
    "'[Source needed]' wherever a citation would be required; leave references as an empty array "
    "or placeholders like '[Source needed] — add real citations before submission.' "
    "Mark speculative claims clearly. Do not fabricate results or DOIs."
)


def generate_ieee_draft(
    *,
    prompt: str,
    author_name: str = "",
    document_ids: Sequence[str] | None = None,
    title_hint: str | None = None,
    kb: KnowledgeBase | None = None,
    top_k: int = 12,
) -> dict[str, Any]:
    text = (prompt or "").strip()
    if not text:
        raise ValueError("Prompt is required.")

    knowledge = kb or get_knowledge_base()
    doc_ids = [d for d in (document_ids or []) if d]
    evidence: list[EvidenceItem] = []
    if doc_ids and not knowledge.is_empty():
        retriever = HybridRetriever(knowledge, mode=RetrievalMode.hybrid)
        evidence = retriever.retrieve(text, top_k=top_k, document_ids=doc_ids)

    provider = get_llm_provider()
    notes: list[str] = []
    grounded = bool(evidence)

    if provider.deterministic or provider.name == "extractive":
        parsed = _extractive_skeleton(
            prompt=text,
            evidence=evidence,
            title_hint=title_hint,
            author_name=author_name,
        )
        notes.append(
            "Using extractive / offline mode: sections are a structured skeleton from your "
            "prompt and any selected Library evidence, not a full LLM manuscript."
        )
        if not grounded:
            notes.append(
                "No Library sources selected — exploratory draft outline only; "
                "citations are placeholders ([Source needed]), not fabricated references."
            )
        provider_name = provider.name
    else:
        response = _call_llm(
            provider=provider,
            prompt=text,
            evidence=evidence,
            title_hint=title_hint,
            author_name=author_name,
        )
        parsed = _parse_llm_sections(response, title_hint=title_hint)
        provider_name = response.provider or provider.name
        if not grounded:
            notes.append(
                "No Library sources selected — exploratory draft; do not treat references as real "
                "unless you replace [Source needed] placeholders."
            )
        notes.append("PDF/DOCX exports are IEEE-style layouts, not camera-ready Xplore uploads.")

    sections = normalize_sections(parsed.get("sections"))
    references = [str(r).strip() for r in (parsed.get("references") or []) if str(r).strip()]
    if grounded and not references:
        references = _references_from_evidence(evidence)

    title = str(parsed.get("title") or title_hint or "").strip() or _title_from_prompt(text)
    authors = str(parsed.get("authors") or author_name or "").strip() or author_name or "Author"

    status = "ready" if grounded else "draft_outline"
    return {
        "title": title,
        "authors": authors,
        "sections": sections,
        "references": references,
        "document_ids": list(doc_ids),
        "status": status,
        "grounded": grounded,
        "provider": provider_name,
        "notes": notes,
    }


def _call_llm(*, provider, prompt: str, evidence: list[EvidenceItem], title_hint, author_name) -> LLMResponse:
    evidence_block = _format_evidence(evidence)
    user_prompt = (
        f"Author name: {author_name or 'Author'}\n"
        f"Title hint: {title_hint or '(none)'}\n"
        f"User request:\n{prompt}\n\n"
        f"Evidence (cite as [n] when present):\n{evidence_block or '(none — exploratory outline)'}\n\n"
        "Respond with JSON only."
    )
    request = LLMRequest(
        task=LLMTask.paper_draft,
        system=_SYSTEM,
        prompt=user_prompt,
        payload={
            "query": prompt,
            "evidence": [
                {
                    "citation_id": e.citation_id,
                    "document_name": e.document_name,
                    "text": e.text,
                    "apa": e.apa,
                    "title": e.title,
                    "authors": e.authors,
                    "year": e.year,
                }
                for e in evidence
            ],
            "title_hint": title_hint or "",
            "author_name": author_name or "",
        },
        temperature=0.4,
        max_tokens=3500,
    )
    return provider.generate(request)


def _parse_llm_sections(response: LLMResponse, *, title_hint: str | None) -> dict[str, Any]:
    data: dict[str, Any] | None = None
    if isinstance(response.structured, dict):
        data = response.structured
    else:
        data = _safe_json(response.text)
    if not data:
        logger.warning("Paper draft LLM returned unparseable JSON; using empty sections")
        return {
            "title": title_hint or "",
            "sections": empty_sections(),
            "references": [],
        }
    nested = data.get("sections") if isinstance(data.get("sections"), dict) else {}
    sections = {}
    for key in SECTION_ORDER:
        value = data.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            value = nested.get(key)
        sections[key] = str(value or "").strip()
    refs = data.get("references") or []
    if isinstance(refs, str):
        refs = [line.strip() for line in refs.splitlines() if line.strip()]
    return {
        "title": str(data.get("title") or title_hint or "").strip(),
        "authors": str(data.get("authors") or "").strip(),
        "sections": sections,
        "references": list(refs),
    }


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

    if evidence:
        by_doc: dict[str, list[EvidenceItem]] = {}
        for item in evidence:
            by_doc.setdefault(item.document_name or item.document_id, []).append(item)

        intro_bits = [
            f"This draft addresses: {prompt.strip()}",
            "The following Library sources were retrieved as grounding evidence.",
        ]
        for name, items in list(by_doc.items())[:4]:
            cites = ", ".join(f"[{i.citation_id}]" for i in items[:3])
            intro_bits.append(f"{name} ({cites}) contributes related material.")
        sections["introduction"] = " ".join(intro_bits)

        related = []
        for item in evidence[:6]:
            snippet = _clip(item.text, 220)
            related.append(f"[{item.citation_id}] {item.document_name}: {snippet}")
        sections["related_work"] = "\n\n".join(related)

        method_bits = [
            "Methodology (extractive outline): synthesize procedures described in the selected sources.",
            "Unsupported steps are marked [Source needed] and must be filled from primary literature.",
        ]
        if evidence:
            method_bits.append(
                f"Primary evidence spans citation ids "
                f"{', '.join(str(e.citation_id) for e in evidence[:5])}."
            )
        sections["methodology"] = " ".join(method_bits)

        result_bits = [
            "Results / Discussion (extractive outline): report only findings present in retrieved text.",
        ]
        for item in evidence[:4]:
            span = (item.supporting_spans[0] if item.supporting_spans else item.text)[:200]
            result_bits.append(f"[{item.citation_id}] {span}")
        result_bits.append(
            "Claims without direct support above should be treated as unsupported until verified."
        )
        sections["results"] = "\n\n".join(result_bits)

        sections["conclusion"] = (
            f"In summary, this draft outlines work on “{title}” grounded in "
            f"{len(evidence)} retrieved passage(s). Expand each section with hosted LLM "
            "generation or manual writing before submission."
        )
        sections["abstract"] = (
            f"We outline an IEEE-style draft on {title}. "
            f"Content is assembled from {len(evidence)} Library passage(s) related to: {prompt[:180]}. "
            "This is a structured skeleton pending fuller drafting."
        )
        references = _references_from_evidence(evidence)
    else:
        sections["abstract"] = (
            f"Draft outline for: {prompt[:240]}. "
            "No Library sources were selected; this is an exploratory skeleton without real citations."
        )
        sections["introduction"] = (
            f"Motivation. This manuscript draft explores: {prompt.strip()}\n\n"
            "Background claims require citations [Source needed]."
        )
        sections["related_work"] = (
            "Summarize prior work relevant to the topic. Replace each placeholder before submission.\n\n"
            "- Prior approach A [Source needed]\n"
            "- Prior approach B [Source needed]\n"
            "- Gap this draft aims to address [Source needed]"
        )
        sections["methodology"] = (
            "Describe the proposed method, dataset, and evaluation protocol. "
            "Do not invent experimental numbers. Mark missing citations as [Source needed]."
        )
        sections["results"] = (
            "Results / Discussion: leave empirical findings blank or clearly labeled as planned "
            "experiments. Do not fabricate metrics. [Source needed]"
        )
        sections["conclusion"] = (
            "Conclude with intended contributions and limitations. Add real references before any "
            "conference submission."
        )
        references = [
            "[Source needed] — add real citations before submission.",
        ]

    return {
        "title": title,
        "authors": author_name or "Author",
        "sections": sections,
        "references": references,
    }


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
        lines.append(f"[{item.citation_id}] ({meta}) { _clip(item.text, 500) }")
    return "\n".join(lines)


def _title_from_prompt(prompt: str) -> str:
    cleaned = re.sub(r"\s+", " ", prompt.strip())
    if len(cleaned) <= 80:
        return cleaned[0].upper() + cleaned[1:] if cleaned else "Untitled draft"
    return cleaned[:77].rstrip() + "…"


def _keywords_from_prompt(prompt: str, limit: int = 5) -> list[str]:
    stop = {
        "a",
        "an",
        "the",
        "and",
        "or",
        "for",
        "of",
        "to",
        "in",
        "on",
        "with",
        "about",
        "write",
        "paper",
        "draft",
        "ieee",
        "conference",
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
