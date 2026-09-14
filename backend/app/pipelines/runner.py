"""Pipeline runner.

All three systems — Traditional RAG, Standard Self-RAG, Enhanced Self-RAG —
and every ablation variant share this runner. Feature flags decide which
stages execute. The generator is identical across variants, so measured
differences come from architecture, not from giving one pipeline a better
model.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Sequence

from ..config import Settings, get_settings
from ..generation.prompts import (
    CONFLICT_PREFIX,
    GROUNDED_SYSTEM,
    INSUFFICIENT_ANSWER,
    UNGROUNDED_SYSTEM,
    UNRELATED_ANSWER,
    answer_prompt,
    conflict_prompt,
    format_evidence,
    revise_prompt,
    ungrounded_answer_prompt,
)
from ..models.query import (
    AnswerStatus,
    Claim,
    ClaimStatus,
    ContradictionPair,
    EvidenceGateDecision,
    EvidenceItem,
    PipelineName,
    PipelineResult,
    QueryAnalysis,
)
from ..retrieval.adaptive import AdaptiveController
from ..retrieval.hybrid import FusionStrategy, HybridRetriever, RetrievalMode
from ..retrieval.query_analysis import analyse_query
from ..services.llm.base import LLMProvider, LLMRequest, LLMResponse, LLMTask
from ..services.store.knowledge_base import KnowledgeBase
from ..verification.claim_extraction import extract_claims
from ..verification.claim_verifier import ClaimVerifier
from ..verification.confidence import score_confidence
from ..verification.contradiction import detect_contradictions
from ..verification.evidence_gate import EvidenceGate, decision_is_unrelated
from ..verification.hallucination import detect_hallucinations
from ..text_utils import normalise_query_text, remainder_question_clause
from .common import (
    TraceRecorder,
    UsageCounter,
    build_result,
    drop_unsupported_sentences,
    evidence_as_dicts,
    new_query_id,
    number_citations,
)

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Feature flags that distinguish the three systems and the ablation variants."""

    name: PipelineName = PipelineName.enhanced
    retrieval_decision: bool = True
    retrieval_mode: RetrievalMode = RetrievalMode.hybrid
    fusion: FusionStrategy = FusionStrategy.rrf
    evidence_gate: bool = True
    adaptive_retrieval: bool = True
    query_rewrite: bool = True
    claim_verification: bool = True
    hallucination_detection: bool = True
    contradiction_detection: bool = True
    self_correction: bool = True
    self_reflection: bool = False  # Standard Self-RAG whole-answer reflection.
    grounded_generation: bool = True
    skip_retrieval: bool = False
    label: str = ""

    def snapshot(self) -> dict[str, object]:
        return {
            "name": self.name.value,
            "retrieval_decision": self.retrieval_decision,
            "retrieval_mode": self.retrieval_mode.value,
            "fusion": self.fusion.value,
            "evidence_gate": self.evidence_gate,
            "adaptive_retrieval": self.adaptive_retrieval,
            "query_rewrite": self.query_rewrite,
            "claim_verification": self.claim_verification,
            "hallucination_detection": self.hallucination_detection,
            "contradiction_detection": self.contradiction_detection,
            "self_correction": self.self_correction,
            "self_reflection": self.self_reflection,
            "grounded_generation": self.grounded_generation,
            "skip_retrieval": self.skip_retrieval,
        }


def traditional_config() -> PipelineConfig:
    return PipelineConfig(
        name=PipelineName.traditional,
        label="Traditional RAG",
        retrieval_decision=False,
        retrieval_mode=RetrievalMode.dense,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=False,
        hallucination_detection=False,
        contradiction_detection=False,
        self_correction=False,
        self_reflection=False,
        grounded_generation=False,
    )


def self_rag_config() -> PipelineConfig:
    return PipelineConfig(
        name=PipelineName.self_rag,
        label="Standard Self-RAG",
        retrieval_decision=True,
        retrieval_mode=RetrievalMode.dense,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=False,
        hallucination_detection=False,
        contradiction_detection=False,
        self_correction=True,
        self_reflection=True,
        grounded_generation=True,
    )


