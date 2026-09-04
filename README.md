# Enhanced Self-RAG

Document Q&A that retrieves from **your** files, checks whether the evidence is strong enough, verifies each claim, and self-corrects before answering.

It will refuse when the sources cannot support a reliable answer. It does not fill gaps from model memory.

## What you get

1. **Find papers** — search Semantic Scholar (OpenAlex fallback) and add a paper to your library.
2. **Library** — your sources (imported papers or uploaded files).
3. **Ask** — one Enhanced Self-RAG answer with citations, claim labels, confidence, and Copy APA / BibTeX.

There is no notebook, no pipeline picker, and no research comparison screen. Evaluation stays in pytest for quality checks.

## How to run

```bash
# backend
cd backend
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env          # optional; works with no API keys
uvicorn app.main:app --reload --app-dir .

# frontend (another terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to http://127.0.0.1:8000.

A new session starts with an **empty library**. Upload sources, then ask. If an older research demo is still indexed, remove those files in Library (or delete `backend/data` and restart).

## How an answer is produced

```
Question
  → hybrid retrieval (dense + BM25)
  → evidence gate (retrieve deeper, rewrite, or abstain)
  → draft
  → claim verification
  → self-correct until claims are supported, or refuse
  → answer + citations + confidence
```

## Tests (quality harness)

```bash
cd backend
.venv/bin/python -m pytest -q
```

`/api/evaluate` and `/api/query/compare` remain for that harness. They are not part of the product UI.

## Configuration

Thresholds live in `backend/app/config.py` and can be overridden with `SELFRAG_*` environment variables. See `.env.example`.

Optional hosted models (OpenAI, Ollama) plug in through the same provider interface. The default path is offline extractive generation.

## Limitations

- The bundled generator is extractive, not a large abstractive LM. Hosted providers can be swapped in without changing the loop.
- Confidence is a function of retrieved evidence, not a guarantee of truth.
- Page numbers for markdown are synthetic unless the file has page markers or is a PDF.

Engineering notes: [Architecture](docs/architecture.md), [Methodology](docs/methodology.md), [Evaluation](docs/evaluation.md), [API](docs/api.md).
