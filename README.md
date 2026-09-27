# Lexicon Gate

Research desk that retrieves from your library, checks whether the evidence is strong enough, verifies each claim, and self-corrects before answering. When the sources cannot support a reliable answer, it refuses. It does not fill gaps from model memory.

Under the hood this is an Enhanced Self-RAG loop: hybrid retrieval, an evidence gate, then claim verification.

## What you can do

The app nav is **Ask → Write → Find papers → Collaborators → Library → Compare → Events**.

| Section | What it does |
| --- | --- |
| **Ask** | Chat over your library. Answers include a verification badge, citations, and the evidence used. **New Chat** starts a blank session. **Chats** in the sidebar reopens or deletes past Ask threads. |
| **Write** | Draft an IEEE paper section by section (abstract through references), download a Word `.docx`, or publish a public link at `#/s/{slug}`. |
| **Find papers** | Search **All**, **Academic Papers**, **Research Websites**, or **Open Access** across Semantic Scholar, OpenAlex, arXiv, and optional [Tavily](https://tavily.com) web search. Add an open-access PDF, or the abstract when no PDF is available, into your library. |
| **Collaborators** | Invite someone onto a Write paper by **Researcher ID** (`LG-XXXX-XXXX`) or a unique display name. They accept in the app, edit, and press **Close work** when they are finished. The same history stays for the inviter and the invitee. Either person can delete a history line. The owner can also delete a pending invite or a collaborator. |
| **Library** | Your sources. **Upload files** opens one dialog where you can select several PDF, TXT, Markdown, or DOCX files (up to 20) and upload them together. |
| **Compare** | Side-by-side structure across papers already in your library. |
| **Events** | India and worldwide tech, IEEE, and research calls that are open to apply. Applications go to the official site. |

Sign-in is email and password. Google sign-in appears when `SELFRAG_GOOGLE_CLIENT_ID` is set. A short intro (Find, Library, Cite) plays before the login form.

A new account starts with an empty library. Upload files or use Find papers, then Ask.

## Requirements

- Python 3.10 or newer
- Node.js 20 or newer, and npm
- Two terminals: one for the API, one for the UI

The default answer path runs offline. OpenAI or Ollama is only needed for long Write drafts. Google and Supabase are optional.

## Run it locally

From the repository root:

```bash
cp .env.example .env
```

Leave `.env` as copied if you only want the offline path. Fill in keys only for the features in [Configuration](#configuration). `.env` is gitignored. Do not commit it.

**API** (terminal 1):

```bash
cd backend
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --app-dir . --host 127.0.0.1 --port 8000
```

On Windows, create the venv with `py -3.10 -m venv .venv` and activate it with `.venv\Scripts\activate`.

Optional claim-verification models (downloads weights on first use):

```bash
pip install -r requirements-nli.txt
```

**UI** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign up. The Vite dev server proxies `/api` to `http://127.0.0.1:8000`. If the page says it cannot reach the server, the API on port 8000 is not running.

Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health). Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## Where data lives

| Data | Default | With Supabase |
| --- | --- | --- |
| Accounts, sessions, Researcher IDs | `backend/data/auth/` | `app_users`, `app_sessions` |
| Write papers, invites, collaborator history | `backend/data/` story files | `app_stories` |
| Library uploads and the search index | `backend/data/uploads/` and `backend/data/index/` | still on this machine |

Supabase is used only when **both** `SELFRAG_SUPABASE_URL` and `SELFRAG_SUPABASE_SERVICE_KEY` are set. The library index stays local either way. Two people collaborating on a Write paper share that paper, not each other's Ask library.

## Collaborators

1. Sign up. Your Researcher ID is on the Collaborators home screen. Copy it and send it to the other person.
2. Open the paper under **Papers**, type their Researcher ID or their exact display name, and press **Invite**. If several accounts share that name, the app asks for the Researcher ID.
3. They open **Invites**, press **Accept**, and edit in **Write**.
4. When they are finished they press **Close work**. Both accounts keep a history line that they finished and closed it.
5. **Delete** on a history line removes that line for both people. Deleting the close note does not reopen the paper. **Delete** on a person removes them from the paper. **Delete** on a pending invite cancels it.

Invites stay inside the app. There is no email for this flow.

## Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**.
2. Under **Authorized JavaScript origins**, add `http://localhost:5173` and `http://127.0.0.1:5173`.
3. If the consent screen is in **Testing**, add every Gmail address that should sign in as a test user. Otherwise Google shows “Access blocked”.
4. Put the client ID in `.env`:

```bash
SELFRAG_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Restart the API after changing `.env`.

## Supabase

Use this when accounts and Write papers should live in Postgres instead of local JSON.

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run [`backend/supabase/schema.sql`](backend/supabase/schema.sql). That creates `app_users`, `app_sessions`, and `app_stories`, with row level security enabled. The API uses the service role and bypasses those policies. Do not add an anon key to the browser.
3. In Project Settings → API, copy the project URL and the **service_role** secret. Put them only in `.env`:

```bash
SELFRAG_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SELFRAG_SUPABASE_SERVICE_KEY=your-service-role-secret
```

Restart the API. Existing local JSON accounts are not copied over.

## Configuration

Settings load from the repository-root `.env` (and `backend/.env` if you create one). Names use the `SELFRAG_` prefix. Defaults live in `backend/app/config.py`. A full template is [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `SELFRAG_LLM_PROVIDER` | `auto` (default). Uses OpenAI or Ollama when configured, otherwise the offline extractive writer. |
| `SELFRAG_EMBEDDING_PROVIDER` | `auto` (default). |
| `SELFRAG_VECTOR_STORE` | `numpy` (default). Optional: `chroma` or `pinecone`. |
| `SELFRAG_OPENAI_API_KEY` | Optional. Needed for long IEEE drafts when Ollama is not running. |
| `SELFRAG_OLLAMA_BASE_URL` | Optional local model for long drafts. Default `http://localhost:11434`. |
| `SELFRAG_GOOGLE_CLIENT_ID` | Shows the Google button. See [Google sign-in](#google-sign-in). |
| `SELFRAG_SUPABASE_URL` | Optional Postgres. Must be paired with the service role key. |
| `SELFRAG_SUPABASE_SERVICE_KEY` | Server-only Supabase **service_role** secret. Never put this in frontend code. |
| `SELFRAG_TAVILY_API_KEY` | Optional web results on Find papers. |
| `SELFRAG_SEMANTIC_SCHOLAR_API_KEY` | Optional higher Semantic Scholar rate limit. |
| `SELFRAG_UNPAYWALL_EMAIL` | Contact email sent when locating legal open-access PDFs. |
| `SELFRAG_AUTH_REQUIRED` | `true` in the product. Tests turn it off. |
| `SELFRAG_CORS_ORIGINS` | Defaults to `http://localhost:5173` and `http://127.0.0.1:5173`. |

Evidence-gate knobs (`SELFRAG_EVIDENCE_THRESHOLD`, top-k, retrieval attempts, correction loops) are listed in `.env.example`.

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

Chunks are embedded and stored in the vector store from `SELFRAG_VECTOR_STORE` (NumPy unless you change it).

## Tests

```bash
cd backend
.venv/bin/python -m pytest -q
```

The test suite uses a temporary data directory and does not write to Supabase, even if your `.env` has Supabase keys.

`/api/evaluate` and `/api/query/compare` exist for that harness. They are not product screens.

To score the system on your own papers, from the repository root:

```bash
python eval/run_eval.py --dump-chunks
```

Edit `eval/test_set.json`, then run `python eval/run_eval.py` again. Citation precision and relevance still need a manual pass.

## Limitations

- The default generator is extractive. OpenAI or Ollama can be plugged in for long Write drafts without changing the retrieval loop.
- Confidence reflects the retrieved evidence. It is not a guarantee that a claim is true.
- Page numbers on Markdown are synthetic unless the file has page markers or is a PDF.
- A Researcher ID is only a lookup handle for invites. It is not a password.
- On macOS, the upload dialog selects a range with Shift and individual files with Command.

## Further reading

- [Architecture](docs/architecture.md)
- [Methodology](docs/methodology.md)
- [Evaluation](docs/evaluation.md)
- [API](docs/api.md)
