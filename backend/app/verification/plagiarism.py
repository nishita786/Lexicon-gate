"""Local originality check: long verbatim copies from the library and academic indexes.

This is not Turnitin. It finds word n-grams that also appear in retrieved
evidence, indexed Library papers, or title/abstract hits from academic search.
"""

from __future__ import annotations

import logging
from typing import Sequence

from ..config import Settings, get_settings
from ..models.documents import Chunk, ChunkMetadata
from ..models.papers import PaperHit
from ..models.query import (
    EvidenceItem,
    FlaggedSentence,
    PlagiarismMatch,
    PlagiarismReport,
    SectionOriginality,
)
from ..services.citations import title_from_filename
from ..services.ingestion.chunker import split_into_sections
from ..services.ingestion.loaders import LoadedPage
from ..services.llm.extractive_engine import strip_citations
from ..services.papers.search import search_papers
from ..text_utils import split_sentences, tokenize

logger = logging.getLogger(__name__)


def check_plagiarism(
    answer: str,
    evidence: Sequence[EvidenceItem],
    library_chunks: Sequence[Chunk] | None = None,
    settings: Settings | None = None,
) -> PlagiarismReport:
    settings = settings or get_settings()
    min_n = max(3, int(settings.plagiarism_min_ngram))
    clean = strip_citations(answer)
    answer_tokens = tokenize(clean)
    if len(answer_tokens) < min_n:
        return PlagiarismReport(originality=1.0, overlap_ratio=0.0, risk="low")

    cited_ids = {item.document_id for item in evidence if item.document_id}
    sources = _sources(evidence, library_chunks or [], cited_ids, min_n)
    if not sources:
        return PlagiarismReport(originality=1.0, overlap_ratio=0.0, risk="low")

    covered = [False] * len(answer_tokens)
    cited_cover = [False] * len(answer_tokens)
    uncited_cover = [False] * len(answer_tokens)
    matches: list[PlagiarismMatch] = []

    i = 0
    while i <= len(answer_tokens) - min_n:
        hit = _longest_hit(answer_tokens, i, min_n, sources)
        if hit is None:
            i += 1
            continue
        start, end, source = hit
        for pos in range(start, end):
            covered[pos] = True
            if source["cited"]:
                cited_cover[pos] = True
            else:
                uncited_cover[pos] = True
        snippet = " ".join(answer_tokens[start:end])
        matches.append(
            PlagiarismMatch(
                text=snippet,
                document_id=source["document_id"],
                document_name=source["document_name"],
                page=source["page"],
                cited=source["cited"],
                n_words=end - start,
            )
        )
        i = end

    n = len(answer_tokens)
    overlap_ratio = sum(covered) / n
    originality = max(0.0, 1.0 - overlap_ratio)
    uncited_ratio = sum(uncited_cover) / n
    quoted_ratio = sum(cited_cover) / n

    if uncited_ratio >= settings.plagiarism_uncited_ratio:
        risk = "high"
    elif quoted_ratio >= settings.plagiarism_quoted_ratio:
        risk = "medium"
    else:
        risk = "low"

    flags: list[str] = []
    if uncited_ratio > 0:
        flags.append(
            f"Uncited wording overlaps {uncited_ratio:.0%} of the answer with the library."
        )
    if quoted_ratio >= settings.plagiarism_quoted_ratio:
        flags.append(
            f"Cited sources supply {quoted_ratio:.0%} of the answer as a long quote."
        )

    flagged = _flag_sentences(clean, matches)
    return PlagiarismReport(
        originality=round(originality, 4),
        overlap_ratio=round(overlap_ratio, 4),
        risk=risk,
        matches=matches,
        flagged_sentences=flagged,
        flags=flags,
    )


def _sources(
    evidence: Sequence[EvidenceItem],
    chunks: Sequence[Chunk],
    cited_ids: set[str],
    min_n: int,
) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for item in evidence:
        key = (item.document_id, item.text)
        if key in seen:
            continue
        seen.add(key)
        tokens = tokenize(item.text)
        if len(tokens) < min_n:
            continue
        out.append(
            {
                "document_id": item.document_id,
                "document_name": item.title or item.document_name,
                "page": item.page,
                "cited": True,
                "grams": _gram_set(tokens, min_n),
            }
        )
    for chunk in chunks:
        key = (chunk.metadata.document_id, chunk.text)
        if key in seen:
            continue
        seen.add(key)
        tokens = tokenize(chunk.text)
        if len(tokens) < min_n:
            continue
        out.append(
            {
                "document_id": chunk.metadata.document_id,
                "document_name": chunk.metadata.document_name,
                "page": chunk.metadata.page,
                "cited": chunk.metadata.document_id in cited_ids,
                "grams": _gram_set(tokens, min_n),
            }
        )
    return out


def _gram_set(tokens: list[str], min_n: int) -> set[tuple[str, ...]]:
    return {tuple(tokens[i : i + min_n]) for i in range(0, len(tokens) - min_n + 1)}


