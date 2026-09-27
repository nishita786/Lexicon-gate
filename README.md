# 🧠 Lexicon Gate

<p align="center"><strong>Evidence-grounded AI for serious research.</strong></p>
<p align="center"><i>Ask better questions. Find better evidence. Write with confidence.</i></p>

<p align="center">

![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-RAG-1C3C3C?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Supabase-Optional-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)

</p>

<p align="center">🔎 Research • 🤖 Self-RAG • 📚 Paper Intelligence • ✍️ Academic Writing • 👥 Collaboration</p>

---

## ✦ What is Lexicon Gate?

**Lexicon Gate** is an AI-powered research workspace built around one core idea:

> **AI should not answer just because it can generate an answer. It should answer when the available evidence supports it.**

Lexicon Gate combines **hybrid retrieval, evidence gating, claim verification, adaptive retrieval, contradiction checking, and self-correction** into an Enhanced Self-RAG workflow.

Instead of treating an LLM as the source of truth, the system treats the user's research library as the primary evidence layer.

### The research loop

~~~
Question
   ↓
Retrieve Evidence
   ↓
Check Evidence
   ↓
Generate Draft
   ↓
Verify Claims
   ↓
Retrieve More if Needed
   ↓
Self-Correct
   ↓
Answer with Citations
~~~

---

# 🚀 Why Lexicon Gate?

A typical research workflow is fragmented:

~~~
Find Papers → Download PDFs → Read & Search → Take Notes
→ Ask an AI → Verify Sources → Compare Papers → Write
~~~

Lexicon Gate brings these activities into one research-focused workspace:

~~~
                     LEXICON GATE
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
     ASK                DISCOVER             WRITE
       │                   │                   │
       ▼                   ▼                   ▼
   Self-RAG           Find Papers        Research Drafts
   Verification       Open Access       IEEE Structure
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
                    RESEARCH LIBRARY
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           Compare    Collaborate    Verify
~~~

---

# 🧭 Product Navigation

**Ask → Write → Find Papers → Collaborators → Library → Compare → Events**

| Section | What it does |
| --- | --- |
| 🤖 **Ask** | Chat over your research library with citations, evidence, verification, and confidence information. |
| ✍️ **Write** | Draft an IEEE-style paper section by section, export to Word, and publish a public link. |
| 🔎 **Find Papers** | Search Semantic Scholar, OpenAlex, arXiv, and optional Tavily web results. |
| 👥 **Collaborators** | Invite researchers using Researcher IDs or display names and collaborate on Write papers. |
| 📚 **Library** | Upload and manage PDF, TXT, Markdown, and DOCX research sources. |
| 📊 **Compare** | Compare papers already present in your library using structured research information. |
| 📅 **Events** | Discover India and worldwide technology, IEEE, and research calls that are open to apply. |

---

# 🤖 01 — Ask

The **Ask** workspace is the core AI research experience.

### What Ask provides

- Multi-turn conversations
- Persistent Ask chats
- New Chat sessions
- Source-scoped retrieval
- Citations
- Retrieved evidence
- Verification status
- Claim-level checking
- Confidence information
- Self-correction
- Evidence-based abstention

### Ask workflow

~~~
User Question
      ↓
Query Analysis
      ↓
Hybrid Retrieval
      ↓
Evidence Gate
      ↓
Grounded Draft
      ↓
Claim Extraction
      ↓
Claim Verification
      ↓
Contradiction Detection
      ↓
Evidence Expansion
      ↓
Self-Correction
      ↓
Final Answer + Citations
~~~

---

# 🧠 02 — Enhanced Self-RAG

A basic RAG system commonly follows:

~~~
Question → Retrieve → Generate
~~~

Lexicon Gate adds multiple reliability checks:

~~~
Question
   ↓
Retrieve
   ↓
Evaluate Evidence
   ↓
Generate
   ↓
Extract Claims
   ↓
Verify Claims
   ↓
Detect Contradictions
   ↓
Expand Evidence
   ↓
Correct Response
   ↓
Final Answer
~~~

### Pipeline stages