def enhanced_config() -> PipelineConfig:
    return PipelineConfig(
        name=PipelineName.enhanced,
        label="Enhanced Self-RAG",
        retrieval_decision=True,
        retrieval_mode=RetrievalMode.hybrid,
        evidence_gate=True,
        adaptive_retrieval=True,
        query_rewrite=True,
        claim_verification=True,
        hallucination_detection=True,
        contradiction_detection=True,
        self_correction=True,
        self_reflection=False,
        grounded_generation=True,
    )


def no_rag_config() -> PipelineConfig:
    return PipelineConfig(
        name=PipelineName.no_rag,
        label="Base LLM (no retrieval)",
        retrieval_decision=False,
        skip_retrieval=True,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=False,
        hallucination_detection=False,
        contradiction_detection=False,
        self_correction=False,
        self_reflection=False,
        grounded_generation=False,
    )


def verify_only_config() -> PipelineConfig:
    return PipelineConfig(
        name=PipelineName.rag_verify,
        label="RAG + verification (no retry)",
        retrieval_decision=False,
        retrieval_mode=RetrievalMode.dense,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=True,
        hallucination_detection=True,
        contradiction_detection=False,
        self_correction=False,
        self_reflection=False,
        grounded_generation=True,
    )


ABLATION_VARIANTS: dict[str, PipelineConfig] = {
    "baseline_rag": traditional_config(),
    "self_rag": self_rag_config(),
    "self_rag_hybrid": PipelineConfig(
        name=PipelineName.self_rag,
        label="Self-RAG + Hybrid Retrieval",
        retrieval_mode=RetrievalMode.hybrid,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=False,
        hallucination_detection=False,
        contradiction_detection=False,
        self_correction=True,
        self_reflection=True,
        grounded_generation=True,
    ),
    "self_rag_gate": PipelineConfig(
        name=PipelineName.self_rag,
        label="Self-RAG + Evidence Gate",
        retrieval_mode=RetrievalMode.dense,
        evidence_gate=True,
        adaptive_retrieval=True,
        query_rewrite=True,
        claim_verification=False,
        hallucination_detection=False,
        contradiction_detection=False,
        self_correction=True,
        self_reflection=True,
        grounded_generation=True,
    ),
    "self_rag_claims": PipelineConfig(
        name=PipelineName.self_rag,
        label="Self-RAG + Claim Verification",
        retrieval_mode=RetrievalMode.dense,
        evidence_gate=False,
        adaptive_retrieval=False,
        query_rewrite=False,
        claim_verification=True,
        hallucination_detection=True,
        contradiction_detection=False,
        self_correction=True,
        self_reflection=True,
        grounded_generation=True,
    ),
    "enhanced": enhanced_config(),
}


