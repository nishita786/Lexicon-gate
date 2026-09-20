# Enhanced Self-RAG

Document Q&A that retrieves from **your** files, checks whether the evidence is strong enough, verifies each claim, and self-corrects before answering.

It will refuse when the sources cannot support a reliable answer. It does not fill gaps from model memory.

## What you get

1. **Ask** — default home: question your library with one verification badge, citations, and evidence; **New Chat** starts a blank session; **Recents** in the sidebar reopen past Ask chats and paper searches.
2. **Write** — draft freeform Markdown stories and **publish** them; anyone can read a public feed or open a shareable `#/s/{slug}` link (even when logged out).
3. **Find papers** — quick search with filters (**All**, **Academic Papers**, **Research Websites**, **Open Access**) across Semantic Scholar, OpenAlex, arXiv, and optional [Tavily](https://tavily.com) web search (`SELFRAG_TAVILY_API_KEY`). Add open-access PDFs (or honest abstract/page fallbacks) to your library.
4. **Library** — your sources (imported papers or uploaded files).
5. **Compare** — side-by-side structure across papers in your library.
6. **Events** — browse India and worldwide tech, IEEE, and research CFP events that are open to apply; apply on the official site.

There is no notebook and no pipeline picker. Evaluation stays in pytest for quality checks.

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

Open , then **sign up** (or log in). The Vite dev server proxies `/api` to http://127.0.0.1:8000. Accounts are stored locally in `backend/data/auth/` (not the paper library).

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

`/api/evaluate` and `/api/query/compare` remain for that harness. They are not part of the product UI. The four-system headline table (no-RAG, basic RAG, RAG+verify, full Enhanced Self-RAG) lives in evaluation, not Ask.

Labeled eval on **your** papers (empty gold until you fill it): `python eval/run_eval.py --dump-chunks` then edit `eval/test_set.json` and run `python eval/run_eval.py`. Citation precision and relevance stay pending manual review.

## Configuration

Thresholds live in `backend/app/config.py` and can be overridden with `SELFRAG_*` environment variables. See `.env.example`.

Optional hosted models (OpenAI, Ollama) plug in through the same provider interface. The default path is offline extractive generation.

## Limitations

- The bundled generator is extractive, not a large abstractive LM. Hosted providers can be swapped in without changing the loop.
- Confidence is a function of retrieved evidence, not a guarantee of truth.
- Page numbers for markdown are synthetic unless the file has page markers or is a PDF.
- Project invite tokens are shown once for legacy email invites and must be shared privately when used. Researcher-ID invites are accepted in-app without pasting a token. Tokens are stored hashed; they are never placed in page URLs.
- A Researcher ID identifies a user for collaboration lookup only — it is not a password or access grant.

Engineering notes: [Architecture](docs/architecture.md), [Methodology](docs/methodology.md), [Evaluation](docs/evaluatihttp://localhost:5173on.md), [API](docs/api.md).
