"""Deterministic grounded-generation engine.

This engine backs :class:`~app.services.llm.extractive_provider.ExtractiveProvider`
and lets the whole research system run and be evaluated with **no API key and no
network access**, producing reproducible numbers.

Design note that matters for the validity of the experiment
-----------------------------------------------------------
The engine is a *single* generator shared by all three pipelines. It is not
"safer" for the enhanced pipeline: given the same query and the same evidence it
returns byte-identical output. Like a real abstractive model it produces

1. a **synthesised lead sentence** that answers the question directly, formed by
   turning the question into a declarative stem and completing it with the
   best-matching span from the evidence, and
2. **extracted supporting sentences** carrying citations.

The lead is the abstractive part, so when the retrieved evidence does not
actually contain the answer the lead asserts something the sources do not
support. That is a real, measurable hallucination, and catching it is precisely
what the evidence gate and claim-level verifier are being evaluated on. Any
difference between pipelines therefore comes from architecture, not from giving
one pipeline a better generator.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from ...text_utils import (
    STOPWORDS,
    build_idf,
    clamp,
    content_tokens,
    definition_subject,
    first_question_clause,
    is_concept_definition_query,
    is_definitional_sentence,
    idf_weighted_containment,
    jaccard,
    normalise_query_text,
    off_topic_penalty,
    remainder_question_clause,
    split_sentences,
    stem,
    stem_set,
    truncate,
)

MAX_SUPPORTING_SENTENCES = 4
MIN_SENTENCE_SCORE = 0.06
REDUNDANCY_PENALTY = 0.65

_QUESTION_PREFIX_RE = re.compile(
    r"^(?:please\s+)?(?:can you\s+|could you\s+|tell me\s+|explain\s+)?", re.I
)
_CLAUSE_SPLIT_RE = re.compile(
    r"\s*(?:,\s*(?:which|that|and|but|while|whereas|because)\b|;|\s+—\s+|\s+--\s+)\s*", re.I
)
_COPULA_RE = re.compile(
    r"\b(?:is|are|was|were|means|refers to|provides|provide|offers|offer|"
    r"allows|allow|enables|enable|reduces|reduce|improves|improve|"
    r"increases|increase|decreases|decrease|causes|cause|results in|"
    r"consists of|includes|include|achieves|achieve|reports|reported)\b",
    re.I,
)


@dataclass(slots=True)
class EvidenceSentence:
    """One candidate sentence drawn from a retrieved chunk."""

    text: str
    citation_id: int
    chunk_id: str
    document_name: str
    position: int
    chunk_rank: int
    chunk_score: float
    score: float = 0.0


# --------------------------------------------------------------------------- #
# Sentence scoring and selection
# --------------------------------------------------------------------------- #
def collect_sentences(evidence: Sequence[dict[str, Any]]) -> list[EvidenceSentence]:
    sentences: list[EvidenceSentence] = []
    for rank, item in enumerate(evidence):
        text = item.get("text") or ""
        for position, sentence in enumerate(split_sentences(text)):
            sentences.append(
                EvidenceSentence(
                    text=sentence,
                    citation_id=int(item.get("citation_id", rank + 1)),
                    chunk_id=str(item.get("chunk_id", "")),
                    document_name=str(item.get("document_name", "")),
                    position=position,
                    chunk_rank=rank,
                    chunk_score=float(item.get("relevance_score", item.get("fused_score", 0.0))),
                )
            )
    return sentences


def score_sentences(
    sentences: list[EvidenceSentence],
    query: str,
    idf: dict[str, float],
    focus_terms: Iterable[str] = (),
    question_type: str = "",
) -> list[EvidenceSentence]:
    """Score each candidate sentence for how well it answers the query."""

    query = normalise_query_text(query)
    query_tokens = content_tokens(query)
    query_stems = {stem(tok) for tok in query_tokens}
    focus_stems = {stem(tok.lower()) for term in focus_terms for tok in content_tokens(term)}
    subject_stems = stem_set(definition_subject(query))
    definitional = question_type == "definition" or is_concept_definition_query(query)

    for sentence in sentences:
        sentence_stems = stem_set(sentence.text)
        lexical = idf_weighted_containment(
            [stem(tok) for tok in query_tokens],
            sentence_stems,
            {stem(k): v for k, v in idf.items()},
        )
        overlap = jaccard(query_stems, sentence_stems)
        focus = (
            len(focus_stems & sentence_stems) / len(focus_stems) if focus_stems else 0.0
        )
        # Earlier sentences in a chunk and higher-ranked chunks are mild priors.
        position_prior = 1.0 / (1.0 + 0.18 * sentence.position)
        rank_prior = 1.0 / (1.0 + 0.25 * sentence.chunk_rank)
        length_prior = clamp(len(sentence.text) / 220.0, 0.35, 1.0)
        definition_boost = (
            0.28 if definitional and is_definitional_sentence(sentence.text, subject_stems) else 0.0
        )
        topical = off_topic_penalty(sentence.text, query) if definitional else 0.0

        sentence.score = (
            (
                0.44 * lexical
                + 0.16 * overlap
                + 0.14 * focus
                + 0.10 * position_prior
                + 0.10 * rank_prior
                + 0.06 * clamp(sentence.chunk_score)
            )
            * length_prior
            + definition_boost
            - topical
        )
    sentences.sort(key=lambda s: (-s.score, s.chunk_rank, s.position))
    return sentences


def select_sentences(
    scored: list[EvidenceSentence],
    limit: int = MAX_SUPPORTING_SENTENCES,
    avoid: Sequence[str] = (),
) -> list[EvidenceSentence]:
    """Greedy MMR selection: relevant but non-redundant sentences."""

    avoid_stems = [stem_set(text) for text in avoid if text]
    chosen: list[EvidenceSentence] = []
    chosen_stems: list[set[str]] = []

    for candidate in scored:
        if candidate.score < MIN_SENTENCE_SCORE and chosen:
            break
        cand_stems = stem_set(candidate.text)
        if any(jaccard(cand_stems, blocked) > 0.55 for blocked in avoid_stems):
            continue
        redundancy = max((jaccard(cand_stems, prev) for prev in chosen_stems), default=0.0)
        if redundancy > REDUNDANCY_PENALTY:
            continue
        chosen.append(candidate)
        chosen_stems.append(cand_stems)
        if len(chosen) >= limit:
            break

    if not chosen and scored:
        chosen = [scored[0]]
    return chosen


# --------------------------------------------------------------------------- #
# Lead-sentence synthesis (the abstractive step)
# --------------------------------------------------------------------------- #
def declarative_stem(query: str) -> tuple[str, str]:
    """Turn a question into a declarative stem.

    Returns ``(stem, mode)`` where ``mode`` tells the caller how to attach the
    answer span.
    """

    text = _QUESTION_PREFIX_RE.sub("", (query or "").strip()).strip()
    text = first_question_clause(text)
    text = text.rstrip("?").strip()
    lowered = text.lower()

    patterns: tuple[tuple[str, str, str], ...] = (
        (r"^what (?:is|are|was|were) the ([\w\s\-']+?) of (.+)$", "The {0} of {1} is", "copula"),
        (r"^what (?:is|are|was|were) the ([\w\s\-']+?) for (.+)$", "The {0} for {1} is", "copula"),
        (r"^what (?:is|are|was|were) (.+)$", "{0} is", "copula"),
        (r"^what does (.+?) (?:do|mean|provide|offer|achieve)$", "{0} provides", "verb"),
        (r"^what (?:happens|occurs) (?:when|if) (.+)$", "When {0},", "clause"),
        (r"^which (.+)$", "The {0} is", "copula"),
        (r"^who (?:is|are|was|were) (.+)$", "{0} is", "copula"),
        (r"^how (?:does|do|did) (.+)$", "{0} by", "verb"),
        (r"^how (?:is|are|was|were) (.+)$", "{0} is", "copula"),
        (r"^how many (.+)$", "The number of {0} is", "copula"),
        (r"^how much (.+)$", "The amount of {0} is", "copula"),
        (r"^why (?:does|do|did|is|are) (.+)$", "{0} because", "clause"),
        (r"^when (?:does|do|did|is|are|was|were) (.+)$", "{0} occurs", "verb"),
        (r"^where (?:is|are|does|do) (.+)$", "{0} is located", "verb"),
        (r"^(?:list|name|describe|explain|summarise|summarize) (.+)$", "The {0} reported is", "copula"),
        (r"^(?:do|does|did|is|are|was|were|can|could|should|will) (.+)$", "Yes — {0}", "yesno"),
    )

    for pattern, template, mode in patterns:
        match = re.match(pattern, lowered, re.I)
        if not match:
            continue
        groups = [g.strip() for g in match.groups()]
        try:
            built = template.format(*groups)
        except (IndexError, KeyError):  # pragma: no cover - defensive
            continue
        return built[0].upper() + built[1:], mode

    return "According to the retrieved sources,", "fallback"


def extract_answer_span(sentence: str, query: str, idf: dict[str, float]) -> str:
    """Pick the most informative clause of ``sentence`` relative to ``query``."""

    query_stems = stem_set(query)
    candidates: list[str] = []

    copula = _COPULA_RE.search(sentence)
    if copula:
        tail = sentence[copula.end():].strip(" ,.;:")
        if len(tail) > 12:
            candidates.append(tail)

    for clause in _CLAUSE_SPLIT_RE.split(sentence):
        clause = clause.strip(" ,.;:")
        if len(clause) > 12:
            candidates.append(clause)
    candidates.append(sentence.strip(" .;:"))

    def novelty(text: str) -> float:
        tokens = [stem(tok) for tok in content_tokens(text)]
        if not tokens:
            return 0.0
        stems = {stem(k): v for k, v in idf.items()}
        novel = [tok for tok in tokens if tok not in query_stems]
        if not novel:
            return 0.0
        mass = sum(stems.get(tok, 1.0) for tok in novel)
        return mass / (1.0 + 0.012 * len(text))

    best = max(candidates, key=novelty)
    best = re.sub(r"^(?:that|which|and|but|so)\s+", "", best, flags=re.I)
    return best.strip(" ,.;:")


def _span_covers_subject(query: str, span: str, sentence: str) -> bool:
    subject_stems = stem_set(definition_subject(query))
    if not subject_stems:
        return True
    covered = stem_set(span) | stem_set(sentence)
    if not (subject_stems & covered):
        return False
    if is_concept_definition_query(query):
        return is_definitional_sentence(sentence, subject_stems) or is_definitional_sentence(
            span, subject_stems
        )
    return True


def synthesise_lead(
    query: str,
    best: EvidenceSentence,
    idf: dict[str, float],
) -> str:
    """Compose a direct answer sentence for the question.

    This is intentionally abstractive: it commits to an answer using the best
    available span. When retrieval was poor, the resulting assertion is not
    entailed by the evidence, which downstream verification is meant to catch.
    """

    query = normalise_query_text(query)
    span = extract_answer_span(best.text, query, idf)
    span = truncate(span, 240)
    if not _span_covers_subject(query, span, best.text):
        return ""
    lead_stem, mode = declarative_stem(query)

    if mode == "yesno":
        body = lead_stem.split("— ", 1)[-1]
        sentence = f"Yes — {body}, as the sources indicate {span}"
    elif mode == "clause":
        sentence = f"{lead_stem} {span}"
    elif mode == "verb":
        sentence = f"{lead_stem} {span}"
    elif mode == "copula":
        sentence = f"{lead_stem} {span}"
    else:
        sentence = f"{lead_stem} {span}"

    sentence = re.sub(r"\s+", " ", sentence).strip()
    sentence = re.sub(r"\bis is\b", "is", sentence, flags=re.I)
    sentence = re.sub(r"\bby by\b", "by", sentence, flags=re.I)
    if not sentence.endswith((".", "!", "?")):
        sentence += "."
    return sentence[0].upper() + sentence[1:]


# --------------------------------------------------------------------------- #
# Answer composition
# --------------------------------------------------------------------------- #
def compose_answer(
    query: str,
    evidence: Sequence[dict[str, Any]],
    focus_terms: Iterable[str] = (),
    avoid_claims: Sequence[str] = (),
    include_lead: bool = True,
    max_sentences: int = MAX_SUPPORTING_SENTENCES,
    question_type: str = "",
) -> dict[str, Any]:
    """Build a grounded draft answer with inline citation markers."""

    if not evidence:
        return {
            "answer": "",
            "citations": [],
            "selected": [],
            "lead": "",
        }

    query = normalise_query_text(query)
    extra = remainder_question_clause(query)
    merged_focus = [str(term) for term in focus_terms if term]
    if extra and extra not in merged_focus:
        merged_focus.append(extra)
    definitional = question_type == "definition" or is_concept_definition_query(query)
    subject_stems = stem_set(definition_subject(query))

    corpus = [str(item.get("text", "")) for item in evidence]
    idf = build_idf(corpus)

    sentences = score_sentences(
        collect_sentences(evidence),
        query,
        idf,
        merged_focus,
        question_type="definition" if definitional else question_type,
    )
    selected = select_sentences(sentences, limit=max_sentences, avoid=avoid_claims)
    if definitional and subject_stems:
        defined = [
            item for item in selected if is_definitional_sentence(item.text, subject_stems)
        ]
        if defined:
            selected = defined
        else:
            covered = [
                item
                for item in selected
                if (subject_stems & stem_set(item.text))
                and off_topic_penalty(item.text, query) < 0.45
            ]
            if covered:
                selected = covered
            else:
                return {
                    "answer": "",
                    "citations": [],
                    "selected": [],
                    "lead": "",
                }

    parts: list[str] = []
    lead = ""
    if include_lead and selected:
        lead = synthesise_lead(query, selected[0], idf)
        if lead:
            parts.append(lead)

    used_citations: list[int] = []
    for sentence in selected:
        text = sentence.text.strip()
        if not text.endswith((".", "!", "?")):
            text += "."
        parts.append(f"{text} [{sentence.citation_id}]")
        if sentence.citation_id not in used_citations:
            used_citations.append(sentence.citation_id)

    answer = " ".join(parts).strip()
    return {
        "answer": answer,
        "citations": used_citations,
        "selected": [
            {
                "text": s.text,
                "citation_id": s.citation_id,
                "chunk_id": s.chunk_id,
                "score": round(s.score, 4),
            }
            for s in selected
        ],
        "lead": lead,
    }


# --------------------------------------------------------------------------- #
# Claim extraction
# --------------------------------------------------------------------------- #
_CITATION_MARKER_RE = re.compile(r"\s*\[(\d+(?:\s*,\s*\d+)*)\]")


def strip_citations(text: str) -> str:
    return _CITATION_MARKER_RE.sub("", text or "").strip()


def cited_ids(text: str) -> list[int]:
    ids: list[int] = []
    for group in _CITATION_MARKER_RE.findall(text or ""):
        for part in group.split(","):
            part = part.strip()
            if part.isdigit():
                ids.append(int(part))
    return ids


def extract_claims(answer: str, max_claims: int = 12) -> list[dict[str, Any]]:
    """Split an answer into atomic, checkable factual claims."""

    claims: list[dict[str, Any]] = []
    for sentence in split_sentences(answer, min_chars=20):
        inline = cited_ids(sentence)
        clean = strip_citations(sentence)
        if not clean or len(content_tokens(clean)) < 3:
            continue
        pieces = _split_conjunctions(clean)
        for piece in pieces:
            if len(content_tokens(piece)) < 3:
                continue
            claims.append({"text": piece, "inline_citations": inline})
            if len(claims) >= max_claims:
                return claims
    return claims


def _split_conjunctions(sentence: str, min_len: int = 45) -> list[str]:
    """Break long compound sentences into separate assertions."""

    if len(sentence) < 2 * min_len:
        return [sentence]
    parts = re.split(r",\s+(?:and|but|while|whereas)\s+|;\s+", sentence)
    cleaned = [p.strip(" ,;") for p in parts if len(p.strip()) >= min_len]
    if len(cleaned) < 2:
        return [sentence]
    out = []
    for part in cleaned:
        if not part.endswith((".", "!", "?")):
            part += "."
        out.append(part[0].upper() + part[1:])
    return out


# --------------------------------------------------------------------------- #
# Query rewriting
# --------------------------------------------------------------------------- #
_INTENT_EXPANSIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("advantage", ("benefits", "improves performance", "why it helps")),
    ("advantages", ("benefits", "improves performance", "why it helps")),
    ("benefit", ("advantage", "improvement")),
    ("disadvantage", ("limitation", "drawback", "cost")),
    ("limitation", ("drawback", "weakness", "failure case")),
    ("purpose", ("role", "function", "used for")),
    ("difference", ("compared with", "versus", "contrast")),
    ("effect", ("impact", "influence", "result")),
    ("cause", ("reason", "leads to", "because")),
    ("performance", ("accuracy", "results", "evaluation")),
    ("accuracy", ("performance", "error rate", "results")),
    ("method", ("approach", "technique", "algorithm")),
    ("architecture", ("model design", "structure", "components")),
    ("result", ("findings", "evaluation", "measured")),
    ("how", ("mechanism", "procedure", "steps")),
    ("why", ("reason", "explanation", "motivation")),
)


def rewrite_queries(
    query: str,
    keywords: Sequence[str] = (),
    entities: Sequence[str] = (),
    uncovered_terms: Sequence[str] = (),
    corpus_terms: Sequence[str] = (),
    limit: int = 3,
) -> list[str]:
    """Produce alternative phrasings targeted at the weaknesses of the last run.

    Strategies, in order of priority:

    1. **Term expansion** – add domain synonyms for the query intent.
    2. **Gap targeting** – foreground query terms the evidence failed to cover.
    3. **Keyword distillation** – drop question syntax, keep content words.
    4. **Corpus anchoring** – pair the core entity with vocabulary that actually
       occurs in the indexed corpus.
    """

    base_tokens = [tok for tok in content_tokens(query)]
    core = " ".join(dict.fromkeys(base_tokens))
    candidates: list[str] = []

    lowered = query.lower()
    for trigger, expansions in _INTENT_EXPANSIONS:
        if re.search(rf"\b{re.escape(trigger)}\b", lowered):
            subject = " ".join(
                tok for tok in base_tokens if tok != trigger and tok not in STOPWORDS
            )
            for expansion in expansions:
                candidate = f"{subject} {expansion}".strip()
                if candidate:
                    candidates.append(candidate)
            break

    if uncovered_terms:
        gap = " ".join(dict.fromkeys(str(t).lower() for t in uncovered_terms))
        entity_hint = " ".join(str(e) for e in list(entities)[:2])
        candidates.append(" ".join(part for part in (entity_hint, gap) if part).strip())
        candidates.append(f"{gap} {core}".strip())

    if keywords:
        candidates.append(" ".join(dict.fromkeys(str(k).lower() for k in keywords)))

    if entities:
        anchor = " ".join(str(e) for e in list(entities)[:2])
        overlap_terms = [
            term for term in corpus_terms if term not in base_tokens
        ][:4]
        if anchor:
            candidates.append(f"{anchor} {' '.join(overlap_terms)}".strip())

    candidates.append(core)

    seen: set[str] = {" ".join(sorted(base_tokens))}
    out: list[str] = []
    for candidate in candidates:
        candidate = re.sub(r"\s+", " ", candidate).strip()
        if len(candidate) < 4:
            continue
        key = " ".join(sorted(content_tokens(candidate)))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(candidate)
        if len(out) >= limit:
            break
    return out


# --------------------------------------------------------------------------- #
# Coarse reflection (standard Self-RAG granularity)
# --------------------------------------------------------------------------- #
def reflect(answer: str, evidence: Sequence[dict[str, Any]], query: str) -> dict[str, Any]:
    """Whole-answer reflection tokens in the spirit of the Self-RAG paper.

    Deliberately coarse: ``IsRel`` / ``IsSup`` / ``IsUse`` are judged over the
    answer as a whole rather than per claim. The finer-grained, claim-level
    verifier is the enhanced system's contribution and lives elsewhere.
    """

    corpus = [str(item.get("text", "")) for item in evidence]
    context = " ".join(corpus)
    context_stems = stem_set(context)
    answer_clean = strip_citations(answer)
    answer_stems = stem_set(answer_clean)
    query_stems = stem_set(query)

    is_rel = jaccard(query_stems, context_stems)
    support = (
        len(answer_stems & context_stems) / len(answer_stems) if answer_stems else 0.0
    )
    is_use = clamp(0.5 * support + 0.5 * jaccard(answer_stems, query_stems) * 2.0)

    if support >= 0.75:
        sup_token = "FULLY_SUPPORTED"
    elif support >= 0.5:
        sup_token = "PARTIALLY_SUPPORTED"
    else:
        sup_token = "NO_SUPPORT"

    return {
        "is_relevant": is_rel >= 0.08,
        "relevance_score": round(is_rel, 4),
        "support_token": sup_token,
        "support_score": round(support, 4),
        "usefulness": round(is_use, 4),
        "needs_revision": sup_token == "NO_SUPPORT",
    }