- 🔎 **Query Analysis** — understands the research question before retrieval.
- ⚡ **Hybrid Retrieval** — combines semantic retrieval with BM25 keyword retrieval.
- 🚪 **Evidence Gate** — checks whether retrieved evidence is strong enough.
- 🔄 **Adaptive Retrieval** — retrieves deeper when the first pass is insufficient.
- ✏️ **Query Rewriting** — reformulates difficult queries to improve retrieval.
- 🧾 **Claim Extraction** — decomposes generated responses into checkable claims.
- ✅ **Claim Verification** — compares claims against retrieved evidence.
- ⚠️ **Contradiction Detection** — identifies potential conflicts.
- 🔎 **Claim-Driven Evidence Expansion** — retrieves additional evidence for unsupported claims.
- ♻️ **Self-Correction** — regenerates when verification finds unsupported content.
- 🛑 **Abstention** — avoids confidently answering when evidence remains insufficient.

---

# 🔍 03 — Hybrid Retrieval

Lexicon Gate uses more than one retrieval strategy.

### Dense Retrieval

Finds passages that are semantically related even when wording differs.

### BM25 Retrieval

Provides keyword-oriented retrieval for:

- Technical terms
- Dataset names
- Algorithms
- Specific entities
- Exact terminology

### Reciprocal Rank Fusion

~~~
Dense Retrieval + BM25 Retrieval
             ↓
Reciprocal Rank Fusion
             ↓
Unified Ranked Evidence
~~~

---

# 📚 04 — Research Library

The Library is the knowledge base used by the Ask and research workflows.

### Supported uploads

- PDF
- TXT
- Markdown
- DOCX

Up to **20 files** can be selected in one upload action.

### Document ingestion

~~~
Upload
  ↓
Text Extraction
  ↓
Cleaning
  ↓
Chunking
  ↓
Embeddings
  ↓
Indexing
  ↓
Metadata
  ↓
Retrieval
~~~

Structured research information can include:

~~~
Research Paper
 ├── Objective
 ├── Method
 ├── Dataset
 ├── Metrics
 ├── Results
 └── Limitations
~~~

---

# 🔎 05 — Find Papers

Lexicon Gate includes a dedicated paper-discovery workflow.

### Sources

- Semantic Scholar
- OpenAlex
- arXiv
- Tavily — optional web search
- Unpaywall — open-access discovery

### Search categories

- All
- Academic Papers
- Research Websites
- Open Access

### Discovery workflow

~~~
Research Topic
      ↓
Multi-source Search
      ↓
Paper Results
      ↓
Metadata
      ↓
Open-access Detection
      ↓
Add to Library
      ↓
Ask / Compare / Write
~~~

---

# 📊 06 — Compare

The **Compare** workspace provides side-by-side structure across papers already in the Library.

| Dimension | What is compared |
| --- | --- |
| 🎯 Objective | Problem or research objective |
| 🧪 Method | Methodology or approach |
| 🗂️ Dataset | Dataset used |
| 📏 Metrics | Evaluation metrics |
| 📈 Results | Reported outcomes |
| ⚠️ Limitations | Identified limitations |

---

# ✍️ 07 — Write

The **Write** workspace provides an academic writing flow centered around IEEE-style research papers.

### Paper structure

~~~
Abstract
   ↓
Introduction
   ↓
Related Work
   ↓
Methodology
   ↓
Results
   ↓
Discussion
   ↓
Conclusion
   ↓
References
~~~

### Write capabilities

- Section-by-section drafting
- Editing
- Preview
- Save
- Publish
- Public research links
- Word .docx export

The default answer path can operate offline. OpenAI or Ollama can be configured for longer Write drafts.

---

# 👥 08 — Collaborators

Lexicon Gate includes collaboration directly inside the research workflow.

### Researcher identity

Researcher IDs use the format:

~~~
LG-XXXX-XXXX
~~~

### Collaboration flow

~~~
Researcher A
     ↓
Invite by Researcher ID / Name
     ↓
Researcher B
     ↓
Accept Invitation
     ↓
Edit Paper
     ↓
