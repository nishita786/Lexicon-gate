"""Dependency-free linguistic helpers shared across the pipeline.

The evidence gate, claim verifier and contradiction detector all need the same
primitives: tokenisation, sentence segmentation, negation/polarity detection,
numeric extraction and lexical similarity. Keeping them in one place means the
components stay consistent with one another.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache

STOPWORDS: frozenset[str] = frozenset(
    """
a about above after again against all also am an and any are aren't as at be
because been before being below between both but by can cannot could couldn't
did didn't do does doesn't doing don't down during each few for from further
had hadn't has hasn't have haven't having he her here hers herself him himself
his how however i if in into is isn't it its itself just let's me more most
must mustn't my myself no nor not of off on once only or other ought our ours
ourselves out over own same shan't she should shouldn't so some such than that
the their theirs them themselves then there these they this those through to
too under until up upon very was wasn't we were weren't what when where which
while who whom why with won't would wouldn't you your yours yourself yourselves
what's whats does doe using used use may might shall will can't
""".split()
)

NEGATION_TOKENS: frozenset[str] = frozenset(
    """
no not never none neither nor cannot can't cant don't dont doesn't doesnt
didn't didnt won't wont isn't isnt aren't arent wasn't wasnt weren't werent
without lacks lacking fails failed fail unable rarely seldom nothing nowhere
false incorrect untrue unsupported absent excludes excluded prevents prevented
""".split()
)

ANTONYM_PAIRS: tuple[tuple[str, str], ...] = (
    ("increase", "decrease"),
    ("increases", "decreases"),
    ("increased", "decreased"),
    ("improve", "degrade"),
    ("improves", "degrades"),
    ("improved", "degraded"),
    ("higher", "lower"),
    ("high", "low"),
    ("more", "less"),
    ("faster", "slower"),
    ("fast", "slow"),
    ("better", "worse"),
    ("best", "worst"),
    ("reduce", "increase"),
    ("reduces", "increases"),
    ("reduced", "increased"),
    ("reducing", "increasing"),
    ("reduce", "raise"),
    ("reduces", "raises"),
    ("effective", "ineffective"),
    ("efficient", "inefficient"),
    ("safe", "unsafe"),
    ("stable", "unstable"),
    ("supported", "unsupported"),
    ("beneficial", "harmful"),
    ("helps", "hurts"),
    ("enable", "prevent"),
    ("enables", "prevents"),
    ("possible", "impossible"),
    ("required", "optional"),
    ("always", "never"),
    ("outperforms", "underperforms"),
    ("superior", "inferior"),
    ("gain", "loss"),
    ("positive", "negative"),
    ("accepted", "rejected"),
    ("recommended", "discouraged"),
    ("significant", "negligible"),
)

_ANTONYM_LOOKUP: dict[str, set[str]] = {}
for _a, _b in ANTONYM_PAIRS:
    _ANTONYM_LOOKUP.setdefault(_a, set()).add(_b)
    _ANTONYM_LOOKUP.setdefault(_b, set()).add(_a)

HEDGE_TOKENS: frozenset[str] = frozenset(
    """
