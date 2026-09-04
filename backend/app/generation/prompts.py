"""Generation prompts used by hosted LLM providers.

The extractive provider ignores these and uses the structured ``payload``
instead. Hosted providers receive both, so swapping the LLM does not require
rewriting the pipeline.
"""

from __future__ import annotations

from typing import Sequence

from ..models.query import EvidenceItem, QueryAnalysis


GROUNDED_SYSTEM = """You are a research assistant that answers ONLY from the provided sources.

Rules:
- Every factual sentence must be grounded in a source and cite it as [n].
- If the sources do not contain enough information, say so explicitly.
  Use the exact sentence:
  "I could not find sufficient evidence in the available sources to answer this reliably."
- Do not fill gaps from your own knowledge.
- If sources contradict each other, report both views with citations.
- Do not invent page numbers, figures, or statistics.
"""


def format_evidence(evidence: Sequence[EvidenceItem]) -> str:
    blocks: list[str] = []
    for item in evidence:
        header = f"[{item.citation_id}] {item.citation_label}"
        if item.section:
            header += f" — {item.section}"
        blocks.append(f"{header}\n{item.text.strip()}")
    return "\n\n".join(blocks) if blocks else "(no evidence retrieved)"


def answer_prompt(query: str, evidence: Sequence[EvidenceItem], analysis: QueryAnalysis | None = None) -> str:
    extra = ""
    if analysis and analysis.is_multi_hop:
        extra = "\nThis question likely requires combining evidence from more than one source."
    return (
        f"Question: {query}\n"
        f"{extra}\n\n"
        f"Sources:\n{format_evidence(evidence)}\n\n"
        "Write a concise, evidence-grounded answer with inline citations like [1]."
    )


def revise_prompt(
    query: str,
    evidence: Sequence[EvidenceItem],
    previous_answer: str,
    unsupported_claims: Sequence[str],
) -> str:
    claims = "\n".join(f"- {c}" for c in unsupported_claims) or "- (none listed)"
    return (
        f"Question: {query}\n\n"
        f"Previous draft:\n{previous_answer}\n\n"
        "The following claims were NOT supported by the sources and must be removed or rewritten:\n"
        f"{claims}\n\n"
        f"Sources:\n{format_evidence(evidence)}\n\n"
        "Write a revised answer that only asserts what the sources support. "
        "If that is not enough to answer the question, say so."
    )


def conflict_prompt(
    query: str,
    evidence: Sequence[EvidenceItem],
    conflict_explanations: Sequence[str],
) -> str:
    conflicts = "\n".join(f"- {c}" for c in conflict_explanations)
    return (
        f"Question: {query}\n\n"
        "The retrieved sources disagree:\n"
        f"{conflicts}\n\n"
        f"Sources:\n{format_evidence(evidence)}\n\n"
        "Write an answer that presents both views with citations. "
        "Do not pick a winner unless the sources themselves rank one as more reliable."
    )


INSUFFICIENT_ANSWER = (
    "I could not find sufficient evidence in the available sources to answer this reliably."
)

UNRELATED_ANSWER = (
    "This question is not related to the indexed files. "
    "The sources do not address it, so no answer is given."
)

CONFLICT_PREFIX = (
    "The retrieved sources provide conflicting information."
)