Close Work
     ↓
Shared Collaboration History
~~~

### Collaboration capabilities

- Invitations
- Accept / reject
- Shared Write papers
- Owner access
- Editor access
- Viewer access
- Closing work
- Collaboration history
- Removing collaborators
- Cancelling pending invitations

> Collaborators share the paper they are working on. They do **not** automatically share each other's Ask libraries.

---

# 📅 09 — Events

The Events section brings research opportunities into the same workspace.

It can surface:

- Technology events
- IEEE events
- Research calls
- CFPs
- Events in India
- Worldwide research opportunities

Applications are directed to the official event website.

---

# 🏗️ System Architecture

~~~
┌────────────────────────────────────────────────────────────┐
│                         FRONTEND                           │
│                       React + Vite                         │
│                                                            │
│ Ask │ Write │ Find Papers │ Collaborators │ Library       │
│ Compare │ Events                                           │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                      FASTAPI BACKEND                       │
│                                                            │
│ Auth │ Chat │ Documents │ Papers │ Projects │ Research     │
└────────────────────────────┬───────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌─────────────┐ ┌──────────────┐
       │ Enhanced   │ │ Retrieval   │ │ Research &   │
       │ Self-RAG   │ │ Services    │ │ Writing APIs │
       └─────┬──────┘ └──────┬──────┘ └──────────────┘
             │               │
             ▼               ▼
      ┌─────────────┐ ┌──────────────┐
      │ Evidence &  │ │ Dense + BM25 │
      │ Verification│ │ + RRF        │
      └──────┬──────┘ └──────────────┘
             │
             ▼
      ┌─────────────────────────────┐
      │ LLM / Embedding Layer       │
      │ OpenAI / Ollama / Offline   │
      └──────────────┬──────────────┘
                     ▼
             Grounded Response
~~~

---

# 🛠️ Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 |
| Build Tool | Vite 7 |
| Backend | Python 3.10+, FastAPI, Uvicorn |
| AI Orchestration | LangChain |
| LLM Providers | OpenAI, Ollama, Google |
| Embeddings | Sentence Transformers |
| Embedding Model | all-MiniLM-L6-v2 |
| Retrieval | Dense Retrieval, BM25, RRF |
| Default Vector Store | NumPy |
| Optional Vector Stores | Chroma, Pinecone |
| Database | Local data + optional Supabase PostgreSQL |
| Authentication | Email/Password + optional Google OAuth |
| Academic Search | Semantic Scholar, OpenAlex, arXiv |
| Web Search | Optional Tavily |
| Open Access | Unpaywall |
| Document Processing | pypdf, python-docx |
| Testing | Pytest |
| Version Control | Git + GitHub |

---

# 📂 Project Structure

~~~
Lexicon-gate/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── services/
│   │   ├── pipelines/
│   │   ├── models/
│   │   ├── config.py
│   │   └── main.py
│   │
│   ├── data/
│   │   ├── auth/
│   │   ├── uploads/
│   │   └── index/
│   │
│   ├── supabase/
│   │   └── schema.sql
│   │
│   ├── tests/
│   ├── requirements.txt
│   ├── requirements-nli.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── main.jsx
│   │
│   ├── package.json
│   └── vite.config.*
│
├── eval/
│   ├── run_eval.py
│   └── test_set.json
│
├── docs/
│   ├── architecture.md
│   ├── methodology.md
│   ├── evaluation.md
│   └── api.md
│
├── .env.example
└── README.md
~~~

---

# ⚙️ Requirements

- Python 3.10+
- Node.js 20+
- npm
- Two terminals

The default answer path can run offline.

Optional services:

- OpenAI — longer Write drafts
- Ollama — local long-form generation
- Google — Google sign-in
- Supabase — hosted account/session/paper persistence
- Tavily — web results in Find Papers
- Semantic Scholar API key — higher API rate limits
- Pinecone / Chroma — optional vector-store alternatives

---

# 💻 Local Installation

## 1. Clone

~~~bash
git clone https://github.com/nishita786/Lexicon-gate.git
cd Lexicon-gate
~~~