may might possibly perhaps probably likely unlikely apparently seemingly
suggests suggest appears arguably potentially roughly approximately about
""".split()
)

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_\-']*|\d+(?:\.\d+)?%?")
_WORD_RE = re.compile(r"[A-Za-z]{2,}")
_NUMBER_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(%|percent|x|ms|s|gb|mb|k|m|b)?", re.I)
_SENTENCE_SPLIT_RE = re.compile(
    r"(?<!\b[A-Z])(?<!\b[A-Z]\.[A-Z])(?<!\be\.g)(?<!\bi\.e)(?<!\betc)"
    r"(?<!\bFig)(?<!\bEq)(?<!\bNo)(?<!\bvs)(?<=[.!?])[\s\n]+"
)
_ACRONYM_RE = re.compile(r"\b[A-Z][A-Z0-9\-]{1,9}\b")
_PROPER_RE = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b")
_WHITESPACE_RE = re.compile(r"[ \t\u00a0]+")


def normalise_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WHITESPACE_RE.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def tokenize(text: str) -> list[str]:
    return [tok.lower() for tok in _TOKEN_RE.findall(text or "")]


def content_tokens(text: str) -> list[str]:
    return [tok for tok in tokenize(text) if tok not in STOPWORDS and len(tok) > 1]


@lru_cache(maxsize=8192)
def content_token_set(text: str) -> frozenset[str]:
    return frozenset(content_tokens(text))


def stem(token: str) -> str:
    """A small, conservative suffix stripper.

    A full Porter stemmer is unnecessary here and its aggressive rewrites hurt
    entity matching (e.g. ``dropout`` -> ``dropou``).
    """

    for suffix in ("ization", "isation", "ations", "ation", "ements", "ement",
                   "ingly", "edly", "ness", "ities", "ity", "ies", "ing",
                   "ers", "er", "ed", "es", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            base = token[: -len(suffix)]
            if suffix in {"ies", "ity", "ities"}:
                base += "y" if suffix != "ity" else ""
            return base
    return token


def stem_set(text: str) -> set[str]:
    return {stem(tok) for tok in content_tokens(text)}


def term_bag(text: str) -> set[str]:
    """Token set used for coverage / co-occurrence, with light stemming.

    Includes the raw token, a conservative stem, and a 5-character prefix so
    ``retrieval``/``retrieved`` and ``improve``/``improves`` still match.
    """

    bag: set[str] = set()
    for token in content_tokens(text):
        bag.add(token)
        stemmed = stem(token)
        bag.add(stemmed)
        if len(token) >= 5:
            bag.add(token[:5])
        if len(stemmed) >= 5:
            bag.add(stemmed[:5])
    return bag


def split_sentences(text: str, min_chars: int = 25) -> list[str]:
    text = normalise_whitespace(text)
    if not text:
        return []
    raw_parts: list[str] = []
    for block in text.split("\n"):
        block = block.strip()
        if not block:
            continue
        raw_parts.extend(part.strip() for part in _SENTENCE_SPLIT_RE.split(block))
    sentences: list[str] = []
    buffer = ""
    for part in raw_parts:
        if not part:
            continue
        candidate = f"{buffer} {part}".strip() if buffer else part
        if len(candidate) < min_chars:
            buffer = candidate
            continue
        sentences.append(candidate)
        buffer = ""
    if buffer:
        if sentences:
            sentences[-1] = f"{sentences[-1]} {buffer}".strip()
        else:
            sentences.append(buffer)
    return sentences


def extract_entities(text: str) -> list[str]:
    """Heuristic entity extraction: acronyms, proper nouns and hyphenated terms."""

    found: list[str] = []
    seen: set[str] = set()
    for match in _ACRONYM_RE.findall(text or ""):
        key = match.lower()
        if key not in seen and key not in STOPWORDS:
            seen.add(key)
            found.append(match)
    for match in _PROPER_RE.findall(text or ""):
        key = match.lower()
        if key in seen or key in STOPWORDS:
            continue
        seen.add(key)
        found.append(match)
    for match in re.findall(r"\b[a-z]+-[a-z]+(?:-[a-z]+)?\b", (text or "").lower()):
        if match not in seen:
            seen.add(match)
            found.append(match)
    return found


def extract_numbers(text: str) -> list[str]:
    out: list[str] = []
    for value, unit in _NUMBER_RE.findall(text or ""):
        unit = (unit or "").lower()
        unit = "%" if unit in {"%", "percent"} else unit
        out.append(f"{value}{unit}")
    return out


def numeric_values(text: str) -> list[float]:
    values: list[float] = []
    for value, _unit in _NUMBER_RE.findall(text or ""):
        try:
            values.append(float(value))
        except ValueError:
            continue
    return values


def negation_count(text: str) -> int:
    return sum(1 for tok in tokenize(text) if tok in NEGATION_TOKENS)


def has_hedge(text: str) -> bool:
    return any(tok in HEDGE_TOKENS for tok in tokenize(text))


def jaccard(a: set[str] | frozenset[str], b: set[str] | frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def containment(needle: set[str] | frozenset[str], haystack: set[str] | frozenset[str]) -> float:
    """Fraction of ``needle`` tokens present in ``haystack``.

    Asymmetric on purpose: a short claim can be fully contained in a long
    passage, and that is exactly what "supported" should mean.
    """

    if not needle:
        return 0.0
    return len(needle & haystack) / len(needle)


def idf_weighted_containment(
    needle_tokens: list[str],
    haystack: set[str] | frozenset[str],
    idf: dict[str, float],
    default_idf: float = 1.0,
) -> float:
    """Containment where rare terms count for more than common ones."""

    if not needle_tokens:
        return 0.0
    total = 0.0
    matched = 0.0
    for token in set(needle_tokens):
        weight = idf.get(token, default_idf)
        total += weight
        if token in haystack:
            matched += weight
    if total <= 0:
        return 0.0
    return matched / total


def cosine(vec_a, vec_b) -> float:
    """Cosine similarity for plain sequences (no numpy requirement)."""

    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(vec_a, vec_b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    return dot / math.sqrt(norm_a * norm_b)


def polarity_conflict(text_a: str, text_b: str) -> float:
    """Estimate whether two statements assert opposite things.

    Combines a negation-parity signal with antonym co-occurrence. Returns a
    value in ``[0, 1]``.
    """

    neg_a = negation_count(text_a)
    neg_b = negation_count(text_b)
    # Contrastive constructions ("rather than", "instead of", "as opposed to")
    # flip polarity even without an explicit negation token.
    contrast = ("rather than", "instead of", "as opposed to", "contrary to", "the opposite")
    lowered_a = (text_a or "").lower()
    lowered_b = (text_b or "").lower()
    if any(marker in lowered_a for marker in contrast):
        neg_a += 1
    if any(marker in lowered_b for marker in contrast):
        neg_b += 1
    parity = 1.0 if (neg_a % 2) != (neg_b % 2) else 0.0

    stems_a = stem_set(text_a)
    stems_b = stem_set(text_b)
    antonym_hits = 0
    for token in stems_a | set(tokenize(text_a)):
        opposites = _ANTONYM_LOOKUP.get(token, set()) | {
            stem(opp) for opp in _ANTONYM_LOOKUP.get(token, set())
        }
        if opposites & (stems_b | set(tokenize(text_b))):
            antonym_hits += 1
    antonym_signal = min(1.0, antonym_hits / 1.0)

    if antonym_signal and parity:
        return min(1.0, 0.55 * antonym_signal + 0.45 * parity)
    if antonym_signal:
        return min(1.0, antonym_signal)
    return parity * 0.75


def numeric_conflict(text_a: str, text_b: str) -> float:
    """Detect incompatible numeric assertions between two statements."""

    nums_a = numeric_values(text_a)
    nums_b = numeric_values(text_b)
    if not nums_a or not nums_b:
        return 0.0
    if set(nums_a) & set(nums_b):
        return 0.0
    conflicts = 0
    comparisons = 0
    for a in nums_a:
        for b in nums_b:
            comparisons += 1
            scale = max(abs(a), abs(b), 1e-6)
            if abs(a - b) / scale > 0.15:
                conflicts += 1
    if comparisons == 0:
        return 0.0
    return conflicts / comparisons


def build_idf(documents: list[str]) -> dict[str, float]:
    """Smoothed inverse document frequency over token *sets*."""

    n_docs = max(1, len(documents))
    df: Counter[str] = Counter()
    for doc in documents:
        for token in set(content_tokens(doc)):
            df[token] += 1
    return {
        token: math.log((n_docs - count + 0.5) / (count + 0.5) + 1.0)
        for token, count in df.items()
    }


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def truncate(text: str, limit: int = 320) -> str:
    text = normalise_whitespace(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"