def _longest_hit(
    answer_tokens: list[str],
    start: int,
    min_n: int,
    sources: list[dict],
) -> tuple[int, int, dict] | None:
    needle = tuple(answer_tokens[start : start + min_n])
    candidates = [src for src in sources if needle in src["grams"]]
    if not candidates:
        return None
    end = start + min_n
    while end < len(answer_tokens):
        nxt = tuple(answer_tokens[end - min_n + 1 : end + 1])
        still = [src for src in candidates if nxt in src["grams"]]
        if not still:
            break
        candidates = still
        end += 1
    source = sorted(candidates, key=lambda src: (not src["cited"], src["document_name"]))[0]
    return start, end, source


def _flag_sentences(answer: str, matches: Sequence[PlagiarismMatch]) -> list[FlaggedSentence]:
    if not matches:
        return []
    sentences = split_sentences(answer, min_chars=12) or [answer]
    flagged: list[FlaggedSentence] = []
    for sentence in sentences:
        sent_tokens = tokenize(sentence)
        blob = " ".join(sent_tokens)
        hits = [match for match in matches if match.text and match.text in blob]
        if hits:
            uncited = any(not match.cited for match in hits)
            flagged.append(
                FlaggedSentence(
                    text=sentence,
                    matches=hits,
                    corrections=_correction_hints(hits),
                    kind="verbatim" if uncited else "paraphrased",
                )
            )
    return flagged


def _correction_hints(hits: Sequence[PlagiarismMatch]) -> list[str]:
    lines = ["Reword this passage so it is not a long verbatim copy."]
    seen: set[str] = set()
    for match in hits:
        name = match.document_name or match.document_id or "this source"
        page = f", p. {match.page}" if match.page is not None else ""
        line = f"Cite {name}{page}."
        if line in seen:
            continue
        seen.add(line)
        lines.append(line)
    return lines


def _originality_spans(
    text: str,
    matches: Sequence[PlagiarismMatch],
    chunks: Sequence[Chunk],
) -> tuple[list[FlaggedSentence], list[FlaggedSentence]]:
    source_sets = _source_token_sets(chunks)
    sentences = split_sentences(text, min_chars=12) or ([text] if text.strip() else [])
    spans: list[FlaggedSentence] = []
    for sentence in sentences:
        sent_tokens = tokenize(sentence)
        blob = " ".join(sent_tokens)
        hits = [match for match in matches if match.text and match.text in blob]
        kind, used, corrections = _classify_sentence(sentence, hits, source_sets)
        spans.append(
            FlaggedSentence(
                text=sentence,
                matches=used,
                corrections=corrections,
                kind=kind,
            )
        )
    flagged = [span for span in spans if span.kind != "original"]
    return spans, flagged


def _source_token_sets(chunks: Sequence[Chunk]) -> list[tuple[set[str], str, str, int | None]]:
    out: list[tuple[set[str], str, str, int | None]] = []
    for chunk in chunks:
        parts = split_sentences(chunk.text, min_chars=12) or [chunk.text]
        for part in parts:
            tokens = set(tokenize(part))
            if len(tokens) < 8:
                continue
            out.append(
                (
                    tokens,
                    chunk.metadata.document_name,
                    chunk.metadata.document_id,
                    chunk.metadata.page,
                )
            )
    return out


def _classify_sentence(
    sentence: str,
    hits: Sequence[PlagiarismMatch],
    source_sets: Sequence[tuple[set[str], str, str, int | None]],
) -> tuple[str, list[PlagiarismMatch], list[str]]:
    if hits:
        uncited = any(not match.cited for match in hits)
        kind = "verbatim" if uncited else "paraphrased"
        return kind, list(hits), _correction_hints(hits)
    sent = set(tokenize(sentence))
    if len(sent) < 8 or not source_sets:
        return "original", [], []
    best_j = 0.0
    best: tuple[str, str, int | None] | None = None
    for tokens, name, doc_id, page in source_sets:
        union = sent | tokens
        if not union:
            continue
        score = len(sent & tokens) / len(union)
        if score > best_j:
            best_j = score
            best = (name, doc_id, page)
    if best is not None and best_j >= 0.55:
        name, doc_id, page = best
        match = PlagiarismMatch(
            text=" ".join(tokenize(sentence)[:12]),
            document_id=doc_id,
            document_name=name,
            page=page,
            cited=False,
            n_words=len(sent),
        )
        hints = [
            "Reword this passage; it is close to another source without being a long verbatim copy.",
            f"Cite {name}" + (f", p. {page}." if page is not None else "."),
        ]
        return "paraphrased", [match], hints
    return "original", [], []