## 2. Configure environment

~~~bash
cp .env.example .env
~~~

## 3. Start the Backend

Terminal 1:

~~~bash
cd backend
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --app-dir . --host 127.0.0.1 --port 8000
~~~

Windows:

~~~bash
py -3.10 -m venv .venv
.venv\Scripts\activate
~~~

Optional claim-verification models:

~~~bash
pip install -r requirements-nli.txt
~~~

## 4. Start the Frontend

Terminal 2:

~~~bash
cd frontend
npm install
npm run dev
~~~

Open:

~~~
http://localhost:5173
~~~

---

# ❤️ Health Check & API Docs

### Health

~~~
http://127.0.0.1:8000/health
~~~

### Interactive API documentation

~~~
http://127.0.0.1:8000/docs
~~~

---

# 🔐 Configuration

Configuration is loaded from the repository-root .env.

| Variable | Purpose |
| --- | --- |
| SELFRAG_LLM_PROVIDER | auto by default; selects configured OpenAI/Ollama or offline generation. |
| SELFRAG_EMBEDDING_PROVIDER | Controls the embedding provider. |
| SELFRAG_VECTOR_STORE | numpy by default; can use chroma or pinecone. |
| SELFRAG_OPENAI_API_KEY | Optional key for long Write drafts. |
| SELFRAG_OLLAMA_BASE_URL | Optional local Ollama endpoint. |
| SELFRAG_GOOGLE_CLIENT_ID | Enables Google sign-in. |
| SELFRAG_SUPABASE_URL | Optional Supabase project URL. |
| SELFRAG_SUPABASE_SERVICE_KEY | Server-only Supabase service-role secret. |
| SELFRAG_TAVILY_API_KEY | Optional web search for Find Papers. |
| SELFRAG_SEMANTIC_SCHOLAR_API_KEY | Optional higher Semantic Scholar rate limit. |
| SELFRAG_UNPAYWALL_EMAIL | Contact email for open-access PDF lookup. |
| SELFRAG_AUTH_REQUIRED | Authentication requirement. |
| SELFRAG_CORS_ORIGINS | Allowed frontend origins. |

Evidence-gate thresholds, retrieval limits, top-k settings, retrieval attempts, and correction loops are documented in .env.example.

---

# 🔑 Google Sign-In

Google authentication is optional.

1. Create a Web application OAuth client in Google Cloud Console.
2. Add these authorized JavaScript origins:

~~~
http://localhost:5173
http://127.0.0.1:5173
~~~

3. If the OAuth consent screen is in Testing, add the required test users.
4. Add the client ID:

~~~bash
SELFRAG_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
~~~

5. Restart the backend.

---

# 🗄️ Data Storage

Lexicon Gate uses a local-first architecture.

| Data | Default | With Supabase |
| --- | --- | --- |
| Accounts | backend/data/auth/ | app_users |
| Sessions | backend/data/auth/ | app_sessions |
| Write papers | backend/data/ story files | app_stories |
| Collaborator history | Local story data | app_stories |
| Library uploads | backend/data/uploads/ | Local |
| Search index | backend/data/index/ | Local |

Supabase is used only when both are configured:

~~~bash
SELFRAG_SUPABASE_URL=
SELFRAG_SUPABASE_SERVICE_KEY=
~~~

The Library index remains local.

---

# 🧪 Testing & Evaluation

Run the backend tests:

~~~bash
cd backend
.venv/bin/python -m pytest -q
~~~

The evaluation helper can dump indexed chunks:

~~~bash
python eval/run_eval.py --dump-chunks
~~~

Evaluation data is maintained in:

~~~
eval/test_set.json
~~~

The repository also exposes /api/evaluate and /api/query/compare for the evaluation harness. These are not product screens.

---

# 🧠 How an Answer is Produced

~~~
Question
   │
   ▼
Hybrid Retrieval
(Dense + BM25)
   │
   ▼
Evidence Gate
   │
   ├── Retrieve Deeper
   ├── Rewrite Query
   └── Abstain if Needed
   │
   ▼
Draft
   │
   ▼
