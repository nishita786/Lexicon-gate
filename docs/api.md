# HTTP API

Base URL: `http://127.0.0.1:8000/api`  
OpenAPI: `http://127.0.0.1:8000/docs`

All successful bodies are JSON. Errors use FastAPI's `{ "detail": ... }` shape. The frontend never receives provider API keys.

## System

### `GET /health`

Liveness plus which LLM / embedding / vector-store providers are active and which are available.

### `GET /config`

Public runtime knobs (thresholds, k, loop caps). No secrets.

## Documents

### `POST /documents/upload`

`multipart/form-data` field `files`. Parses, chunks, embeds, rebuilds BM25.

### `GET /documents`

Indexed documents, chunk counts, active providers.

### `GET /documents/clusters`

Theme groups of library papers (agglomerative cosine clustering of document embeddings). Each cluster has a label, keywords, and `document_ids` for scoped Ask.

### `DELETE /documents/{document_id}`

### `POST /documents/demo`

Reload the bundled research corpus. Used by pytest and `/evaluate`, not by the product UI.

## Plagiarism

### `POST /plagiarism/check`

`multipart/form-data` field `file` (PDF, docx, txt, md, html). Parses the upload without ingesting it, then scores n-gram overlap against Library chunks and against Semantic Scholar / OpenAlex / Crossref **title + abstract** hits. Close wording (token Jaccard) is marked paraphrased. Returns similarity, originality, sources, color-coded `spans`, per-section originality, and flagged sentences with corrections. Empty library → `library_empty: true`; similarity can still be > 0 from abstracts.

## Query

Product Ask always runs **Enhanced Self-RAG**. `pipeline` on `/query` is ignored if sent.

### `POST /query`

```json
{
  "query": "What is the main advantage of dropout?",
  "top_k": 5,
  "document_ids": null,
  "evidence_threshold": null,
  "include_trace": true
}
```

Response is a `PipelineResult`: answer, status, evidence[], claims[], contradictions[], confidence, hallucination, trace[], metrics.

### `GET /query/history/{id}`

Full saved result for a recent question (in-memory session history).

### `POST /query/compare`

Harness-only: runs selected pipelines on one question.

### `GET /query/{id}/trace`

Structured system events for a recent query.

### `GET /query/recent`

## Evaluation (harness, not the product UI)

### `POST /evaluate`

```json
{
  "pipelines": ["traditional_rag", "self_rag", "enhanced_self_rag"],
  "include_ablation": true,
  "limit": null,
  "categories": null,
  "k": 5,
  "persist": true
}
```

Returns a full `EvaluationRun` (several seconds on the demo set).

### `GET /evaluation/results`

Latest persisted run, headline table, and per-metric comparison rows for the dashboard.

### `GET /evaluation/runs`

### `GET /evaluation/benchmark`

Gold questions.

### `GET /evaluation/demo-cases`

Curated questions for a live demo.