class PipelineRunner:
    def __init__(
        self,
        kb: KnowledgeBase,
        llm: LLMProvider,
        config: PipelineConfig,
        settings: Settings | None = None,
        evidence_threshold: float | None = None,
    ) -> None:
        self.kb = kb
        self.llm = llm
        self.config = config
        self.settings = settings or get_settings()
        self.retriever = HybridRetriever(
            kb,
            mode=config.retrieval_mode,
            fusion=config.fusion,
        )
        self.gate = EvidenceGate(
            embedder=kb.embedder,
            settings=self.settings,
            threshold=evidence_threshold,
            idf=kb.idf_map(),
            corpus_doc_terms=kb.document_term_sets(),
        )
        self.controller = AdaptiveController(self.settings)
        self.verifier = ClaimVerifier(self.settings, idf=kb.idf_map())

    # ------------------------------------------------------------------ run
    def run(
        self,
        query: str,
        top_k: int | None = None,
        document_ids: Sequence[str] | None = None,
        query_id: str | None = None,
    ) -> PipelineResult:
        t0 = time.perf_counter()
        query_id = query_id or new_query_id()
        trace = TraceRecorder()
        usage = UsageCounter()
        settings = self.settings
        cfg = self.config
        original_query = query
        search_query = normalise_query_text(query)

        analysis = analyse_query(
            search_query,
            initial_top_k=settings.initial_top_k,
            max_top_k=settings.max_top_k,
            corpus_is_empty=self.kb.is_empty(),
        )
        trace.add(
            "analysis",
            "Query analysed",
            detail=(
                f"type={analysis.question_type}, multi-hop={analysis.is_multi_hop}, "
                f"ambiguous={analysis.is_ambiguous}"
            ),
            metrics={"suggested_top_k": analysis.suggested_top_k},
        )

        needs_retrieval = analysis.needs_retrieval
        if cfg.skip_retrieval:
            needs_retrieval = False
            trace.add(
                "retrieval_decision",
                "Skipped retrieval (base LLM)",
                status="skip",
            )
        elif cfg.retrieval_decision:
            needs_retrieval = self._retrieval_decision(analysis, usage)
            trace.add(
                "retrieval_decision",
                "Retrieval required" if needs_retrieval else "Retrieval skipped",
                status="ok" if needs_retrieval else "skip",
                detail=analysis.retrieval_reason,
            )
        else:
            # Traditional RAG always retrieves.
            needs_retrieval = True
            trace.add("retrieval_decision", "Always retrieve (Traditional RAG)")

        if cfg.skip_retrieval:
            answer, status = self._generate(search_query, [], analysis, [], usage, trace)
            return self._finalise(
                query_id, original_query, answer, status,
                [], [], [], [], trace, usage, t0, analysis, [],
            )

        if not needs_retrieval:
            answer = (
                "No document retrieval is needed for this request, and no indexed "
                "evidence was used."
            )
            return self._finalise(
                query_id, original_query, answer, AnswerStatus.no_retrieval_needed,
                [], [], [], [], trace, usage, t0, analysis, [],
            )

        if self.kb.is_empty():
            return self._finalise(
                query_id, original_query, UNRELATED_ANSWER, AnswerStatus.insufficient_evidence,
                [], [], [], [], trace, usage, t0, analysis, [],
                unrelated_to_sources=True,
                mismatch_detail="The library is empty, so nothing can support this question.",
            )

        current_k = self.controller.initial_top_k(analysis, override=top_k)
        current_query = search_query
        rewritten: list[str] = []
        evidence: list[EvidenceItem] = []
        scored: list[EvidenceItem] = []
        kept: list[EvidenceItem] = []
        decisions: list[EvidenceGateDecision] = []
        last_action = "proceed"

        max_attempts = (
            settings.max_retrieval_attempts
            if cfg.adaptive_retrieval or cfg.query_rewrite or cfg.evidence_gate
            else 1
        )

        for attempt in range(1, max_attempts + 1):
            usage.retrieval_attempts += 1
            usage.retrieval_calls += 1
            raw = self.retriever.retrieve(current_query, top_k=current_k, document_ids=document_ids)
            usage.chunks_examined += len(raw)
            evidence = number_citations(raw)
            mode_label = cfg.retrieval_mode.value
            trace.add(
                "retrieval",
                f"{'Hybrid' if mode_label == 'hybrid' else mode_label.capitalize()} retrieval",
                detail=f"{len(evidence)} passages retrieved (k={current_k}) for {current_query!r}",
                metrics={"k": current_k, "n": len(evidence), "attempt": attempt, "mode": mode_label},
            )

            if cfg.evidence_gate:
                remaining = max_attempts - attempt
                outcome = self.gate.evaluate(
                    query=search_query,
                    evidence=evidence,
                    analysis=analysis,
                    attempt=attempt,
                    attempts_remaining=remaining,
                    query_used=current_query,
                )
                decisions.append(outcome.decision)
                scored = outcome.scored_evidence
                kept = number_citations(outcome.kept_evidence)
                last_action = outcome.decision.action
                trace.add(
                    "evidence_gate",
                    f"Evidence score = {outcome.decision.evidence_score:.2f}",
                    status="ok" if outcome.decision.sufficient else "warn",
                    detail=outcome.decision.rationale,
                    metrics={
                        "score": outcome.decision.evidence_score,
                        "threshold": outcome.decision.threshold,
                        "coverage": outcome.decision.coverage,
                        "consistency": outcome.decision.consistency,
                        "action": outcome.decision.action,
                    },
                )
                if outcome.decision.sufficient:
                    evidence = kept
                    break
                if remaining <= 0:
                    evidence = kept
                    break
                if not cfg.adaptive_retrieval and not cfg.query_rewrite:
                    evidence = kept
                    break
                plan = self.controller.plan(
                    decision=outcome.decision,
                    current_top_k=current_k,
                    analysis=analysis,
                    attempts_used=attempt,
                    rewrites=rewritten,
                    llm=self.llm if cfg.query_rewrite else None,
                    corpus_terms=self.kb.corpus_terms(),
                )
                if plan.stop:
                    evidence = kept
                    break
                if plan.rewrite and cfg.query_rewrite:
                    rewritten.append(plan.rewrite)
                    current_query = plan.rewrite
                    trace.add(
                        "rewrite",
                        "Query rewritten",
                        detail=f"{search_query!r} → {plan.rewrite!r}",
                    )
                current_k = plan.next_top_k
            else:
                # No gate: score chunks for later diagnostics but accept them all.
                outcome = self.gate.evaluate(
                    query=search_query,
                    evidence=evidence,
                    analysis=analysis,
                    attempt=attempt,
                    attempts_remaining=0,
                    query_used=current_query,
                )
                decisions.append(outcome.decision)
                scored = outcome.scored_evidence
                evidence = number_citations(scored)
                kept = evidence
                break

        if cfg.evidence_gate and last_action == "abstain":
            last_decision = decisions[-1] if decisions else None
            unrelated = decision_is_unrelated(last_decision)
            refuse = UNRELATED_ANSWER if unrelated else INSUFFICIENT_ANSWER
            mismatch = self._mismatch_detail(original_query, evidence, last_decision) if unrelated else None
            trace.add(
                "abstain",
                "Question does not match the indexed files" if unrelated else "Insufficient evidence — refusing to answer",
                status="warn",
                detail=refuse,
            )
            return self._finalise(
                query_id, original_query, refuse, AnswerStatus.insufficient_evidence,
                evidence, decisions, [], [], trace, usage, t0, analysis, rewritten,
                unrelated_to_sources=unrelated,
                mismatch_detail=mismatch,
            )

        contradictions: list[ContradictionPair] = []
        if cfg.contradiction_detection:
            contradictions = detect_contradictions(evidence, self.settings)
            if contradictions:
                trace.add(
                    "contradiction",
                    f"{len(contradictions)} source conflict(s) detected",
                    status="warn",
                    detail=contradictions[0].explanation,
                )

        answer, status = self._generate(search_query, evidence, analysis, contradictions, usage, trace)

        claims: list[Claim] = []
        if cfg.claim_verification or cfg.hallucination_detection:
            claims = extract_claims(answer, self.llm)
            usage.add_llm(0, 0)
            if claims:
                trace.add(
                    "claims",
                    f"{len(claims)} claim(s) extracted",
                    metrics={"n": len(claims)},
                )

        if (
            cfg.claim_verification
            and claims
            and status
            not in (AnswerStatus.insufficient_evidence, AnswerStatus.no_retrieval_needed)
        ):
            answer, status, claims = self._verify_and_correct(
                search_query, evidence, answer, status, claims, usage, trace
            )

        if cfg.self_reflection and not cfg.claim_verification:
            answer, status = self._reflect(query, evidence, answer, usage, trace)

        if contradictions and status is AnswerStatus.answered and cfg.contradiction_detection:
            if not answer.startswith(CONFLICT_PREFIX):
                answer = f"{CONFLICT_PREFIX} {contradictions[0].explanation} {answer}"
            status = AnswerStatus.conflicting_evidence

        return self._finalise(
            query_id, query, answer, status,
            evidence, decisions, claims, contradictions, trace, usage, t0, analysis, rewritten,
        )

    def _verify_and_correct(
        self,
        query: str,
        evidence: list[EvidenceItem],
        answer: str,
        status: AnswerStatus,
        claims: list[Claim],
        usage: UsageCounter,
        trace: TraceRecorder,
    ) -> tuple[str, AnswerStatus, list[Claim]]:
        settings = self.settings
        result = self.verifier.verify(claims, evidence, query)
        claims = result.claims
        trace.add(
            "verify",
            f"{result.n_supported + result.n_partial}/{len(claims)} claims verified",
            status="ok" if result.support_rate >= settings.claim_support_rate_target else "warn",
            detail=(
                f"support={result.support_rate:.2f}, unsupported={result.n_unsupported}, "
                f"contradicted={result.n_contradicted}"
                + (
                    f", verifier={claims[0].verifier}"
                    if claims and claims[0].verifier
                    else ""
                )
            ),
            metrics={"support_rate": result.support_rate},
        )

        while (
            self.config.self_correction
            and result.important_unsupported
            and usage.correction_loops < settings.max_correction_loops
        ):
            usage.correction_loops += 1
            trace.add(
                "correction",
                "Self-correction triggered",
                status="warn",
                detail=(
                    f"Loop {usage.correction_loops}: "
                    f"{len(result.important_unsupported)} important claim(s) unsupported"
                ),
            )
            answer, status = self._revise(
                query, evidence, answer, result.important_unsupported, usage, trace
            )
            claims = extract_claims(answer, self.llm)
            result = self.verifier.verify(claims, evidence, query)
            claims = result.claims
            trace.add(
                "verify",
                f"After correction: {result.n_supported + result.n_partial}/{len(claims)} verified",
                metrics={"support_rate": result.support_rate},
            )

        if status is AnswerStatus.conflicting_evidence:
            return answer, status, claims
        if self.config.grounded_generation:
            return self._enforce_supported_answer(answer, status, claims, trace)
        return answer, status, claims

    def _enforce_supported_answer(
        self,
        answer: str,
        status: AnswerStatus,
        claims: list[Claim],
        trace: TraceRecorder,
    ) -> tuple[str, AnswerStatus, list[Claim]]:
        good = [claim for claim in claims if claim.status is ClaimStatus.supported]
        bad = [claim for claim in claims if claim.status is not ClaimStatus.supported]
        if not bad:
            return answer, status, claims
        if not good:
            trace.add(
                "abstain",
                "No claim was fully supported by the sources",
                status="warn",
            )
            return INSUFFICIENT_ANSWER, AnswerStatus.insufficient_evidence, claims

        stripped, kept = drop_unsupported_sentences(answer, good, bad)
        if not stripped or stripped == INSUFFICIENT_ANSWER:
            trace.add(
                "abstain",
                "Unsupported claims could not be rewritten from evidence",
                status="warn",
            )
            return INSUFFICIENT_ANSWER, AnswerStatus.insufficient_evidence, claims

        trace.add(
            "correction",
            "Dropped unsupported claims from the answer",
            status="warn",
            detail=f"Kept {len(kept)} supported claim(s); removed {len(bad)}",
        )
        return stripped, AnswerStatus.answered, kept

    # -------------------------------------------------------------- generate
    def _generate(
        self,
        query: str,
        evidence: list[EvidenceItem],
        analysis: QueryAnalysis,
        contradictions: list[ContradictionPair],
        usage: UsageCounter,
        trace: TraceRecorder,
    ) -> tuple[str, AnswerStatus]:
        if contradictions and self.config.contradiction_detection:
            prompt = conflict_prompt(query, evidence, [c.explanation for c in contradictions])
            payload_extra: dict = {
                "include_lead": False,
                "max_sentences": 5,
            }
            system = GROUNDED_SYSTEM if self.config.grounded_generation else None
        elif self.config.skip_retrieval:
            prompt = ungrounded_answer_prompt(query)
            payload_extra = {"include_lead": True, "allow_parametric": True}
            system = UNGROUNDED_SYSTEM
        else:
            prompt = answer_prompt(query, evidence, analysis)
            extra_focus = remainder_question_clause(query)
            payload_extra = {
                "include_lead": True,
                "question_type": analysis.question_type,
                "focus_terms": [extra_focus] if extra_focus else list(analysis.keywords[:6]),
            }
            system = GROUNDED_SYSTEM if self.config.grounded_generation else None

        response = self._llm(
            LLMTask.answer,
            prompt,
            system,
            {
                "query": query,
                "evidence": evidence_as_dicts(evidence),
                "keywords": analysis.keywords,
                **payload_extra,
            },
            usage,
        )
        answer = _llm_answer_text(response)
        trace.add("generate", "Draft answer generated", metrics={"chars": len(answer)})
        if not answer.strip():
            return INSUFFICIENT_ANSWER, AnswerStatus.insufficient_evidence
        if answer.strip() == INSUFFICIENT_ANSWER:
            return answer, AnswerStatus.insufficient_evidence
        if contradictions and self.config.contradiction_detection:
            return answer, AnswerStatus.conflicting_evidence
        return answer, AnswerStatus.answered

    def _revise(
        self,
        query: str,
        evidence: list[EvidenceItem],
        previous: str,
        unsupported: list[Claim],
        usage: UsageCounter,
        trace: TraceRecorder,
    ) -> tuple[str, AnswerStatus]:
        claims_text = [c.text for c in unsupported]
        response = self._llm(
            LLMTask.revise,
            revise_prompt(query, evidence, previous, claims_text),
            GROUNDED_SYSTEM,
            {
                "query": query,
                "evidence": evidence_as_dicts(evidence),
                "avoid_claims": claims_text,
                "include_lead": True,
            },
            usage,
        )
        answer = _llm_answer_text(response)
        trace.add("generate", "Revised answer generated")
        if not answer.strip():
            return INSUFFICIENT_ANSWER, AnswerStatus.insufficient_evidence
        return answer, AnswerStatus.answered

    def _reflect(
        self,
        query: str,
        evidence: list[EvidenceItem],
        answer: str,
        usage: UsageCounter,
        trace: TraceRecorder,
    ) -> tuple[str, AnswerStatus]:
        response = self._llm(
            LLMTask.reflect,
            f"Reflect on whether this answer is supported by the sources.\n\n"
            f"Question: {query}\nAnswer: {answer}\n\nSources:\n{format_evidence(evidence)}",
            None,
            {"query": query, "answer": answer, "evidence": evidence_as_dicts(evidence)},
            usage,
        )
        reflection = response.structured or {}
        token = reflection.get("support_token", "PARTIALLY_SUPPORTED")
        trace.add(
            "reflect",
            f"Self-reflection: {token}",
            status="ok" if token != "NO_SUPPORT" else "warn",
            metrics={"support": reflection.get("support_score")},
        )
        if token == "NO_SUPPORT" and self.config.self_correction:
            usage.correction_loops += 1
            # Standard Self-RAG has no claim-level signal, so a NO_SUPPORT
            # reflection is treated as insufficient evidence rather than a
            # second, equally ungrounded generation.
            if self.config.grounded_generation:
                return INSUFFICIENT_ANSWER, AnswerStatus.insufficient_evidence
        return answer, AnswerStatus.answered

    def _retrieval_decision(self, analysis: QueryAnalysis, usage: UsageCounter) -> bool:
        response = self._llm(
            LLMTask.retrieval_decision,
            f"Does answering this question require looking up documents?\nQuestion: {analysis.original_query}",
            None,
            {
                "needs_retrieval": analysis.needs_retrieval,
                "reason": analysis.retrieval_reason,
                "query": analysis.original_query,
            },
            usage,
        )
        if response.structured and "needs_retrieval" in response.structured:
            return bool(response.structured["needs_retrieval"])
        return analysis.needs_retrieval

    def _llm(
        self,
        task: LLMTask,
        prompt: str,
        system: str | None,
        payload: dict,
        usage: UsageCounter,
    ) -> LLMResponse:
        response = self.llm.generate(
            LLMRequest(task=task, prompt=prompt, system=system, payload=payload)
        )
        usage.add_llm(response.prompt_tokens, response.completion_tokens)
        return response

    def _mismatch_detail(
        self,
        query: str,
        evidence: list[EvidenceItem],
        decision: EvidenceGateDecision | None,
    ) -> str:
        docs = []
        try:
            docs = self.kb.store.list_documents()
        except Exception:
            docs = []
        titles = [doc.title or doc.name for doc in docs[:8] if (doc.title or doc.name)]
        if not titles:
            titles = list(dict.fromkeys(item.document_name for item in evidence if item.document_name))[:8]
        covered = ", ".join(titles) if titles else "the indexed files"
        rationale = (decision.rationale if decision else "") or ""
        return (
            f"Asked: {query.strip()}. Indexed sources cover: {covered}. {rationale}"
        ).strip()

    # -------------------------------------------------------------- wrap-up
    def _finalise(
        self,
        query_id: str,
        query: str,
        answer: str,
        status: AnswerStatus,
        evidence: list[EvidenceItem],
        decisions: list[EvidenceGateDecision],
        claims: list[Claim],
        contradictions: list[ContradictionPair],
        trace: TraceRecorder,
        usage: UsageCounter,
        t0: float,
        analysis: QueryAnalysis,
        rewritten: list[str],
        unrelated_to_sources: bool = False,
        mismatch_detail: str | None = None,
    ) -> PipelineResult:
        last_gate = decisions[-1] if decisions else None
        hallucination = detect_hallucinations(answer, claims, evidence)
        if self.config.hallucination_detection:
            blocked = (
                status is AnswerStatus.answered
                and hallucination.hallucination_detected
                and hallucination.severity in {"medium", "high"}
                and not (
                    claims
                    and all(c.status is ClaimStatus.supported for c in claims)
                    and hallucination.severity != "high"
                )
            )
            trace.add(
                "hallucination",
                "Hallucination check "
                + ("blocked" if blocked else "flagged" if hallucination.hallucination_detected else "clear"),
                status="warn" if hallucination.hallucination_detected else "ok",
                detail="; ".join(hallucination.flags) or None,
                metrics={"severity": hallucination.severity},
            )
            if blocked:
                answer = INSUFFICIENT_ANSWER
                status = AnswerStatus.insufficient_evidence
                trace.add(
                    "abstain",
                    "Hallucination check blocked an ungrounded answer",
                    status="warn",
                )
        confidence = score_confidence(
            evidence, claims, last_gate, contradictions, self.settings
        )
        if (
            status is AnswerStatus.answered
            and confidence.confidence < self.settings.abstain_confidence_threshold
        ):
            answer = INSUFFICIENT_ANSWER
            status = AnswerStatus.insufficient_evidence
            trace.add(
                "abstain",
                "Confidence below the refuse threshold",
                status="warn",
                detail=f"{confidence.confidence:.0%} < {self.settings.abstain_confidence_threshold:.0%}",
            )
        else:
            trace.add(
                "confidence",
                f"Confidence {confidence.confidence:.0%} "
                f"({confidence.claims_verified}/{confidence.claims_total} claims verified)",
                metrics={
                    "confidence": confidence.confidence,
                    "coverage": confidence.evidence_coverage,
                },
            )

        if status is AnswerStatus.answered:
            trace.add("final", "Final answer approved")
        elif status is AnswerStatus.conflicting_evidence:
            trace.add("final", "Final answer reports a source conflict", status="warn")
        elif unrelated_to_sources:
            trace.add("final", "Question does not match the indexed files", status="warn")
        else:
            trace.add("final", f"Final status: {status.value}", status="warn")

        latency_ms = (time.perf_counter() - t0) * 1000.0
        return build_result(
            query_id=query_id,
            pipeline=self.config.name,
            query=query,
            answer=answer,
            status=status,
            evidence=evidence,
            gate_decisions=decisions,
            claims=claims,
            contradictions=contradictions,
            confidence=confidence,
            hallucination=hallucination,
            trace=trace.events,
            metrics=usage.metrics(latency_ms),
            rewritten_queries=rewritten,
            config_snapshot={
                **self.config.snapshot(),
                "question_type": analysis.question_type,
                "llm": self.llm.describe(),
                "retriever": self.retriever.describe(),
            },
            unrelated_to_sources=unrelated_to_sources,
            mismatch_detail=mismatch_detail,
        )


def _llm_answer_text(response: LLMResponse) -> str:
    """Use structured answer when present, including empty drafts. Never JSON-dump."""

    structured = response.structured or {}
    if "answer" in structured:
        return str(structured.get("answer") or "")
    return (response.text or "").strip()