Claim Verification
   │
   ▼
Self-Correction
   │
   ▼
Supported Answer
   │
   ▼
Citations + Confidence
~~~

---

# 🔒 Security & Reliability

### Application security

- Email/password authentication
- Optional Google OAuth
- Session management
- Environment-based secrets
- Server-side Supabase service-role access
- CORS configuration
- .env excluded from version control

### AI reliability

- Evidence gate
- Hybrid retrieval
- Claim verification
- Contradiction detection
- Adaptive retrieval
- Self-correction
- Evidence-based abstention

> **Security protects the application. AI reliability protects the answer.**

---

# ⚠️ Current Limitations

- The default generator is extractive.
- OpenAI or Ollama can be configured for longer Write drafts.
- Confidence reflects retrieved evidence; it is not a guarantee that a claim is true.
- Page numbers for Markdown can be synthetic unless page markers exist.
- A Researcher ID is an invite lookup handle, not a password.
- The Library index remains local even when Supabase is enabled.
- Ask libraries are not automatically shared between collaborators.
- Citation precision and relevance still benefit from manual review.

---

# 📈 RAG Evolution

Lexicon Gate can be evaluated across progressively stronger configurations:

~~~
Traditional RAG
      ↓
Standard Self-RAG
      ↓
Self-RAG + Hybrid Retrieval
      ↓
Self-RAG + Evidence Gate
      ↓
Self-RAG + Claim Verification
      ↓
Enhanced Self-RAG
~~~

The goal is not simply to add more AI components, but to understand which verification layers improve evidence-grounded research answers.

---

# 🔮 Roadmap

### 🧠 Intelligence
- Stronger multi-document reasoning
- Better research-gap detection
- Improved contradiction handling
- More advanced claim verification
- Better retrieval evaluation

### 📚 Research
- Additional academic databases
- Citation graph exploration
- Research recommendations
- Literature mapping
- Author-level research discovery

### ✍️ Writing
- More academic templates
- ACM-style writing support
- Additional conference formats
- Improved citation management
- More advanced research drafting

### 👥 Collaboration
- Richer collaborative workflows
- Research comments
- Team workspaces
- Version history
- Activity tracking

### ⚡ Platform
- More retrieval backends
- Background processing
- Production deployment
- Scalable infrastructure
- CI/CD automation

---

# 🧠 Learning Outcomes

### AI / RAG
- Retrieval-Augmented Generation
- Self-RAG
- Hybrid retrieval
- Dense retrieval
- BM25
- Reciprocal Rank Fusion
- Evidence gating
- Claim verification
- Contradiction detection
- Self-correction
- Abstention

### Backend
- FastAPI
- Python
- REST APIs
- Pydantic
- Authentication
- Persistence
- Service-oriented architecture

### Frontend
- React
- Vite
- Component-based UI
- API integration
- Research-focused UX

### Data
- Embeddings
- Vector stores
- PostgreSQL
- Supabase
- Document processing
- Metadata extraction

### Research Systems
- Semantic Scholar
- OpenAlex
- arXiv
- Unpaywall
- Tavily
- Paper comparison
- Academic writing workflows

---

# 📚 Further Reading

- [Architecture](docs/architecture.md)
- [Methodology](docs/methodology.md)
- [Evaluation](docs/evaluation.md)
- [API Documentation](docs/api.md)

---

# 👩‍💻 Author

<p align="center">

### Nishita Kumari

<strong>Computer Science & Engineering — Data Science</strong>

AI • Data Engineering • Machine Learning • Backend Engineering • Research Systems

<br><br>

<a href="https://www.linkedin.com/in/nishitakr/">
  <img src="https://img.shields.io/badge/LinkedIn-Nishita%20Kumari-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white">
</a>

</p>

---

# ⭐ Support

If you find **Lexicon Gate** useful, consider giving the repository a ⭐.

Ideas, feedback, issues, and contributions are welcome.

---

<p align="center">
<strong>Built with curiosity. Verified with evidence. 🚀</strong>
<br>
<i>Because research deserves more than a generated answer.</i>
</p>