def _section_originality(text: str, spans: Sequence[FlaggedSentence]) -> list[SectionOriginality]:
    blocks = split_into_sections(text)
    by_text = {span.text: span for span in spans}
    out = []
    for title, body in blocks:
        sentences = split_sentences(body, min_chars=12) or ([body] if body.strip() else [])
        if not sentences:
            continue
        flagged = 0
        for sentence in sentences:
            span = by_text.get(sentence)
            if span and span.kind != "original":
                flagged += 1
        n = len(sentences)
        out.append(
            SectionOriginality(
                title=title or "Untitled",
                originality=round(1.0 - (flagged / n), 4),
                n_sentences=n,
                n_flagged=flagged,
            )
        )
    return out


def score_uploaded_paper(
    filename: str,
    pages: Sequence[LoadedPage],
    library_chunks: Sequence[Chunk],
    settings: Settings | None = None,
) -> "PaperPlagiarismCheck":
    from ..models.query import PaperPlagiarismCheck, PlagiarismSourceShare

    settings = settings or get_settings()
    text = "\n\n".join(page.text for page in pages if getattr(page, "text", "").strip())
    words = tokenize(text)
    n_words = len(words)
    library_empty = len(library_chunks) == 0
    min_n = max(3, int(settings.plagiarism_min_ngram))
    flags: list[str] = []
    academic_chunks, search_flags = _academic_index_chunks(filename, text, words, min_n, settings)
    flags.extend(search_flags)
    combined = list(library_chunks) + academic_chunks
    report = check_plagiarism(text, evidence=[], library_chunks=combined, settings=settings)
    denom = max(1, n_words)
    meta = {chunk.metadata.document_id: chunk.metadata for chunk in combined}
    grouped: dict[str, PlagiarismSourceShare] = {}
    for match in report.matches:
        row = grouped.get(match.document_id)
        if row is None:
            extra = meta.get(match.document_id)
            payload = extra.extra if extra else {}
            origin = payload.get("origin") or (
                "academic" if str(match.document_id).startswith("academic:") else "library"
            )
            row = PlagiarismSourceShare(
                document_id=match.document_id,
                document_name=match.document_name or match.document_id,
                origin=origin if origin in {"library", "academic"} else "library",
                url=payload.get("url"),
                doi=payload.get("doi"),
            )
            grouped[match.document_id] = row
        row.n_words += match.n_words
        row.share = round(row.n_words / denom, 4)
    sources = sorted(grouped.values(), key=lambda item: item.share, reverse=True)
    flags = flags + list(report.flags)
    if library_empty:
        flags.insert(
            0,
            "Library is empty. Matching uses academic indexes (title and abstract), not the full open web.",
        )
    spans, flagged = _originality_spans(text, report.matches, combined)
    sections = _section_originality(text, spans)
    return PaperPlagiarismCheck(
        filename=filename,
        n_words=n_words,
        n_pages=len(pages),
        similarity=report.overlap_ratio,
        originality=report.originality,
        risk=report.risk,
        library_empty=library_empty,
        matches=report.matches,
        flagged_sentences=flagged,
        sources=sources,
        flags=flags,
        spans=spans,
        sections=sections,
    )


def _academic_index_chunks(
    filename: str,
    text: str,
    words: Sequence[str],
    min_n: int,
    settings: Settings,
) -> tuple[list[Chunk], list[str]]:
    query = _academic_search_query(filename, text, words)
    if not query:
        return [], []
    try:
        hits, provider = search_papers(query, limit=8, settings=settings)
    except Exception:
        logger.exception("Academic plagiarism search failed")
        return [], ["Academic search unavailable; scored Library only."]
    chunks = _chunks_from_hits(hits, min_n)
    flags: list[str] = []
    if provider and provider != "none":
        flags.append(f"Compared title and abstracts from {provider.replace('_', ' ')}.")
    return chunks, flags


def _academic_search_query(filename: str, text: str, words: Sequence[str]) -> str:
    file_title = title_from_filename(filename)
    heading = ""
    for line in text.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            heading = stripped
            break
    title = ""
    if heading and heading.lower() != file_title.lower() and len(heading.split()) >= 3:
        title = heading[:200]
    elif len(file_title.split()) >= 4:
        title = file_title
    opening = " ".join(list(words)[:20])
    query = " ".join(part for part in (title, opening) if part).strip()
    return query[:180]


def _chunks_from_hits(hits: Sequence[PaperHit], min_n: int) -> list[Chunk]:
    out: list[Chunk] = []
    for hit in hits:
        blob = f"{hit.title or ''}\n\n{hit.abstract or ''}".strip()
        if len(tokenize(blob)) < min_n:
            continue
        doc_id = f"academic:{hit.source}:{hit.paper_id}"
        url = hit.url
        if not url and hit.doi:
            url = f"https://doi.org/{str(hit.doi).replace('https://doi.org/', '')}"
        out.append(
            Chunk(
                chunk_id=f"{doc_id}::abs",
                text=blob,
                metadata=ChunkMetadata(
                    document_id=doc_id,
                    document_name=hit.title or doc_id,
                    source="academic",
                    extra={"origin": "academic", "url": url, "doi": hit.doi},
                ),
            )
        )
    return out
