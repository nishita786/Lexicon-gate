"""End-to-end pipeline behaviour on the demo corpus."""

from __future__ import annotations

from app.generation.prompts import INSUFFICIENT_ANSWER, UNRELATED_ANSWER
from app.models.query import AnswerStatus, Claim, ClaimStatus, PipelineName
from app.pipelines.common import TraceRecorder, drop_unsupported_sentences
from app.pipelines.runner import PipelineRunner, enhanced_config, self_rag_config, traditional_config


def test_traditional_rag_answers_unanswerable_question(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, traditional_config())
    result = runner.run("How does dropout affect Titan's nitrogen atmosphere?")
    assert result.pipeline is PipelineName.traditional
    assert result.abstained is False
    assert result.answer
    assert result.answer != INSUFFICIENT_ANSWER
    assert result.metrics.retrieval_attempts == 1


def test_enhanced_abstains_when_evidence_is_missing(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, enhanced_config())
    result = runner.run("How does dropout affect Titan's nitrogen atmosphere?")
    assert result.abstained is True
    assert result.status is AnswerStatus.insufficient_evidence
    assert result.unrelated_to_sources is True
    assert UNRELATED_ANSWER in result.answer or INSUFFICIENT_ANSWER in result.answer
    assert result.mismatch_detail


def test_enhanced_answers_supported_question_with_citations(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, enhanced_config())
    result = runner.run("What is the main advantage of dropout?")
    assert result.abstained is False
    assert "overfitting" in result.answer.lower()
    assert result.evidence
    assert "[" in result.answer
    assert result.confidence.confidence > 0.4
    assert result.trace
    assert result.unrelated_to_sources is False
    assert result.claims
    assert any(claim.status is ClaimStatus.supported for claim in result.claims)


def test_enhanced_detects_dropout_conflict(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, enhanced_config())
    result = runner.run("Does dropout reduce overfitting?")
    assert result.contradictions or result.status is AnswerStatus.conflicting_evidence


def test_self_rag_can_skip_retrieval_for_greeting(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, self_rag_config())
    result = runner.run("hello")
    assert result.status is AnswerStatus.no_retrieval_needed
    assert result.metrics.retrieval_calls == 0


def test_compare_three_systems_same_question(demo_kb, llm):
    query = "What is the main advantage of the proposed architecture?"
    results = {
        name: PipelineRunner(demo_kb, llm, cfg()).run(query)
        for name, cfg in (
            ("traditional", traditional_config),
            ("self_rag", self_rag_config),
            ("enhanced", enhanced_config),
        )
    }
    assert all(r.answer for r in results.values())
    enhanced = results["enhanced"]
    assert "sufficient" in enhanced.answer.lower() or "verif" in enhanced.answer.lower() or "claim" in enhanced.answer.lower() or "evidence" in enhanced.answer.lower()


def test_drop_unsupported_sentences_keeps_supported_only():
    good = [
        Claim(claim_id="1", text="Dropout reduces overfitting.", status=ClaimStatus.supported),
    ]
    bad = [
        Claim(claim_id="2", text="Titan has a nitrogen atmosphere.", status=ClaimStatus.unsupported),
    ]
    answer = "Dropout reduces overfitting [1]. Titan has a nitrogen atmosphere [2]."
    stripped, kept = drop_unsupported_sentences(answer, good, bad)
    assert "overfitting" in stripped.lower()
    assert "titan" not in stripped.lower()
    assert kept == good


def test_enhanced_answered_has_no_red_claims(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, enhanced_config())
    result = runner.run("What is the main advantage of dropout?")
    if result.status is AnswerStatus.answered:
        assert all(claim.status is ClaimStatus.supported for claim in result.claims)


def test_partial_claims_do_not_produce_answered(demo_kb, llm):
    runner = PipelineRunner(demo_kb, llm, enhanced_config())
    answer, status, claims = runner._enforce_supported_answer(
        "Dropout might reduce overfitting in some settings.",
        AnswerStatus.answered,
        [
            Claim(
                claim_id="c1",
                text="Dropout might reduce overfitting in some settings.",
                status=ClaimStatus.partially_supported,
            )
        ],
        TraceRecorder(),
    )
    assert status is AnswerStatus.insufficient_evidence
    assert INSUFFICIENT_ANSWER in answer
    assert claims
