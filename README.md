# Lexicon Gate

Research desk that retrieves from **your** library, checks whether the evidence is strong enough, verifies each claim, and self-corrects before answering.

It will refuse when the sources cannot support a reliable answer. It does not fill gaps from model memory.

Under the hood this is an Enhanced Self-RAG loop (hybrid retrieval → evidence gate → claim verification).

## What you get

Nav order in the app: **Ask → Write → Find → Collaborators → Library → Compare → Events**.

1. **Ask** — default home: multi-turn chat over your library with a verification badge, citations, and evidence (shown when the answer is supported). **New Chat** starts a blank session; **Chats** in the sidebar lists past Ask threads (reopen or delete).
2. **Write** — draft **IEEE research-paper** sections (abstract through references), **download a Word (.docx)** file, or publish a public `#/s/{slug}` link.
3. **Find papers** — search with filters (**All**, **Academic Papers**, **Research Websites**, **Open Access**) across Semantic Scholar, OpenAlex, arXiv, and optional [Tavily](https://tavily.com) web search (`SELFRAG_TAVILY_API_KEY`). Add open-access PDFs (or honest abstract/page fallbacks) to your library.
4. **Collaborators** — share your **Researcher ID**, invite teammates (editor or viewer) onto IEEE papers, and open **shared workspaces**.
5. **Library** — your sources (imported papers or uploaded files).
6. **Compare** — side-by-side structure across papers in your library.
7. **Events** — browse India and worldwide tech, IEEE, and research CFP events that are open to apply; apply on the official site.

Sign-in: email/password, plus optional **Google** Identity Services when `SELFRAG_GOOGLE_CLIENT_ID` is set. An intro screen introduces Find → Library → Cite before the login form.

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

Open [http://localhost:5173](http://localhost:5173), then **sign up** (or log in / Google). The Vite dev server proxies `/api` to `http://127.0.0.1:8000`.

**Auth storage:** by default accounts and sessions live in `backend/data/auth/` (JSON). If both `SELFRAG_SUPABASE_URL` and `SELFRAG_SUPABASE_SERVICE_KEY` are set, users, sessions, and Write stories use Supabase instead — run `backend/supabase/schema.sql` in the Supabase SQL Editor first. Use the **service_role** key on the server only (never in the browser).

A new session starts with an **empty library**. Upload or Find sources, then Ask. If an older demo corpus is still indexed, remove those files in Library (or delete `backend/data` and restart).

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

Chunks are embedded (`SELFRAG_EMBEDDING_PROVIDER`, default `auto`) and stored in the configured vector store (`SELFRAG_VECTOR_STORE`, default `numpy`; optional `chroma` or `pinecone`).

## Tests (quality harness)

```bash
cd backend
.venv/bin/python -m pytest -q
```

`/api/evaluate` and `/api/query/compare` remain for that harness. They are not part of the product UI. The four-system headline table (no-RAG, basic RAG, RAG+verify, full Enhanced Self-RAG) lives in evaluation, not Ask.

Labeled eval on **your** papers (empty gold until you fill it): `python eval/run_eval.py --dump-chunks` then edit `eval/test_set.json` and run `python eval/run_eval.py`. Citation precision and relevance stay pending manual review.

## Configuration

Thresholds live in `backend/app/config.py` and can be overridden with `SELFRAG_*` environment variables. See `.env.example` for:

- LLM / embeddings / vector store (`auto`, `numpy`, …)
- OpenAI or Ollama (needed for long Write drafts)
- Google client ID, Supabase URL + service role
- Tavily, Semantic Scholar, Unpaywall, evidence-gate knobs

Optional hosted models plug in through the same provider interface. The default path is offline extractive generation.

## Limitations

- The bundled generator is extractive, not a large abstractive LM. Hosted providers can be swapped in without changing the loop.
- Confidence is a function of retrieved evidence, not a guarantee of truth.
- Page numbers for markdown are synthetic unless the file has page markers or is a PDF.
- Project invite tokens are shown once for legacy email invites and must be shared privately when used. Researcher-ID invites are accepted in-app without pasting a token. Tokens are stored hashed; they are never placed in page URLs.
- A Researcher ID identifies a user for collaboration lookup only — it is not a password or access grant.

Engineering notes: [Architecture](docs/architecture.md), [Methodology](docs/methodology.md), [Evaluation](docs/evaluation.md), [API](docs/api.md).
