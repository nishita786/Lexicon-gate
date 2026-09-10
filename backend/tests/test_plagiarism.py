"""Local originality / verbatim-overlap checks."""

from __future__ import annotations

from app.models.documents import Chunk, ChunkMetadata
from app.models.query import EvidenceItem
from app.verification.plagiarism import check_plagiarism


LONG_SOURCE = (
    "Dropout randomly disables units in a neural network during training so that "
    "hidden units cannot co-adapt and the model generalises better on unseen data."
)


def _chunk(doc: str, text: str) -> Chunk:
    return Chunk(
        chunk_id=f"{doc}::c0",
        text=text,
        metadata=ChunkMetadata(document_id=doc, document_name=doc, page=2),
    )


def _evidence(doc: str, text: str) -> EvidenceItem:
    return EvidenceItem(
        citation_id=1,
        chunk_id=f"{doc}::c0",
        document_id=doc,
        document_name=doc,
        page=2,
        text=text,
        title=doc,
    )


def test_paraphrase_is_high_originality(settings):
    answer = (
        "Regularisation helps by reducing the chance that neurons rely on each other, "
        "which often improves test accuracy in deep networks."
    )
    report = check_plagiarism(answer, [_evidence("handbook", LONG_SOURCE)], settings=settings)
    assert report.risk == "low"
    assert report.originality >= 0.85
    assert report.flagged_sentences == []


def test_uncited_library_copy_is_high_risk(settings):
    report = check_plagiarism(
        LONG_SOURCE,
        evidence=[],
        library_chunks=[_chunk("handbook", LONG_SOURCE)],
        settings=settings,
    )
    assert report.risk == "high"
    assert report.originality < 0.5
    assert report.matches
    assert report.matches[0].cited is False
    assert report.flagged_sentences
    hints = report.flagged_sentences[0].corrections
    assert any("Reword" in line for line in hints)
    assert any("handbook" in line.lower() for line in hints)


def test_cited_copy_is_not_uncited_risk(settings):
    report = check_plagiarism(
        LONG_SOURCE,
        evidence=[_evidence("handbook", LONG_SOURCE)],
        library_chunks=[_chunk("handbook", LONG_SOURCE)],
        settings=settings,
    )
    assert all(match.cited for match in report.matches)
    assert report.risk in {"low", "medium"}
    assert report.risk != "high"
    assert report.flagged_sentences


def test_uploaded_paper_spans_and_sections(settings, monkeypatch):
    from app.services.ingestion.loaders import LoadedPage
    from app.verification.plagiarism import score_uploaded_paper

    monkeypatch.setattr("app.verification.plagiarism.search_papers", lambda *a, **k: ([], "none"))
    text = (
        "# Methods\n\n"
        f"{LONG_SOURCE}\n\n"
        "# Notes\n\n"
        "This closing remark is my own wording about homework deadlines.\n"
    )
    report = score_uploaded_paper(
        "draft.md",
        [LoadedPage(page=1, text=text)],
        [_chunk("handbook", LONG_SOURCE)],
        settings=settings,
    )
    assert report.spans
    assert any(span.kind == "verbatim" for span in report.spans)
    assert any(span.kind == "original" for span in report.spans)
    assert report.sections
    titles = [row.title.lower() for row in report.sections]
    assert any("method" in title for title in titles)
