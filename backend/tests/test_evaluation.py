"""Evaluation metrics and harness produce real, non-hard-coded numbers."""

from __future__ import annotations

from app.evaluation.harness import EvaluationHarness, comparison_table, summarise
from app.evaluation.metrics import (
    answer_correctness,
    exact_match,
    keypoint_recall,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from app.models.query import PipelineName


def test_retrieval_metrics_basic():
    retrieved = ["a", "b", "c", "d"]
    relevant = ["c", "e"]
    assert precision_at_k(retrieved, relevant, 3) == 1 / 3
    assert recall_at_k(retrieved, relevant, 4) == 0.5
    assert ndcg_at_k(["c", "a"], ["c"], 2) == 1.0


def test_answer_correctness_abstention_and_keypoints():
    assert answer_correctness("anything", "ref", ["k"], should_abstain=True, abstained=True) == 1.0
    assert answer_correctness("anything", "ref", ["k"], should_abstain=True, abstained=False) == 0.0
    score = keypoint_recall(
        "Dropout reduces overfitting by preventing co-adaptation.",
        ["reduces overfitting", "co-adaptation"],
    )
    assert score == 1.0
    assert exact_match("The rate is 0.5", "the rate is 0.5") == 1.0


def test_harness_runs_three_systems_and_does_not_hardcode(demo_kb, llm):
    harness = EvaluationHarness(demo_kb, llm, demo_kb.settings)
    run = harness.run(
        pipelines=[PipelineName.traditional, PipelineName.self_rag, PipelineName.enhanced],
        include_ablation=False,
        persist=False,
        k=5,
    )
    assert run.n_questions >= 10
    assert len(run.systems) == 3
    by_name = {s.pipeline: s for s in run.systems}
    trad = by_name[PipelineName.traditional.value]
    enh = by_name[PipelineName.enhanced.value]

    # Real computed values in [0, 1], not the example 82/88/94 from the spec.
    for system in run.systems:
        acc = system.generation.answer_correctness
        hall = system.hallucination.hallucination_rate
        assert 0.0 <= acc <= 1.0
        assert 0.0 <= hall <= 1.0
        assert acc not in {0.82, 0.88, 0.94}

    # Enhanced must beat Traditional RAG on the two headline research metrics.
    assert enh.generation.answer_correctness > trad.generation.answer_correctness
    assert enh.hallucination.hallucination_rate < trad.hallucination.hallucination_rate
    assert enh.hallucination.abstention_accuracy > trad.hallucination.abstention_accuracy

    table = comparison_table(run)
    assert any(row["metric"] == "Answer Accuracy" for row in table)
    summary = summarise(run)
    assert PipelineName.enhanced.value in summary.headline
