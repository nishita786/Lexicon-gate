import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ms, pct } from "./api";

const NAV = [
  ["ask", "Ask"],
  ["find", "Find papers"],
  ["library", "Library"],
];

const STATUS_COPY = {
  ANSWERED: { label: "Answered", tone: "good" },
  INSUFFICIENT_EVIDENCE: { label: "Not enough evidence", tone: "warn" },
  CONFLICTING_EVIDENCE: { label: "Sources disagree", tone: "warn" },
  CLARIFICATION_NEEDED: { label: "Needs a clearer question", tone: "warn" },
  NO_RETRIEVAL_NEEDED: { label: "No documents needed", tone: "" },
};

const CLAIM_TONE = {
  SUPPORTED: "good",
  PARTIALLY_SUPPORTED: "warn",
  UNSUPPORTED: "bad",
  CONTRADICTED: "bad",
};

export default function App() {
  const [page, setPage] = useState("ask");
  const [health, setHealth] = useState(null);
  const [docs, setDocs] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [history, setHistory] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const [h, d, recent] = await Promise.all([
        api.health(),
        api.documents(),
        api.recent().catch(() => []),
      ]);
      setHealth(h);
      setDocs(d.documents || []);
      setHistory(Array.isArray(recent) ? recent : []);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Enhanced Self-RAG</h1>
          <p>Ask over your files. Answers only when the sources support each claim.</p>
        </div>
        <nav>
          {NAV.map(([id, label]) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {health ? (
            <>
              {docs.length} source{docs.length === 1 ? "" : "s"} indexed
              <br />
              {health.knowledge_base?.chunks ?? 0} passages
            </>
          ) : (
            "Connecting to API…"
          )}
        </div>
      </aside>
      <main className="main">
        {page === "ask" && (
          <Ask
            docs={docs}
            result={lastResult}
            setResult={setLastResult}
            selected={selectedEvidence}
            setSelected={setSelectedEvidence}
            history={history}
            onQueried={refresh}
          />
        )}
        {page === "find" && <FindPapers onImported={refresh} />}
        {page === "library" && (
          <Library docs={docs} onChange={refresh} />
        )}
      </main>
    </div>
  );
}

function Ask({ docs, result, setResult, selected, setSelected, history, onQueried }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const emptyLibrary = docs.length === 0;

  async function ask(next = query) {
    const text = (next || "").trim();
    if (!text || emptyLibrary) return;
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const payload = await api.query({ query: text, include_trace: true });
      setResult(payload);
      await onQueried();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Ask</h2>
          <p>Enhanced Self-RAG: retrieve, check evidence, draft, verify claims, then answer or refuse.</p>
        </div>
      </div>

      {emptyLibrary && (
        <div className="card banner" style={{ marginBottom: 16 }}>
          Upload sources first. Open <strong>Find papers</strong> to search academic indexes,
          or <strong>Library</strong> to upload your own files.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={emptyLibrary ? "Find or upload sources first, then ask." : "Ask a question about your sources…"}
          disabled={emptyLibrary}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || emptyLibrary || !query.trim()} onClick={() => ask()}>
            {busy ? "Checking sources…" : "Ask"}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </div>

      {result && (
        <AnswerView
          result={result}
          docs={docs}
          selected={selected}
          onSelect={setSelected}
        />
      )}

      <HistoryList
        items={history}
        onPick={async (item) => {
          setQuery(item.query);
          try {
            const saved = await api.historyItem(item.query_id);
            setResult(saved);
            setSelected(null);
          } catch {
            /* still fill the question box */
          }
        }}
      />
    </>
  );
}

function paperHref(paper) {
  if (paper.doi) {
    const doi = String(paper.doi).replace(/^https?:\/\/doi\.org\//i, "");
    return `https://doi.org/${doi}`;
  }
  return paper.url || paper.pdf_url || "";
}

function FindPapers({ onImported }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);

  async function search(event) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await api.searchPapers(text);
      setResults(payload);
      if (!payload.papers?.length) setMessage("No papers found. Try a more specific title or author.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addPaper(paper) {
    setImporting(paper.paper_id);
    setError("");
    setMessage("");
    try {
      const result = await api.importPaper({
        paper_id: paper.paper_id,
        source: paper.source,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        abstract: paper.abstract,
        doi: paper.doi,
        pdf_url: paper.pdf_url,
        url: paper.url,
      });
      await onImported();
      if (result.ingested === "pdf") {
        setMessage(`Added “${paper.title}”. Full PDF indexed. Ask over it from Ask.`);
      } else {
        setMessage(
          `Added “${paper.title}”. Could not fetch a PDF (publisher blocked or paywalled). Abstract saved. Use Open paper for the official copy.`
        );
      }
      if (result.warnings?.length) setError(result.warnings.join(" · "));
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(null);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Find papers</h2>
          <p>Search academic indexes. Rate limits are retried automatically. Add a paper to Library, then Ask.</p>
        </div>
      </div>
      <form className="card" style={{ marginBottom: 16 }} onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Paper title, topic, or author…"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" type="submit" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
          {results?.provider && <span className="status">Results from {results.provider.replaceAll("_", " ")}</span>}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      {(results?.papers || []).map((paper) => (
        <div key={`${paper.source}-${paper.paper_id}`} className="card paper-row">
          <div>
            <strong>{paper.title}</strong>
            <div className="status" style={{ margin: "4px 0 0" }}>
              {(paper.authors || []).slice(0, 8).join(", ") || "Unknown author"}
              {paper.year ? ` · ${paper.year}` : ""}
              {paper.venue ? ` · ${paper.venue}` : ""}
              {paper.citation_count != null ? ` · cited ${paper.citation_count}` : ""}
            </div>
            {paper.open_access && <span className="flag good" style={{ marginTop: 8 }}>Open access</span>}
            {paper.abstract && <p className="cite-snippet">{paper.abstract.slice(0, 360)}{paper.abstract.length > 360 ? "…" : ""}</p>}
          </div>
          <div className="paper-actions">
            {paperHref(paper) && (
              <a className="ghost" href={paperHref(paper)} target="_blank" rel="noreferrer">
                Open paper
              </a>
            )}
            <button
              className="primary"
              disabled={importing === paper.paper_id}
              onClick={() => addPaper(paper)}
            >
              {importing === paper.paper_id ? "Adding…" : "Add to library"}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function Library({ docs, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function onUpload(event) {
    const files = event.target.files;
    if (!files?.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.upload(files);
      await onChange();
      const n = result.documents?.length || 0;
      setMessage(`Indexed ${n} file${n === 1 ? "" : "s"} (${result.total_chunks} passages).`);
      if (result.warnings?.length) setError(result.warnings.join(" · "));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function remove(id) {
    setBusy(true);
    setError("");
    try {
      await api.deleteDocument(id);
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Library</h2>
          <p>Sources Ask can use. Add papers from Find papers, or upload files here. Citation metadata comes from the paper record or the file name.</p>
        </div>
        <label className="primary upload-btn">
          {busy ? "Indexing…" : "Upload files"}
          <input type="file" multiple hidden disabled={busy} onChange={onUpload} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      {!docs.length && (
        <div className="card">
          <h3>No sources yet</h3>
          <p className="status">
            Upload a PDF or text file, or search academic papers in <strong>Find papers</strong>.
          </p>
        </div>
      )}
      {docs.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Citation</th>
                <th className="num">Passages</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.document_id}>
                  <td>
                    <div>
                      <strong>{doc.title || doc.name}</strong>
                      <div className="status" style={{ margin: 0 }}>
                        {(doc.authors || []).join(", ") || "Unknown author"}
                        {doc.year ? ` · ${doc.year}` : ""}
                        {doc.venue ? ` · ${doc.venue}` : ""}
                        <br />
                        {doc.name}
                      </div>
                    </div>
                  </td>
                  <td className="num">{doc.n_chunks}</td>
                  <td className="num">
                    <button className="danger" disabled={busy} onClick={() => remove(doc.document_id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AnswerView({ result, docs, selected, onSelect }) {
  const conf = result.confidence || {};
  const status = STATUS_COPY[result.status] || { label: result.status, tone: "" };
  const lastGate = (result.gate_decisions || []).at(-1);
  const [openCheck, setOpenCheck] = useState(false);
  const evidenceByCite = useMemo(() => {
    const map = new Map();
    for (const item of result.evidence || []) map.set(item.citation_id, item);
    return map;
  }, [result.evidence]);
  const usedIds = new Set((result.evidence || []).map((item) => item.document_id));
  const usedNames = new Set((result.evidence || []).map((item) => item.document_name));
  const unused = docs.filter((d) => !usedIds.has(d.document_id) && !usedNames.has(d.name));
  const loopSteps = loopFromTrace(result.trace);
  const contradictions = result.contradictions || [];

  function selectClaim(claim) {
    const cite = claim.supporting_citations?.[0] ?? claim.contradicting_citations?.[0];
    if (cite != null && evidenceByCite.has(cite)) onSelect(evidenceByCite.get(cite));
  }

  return (
    <>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="loop-steps" aria-label="Self-RAG loop">
            {loopSteps.map((step) => (
              <div key={step.stage} className={`loop-step ${step.tone || ""}`}>
                <span className="loop-step-label">{step.label}</span>
                {step.detail && <span className="loop-step-detail">{step.detail}</span>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`flag ${status.tone}`}>{status.label}</span>
            {result.abstained && <span className="flag warn">Did not guess</span>}
            {result.unrelated_to_sources && <span className="flag bad">Not in your files</span>}
          </div>
          {result.unrelated_to_sources && (
            <p className="status" style={{ marginTop: 0 }}>
              This question contradicts what the uploaded files can support: they do not cover it.
            </p>
          )}
          {!result.unrelated_to_sources && result.status === "INSUFFICIENT_EVIDENCE" && (
            <p className="status" style={{ marginTop: 0 }}>
              The indexed files do not contain enough support for a reliable answer.
              Try another question or add a source that covers this topic.
            </p>
          )}
          {result.status === "CONFLICTING_EVIDENCE" && (
            <p className="status" style={{ marginTop: 0 }}>
              Sources disagree. Both views are shown instead of picking a winner.
            </p>
          )}
          <div className="answer">{result.answer}</div>
          {result.unrelated_to_sources && (
            <div className="mismatch">
              <div>
                <h3>Question</h3>
                <p>{result.query}</p>
              </div>
              <div>
                <h3>Your files</h3>
                <p>{result.mismatch_detail || "Retrieved passages do not address this question."}</p>
              </div>
            </div>
          )}
          <div className="meta">
            <span>Confidence <strong>{pct(conf.confidence)}</strong></span>
            <span>Evidence <strong>{pct(lastGate?.evidence_score ?? conf.evidence_coverage)}</strong></span>
            <span>Claims <strong>{conf.claims_verified}/{conf.claims_total}</strong></span>
            <span>Checked in <strong>{ms(result.metrics?.latency_ms)}</strong></span>
          </div>
          {conf.caveat && <p className="status">{conf.caveat}</p>}
          {result.hallucination?.flags?.length > 0 && (
            <p className="error">{result.hallucination.flags.join(" · ")}</p>
          )}

          {contradictions.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Source contradictions</h3>
              <ul className="plain-list">
                {contradictions.map((pair, index) => (
                  <li key={`${pair.citation_a}-${pair.citation_b}-${index}`} className="conflict-row">
                    <span className="flag warn">Disagree</span>
                    <div>
                      <p>{pair.explanation}</p>
                      <p className="status" style={{ margin: 0 }}>
                        [{pair.citation_a}] {pair.document_a} vs [{pair.citation_b}] {pair.document_b}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(result.claims || []).length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Claims</h3>
              <ul className="claim-list">
                {result.claims.map((claim) => (
                  <li key={claim.claim_id}>
                    <button
                      type="button"
                      className={`claim ${CLAIM_TONE[claim.status] || ""}`}
                      onClick={() => selectClaim(claim)}
                    >
                      <span className={`flag ${CLAIM_TONE[claim.status] || ""}`}>{claim.status.replaceAll("_", " ")}</span>
                      <span>{claim.text}</span>
                    </button>
                    {claimCiteGroups(claim, evidenceByCite).map((group) => (
                      <div key={`${claim.claim_id}-${group.role}`}>
                        <div className="status" style={{ margin: "8px 0 0 8px" }}>{group.label}</div>
                        {group.items.map((item) => (
                          <CitationCard
                            key={`${claim.claim_id}-${group.role}-${item.citation_id}`}
                            item={item}
                            snippet={claim.best_evidence_span}
                            onOpen={() => onSelect(item)}
                            role={group.role}
                          />
                        ))}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}

          <button className="ghost" style={{ marginTop: 12 }} onClick={() => setOpenCheck((v) => !v)}>
            {openCheck ? "Hide how this was checked" : "How this was checked"}
          </button>
          {openCheck && (
            <ul className="trace compact">
              {(result.trace || []).map((event) => (
                <li key={`${event.step}-${event.stage}`}>
                  <span className={`dot ${event.status === "warn" ? "warn" : event.status === "skip" ? "skip" : ""}`} />
                  <div>
                    {event.label}
                    {event.detail && <div className="detail">{event.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <EvidencePanel item={selected} highlight={selectedClaimSpan(result, selected)} />
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Used in this answer</h3>
          {(result.evidence || []).length === 0 && (
            <p className="status">No passages were cited.</p>
          )}
          <div className="sources">
            {(result.evidence || []).map((item) => (
              <div
                key={item.chunk_id}
                className={`source ${selected?.chunk_id === item.chunk_id ? "active" : ""}`}
                onClick={() => onSelect(item)}
              >
                <div className="cite">
                  [{item.citation_id}] {item.document_name}
                  {item.page != null ? ` — page ${item.page}` : ""}
                </div>
                <p>{item.text.slice(0, 220)}{item.text.length > 220 ? "…" : ""}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Not used</h3>
          {unused.length === 0 ? (
            <p className="status">Every indexed file contributed, or the library is empty.</p>
          ) : (
            <ul className="plain-list">
              {unused.map((doc) => (
                <li key={doc.document_id}>{doc.name}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function loopFromTrace(trace) {
  const order = [
    ["retrieval", "Retrieve"],
    ["evidence_gate", "Evidence gate"],
    ["generate", "Draft"],
    ["verify", "Verify claims"],
    ["correction", "Self-correct"],
    ["contradiction", "Conflicts"],
    ["abstain", "Refuse"],
    ["final", "Final"],
  ];
  const byStage = new Map();
  for (const event of trace || []) byStage.set(event.stage, event);
  const steps = [];
  for (const [stage, label] of order) {
    const event = byStage.get(stage);
    if (!event) continue;
    const tone = event.status === "warn" ? "warn" : event.status === "skip" ? "" : "good";
    steps.push({
      stage,
      label,
      detail: event.label,
      tone,
    });
  }
  if (steps.length) return steps;
  return [
    { stage: "retrieval", label: "Retrieve", detail: "", tone: "" },
    { stage: "evidence_gate", label: "Evidence gate", detail: "", tone: "" },
    { stage: "verify", label: "Verify claims", detail: "", tone: "" },
  ];
}

function claimCiteGroups(claim, evidenceByCite) {
  const support = [...new Set(claim.supporting_citations || [])]
    .map((id) => evidenceByCite.get(id))
    .filter(Boolean);
  const contra = [...new Set(claim.contradicting_citations || [])]
    .map((id) => evidenceByCite.get(id))
    .filter(Boolean);
  const groups = [];
  if (support.length) groups.push({ role: "supports", label: "Supports", items: support });
  if (contra.length) groups.push({ role: "contradicts", label: "Contradicts", items: contra });
  return groups;
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CitationCard({ item, snippet, onOpen, role }) {
  const [copied, setCopied] = useState("");
  const authors = (item.authors || []).join(", ") || "Unknown author";
  const year = item.year || "n.d.";

  async function copy(kind) {
    const ok = await copyText(kind === "apa" ? item.apa : item.bibtex);
    setCopied(ok ? kind : "failed");
    setTimeout(() => setCopied(""), 1600);
  }

  return (
    <div className={`cite-card ${role === "contradicts" ? "contra" : ""}`}>
      <button type="button" className="cite-card-main" onClick={onOpen}>
        <div className="cite-card-title">{item.title || item.document_name}</div>
        <div className="status" style={{ margin: 0 }}>
          {authors} · {year}
          {item.page != null ? ` · p. ${item.page}` : ""}
          {item.venue ? ` · ${item.venue}` : ""}
        </div>
        {snippet && <p className="cite-snippet">{snippet}</p>}
      </button>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="ghost" onClick={() => copy("apa")}>
          {copied === "apa" ? "Copied APA" : "Copy APA"}
        </button>
        <button type="button" className="ghost" onClick={() => copy("bibtex")}>
          {copied === "bibtex" ? "Copied BibTeX" : "Copy BibTeX"}
        </button>
        {copied === "failed" && <span className="error">Copy failed</span>}
      </div>
    </div>
  );
}

function selectedClaimSpan(result, selected) {
  if (!selected) return "";
  const claim = (result.claims || []).find(
    (c) =>
      c.supporting_citations?.includes(selected.citation_id) ||
      c.contradicting_citations?.includes(selected.citation_id),
  );
  return claim?.best_evidence_span || "";
}

function EvidencePanel({ item, highlight }) {
  if (!item) {
    return (
      <div className="card">
        <h3>Evidence</h3>
        <p className="status">Click a claim or a citation to see the supporting passage.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Evidence</h3>
      <div className="cite" style={{ color: "var(--blue)", fontFamily: "var(--mono)", marginBottom: 8 }}>
        [{item.citation_id}] {item.document_name}
        {item.page != null ? ` — page ${item.page}` : ""}
        {item.section ? ` · ${item.section}` : ""}
      </div>
      <p className="answer">{highlightText(item.text, highlight)}</p>
    </div>
  );
}

function highlightText(text, span) {
  if (!span || !text.toLowerCase().includes(span.toLowerCase())) return text;
  const index = text.toLowerCase().indexOf(span.toLowerCase());
  const before = text.slice(0, index);
  const match = text.slice(index, index + span.length);
  const after = text.slice(index + span.length);
  return (
    <>
      {before}
      <mark className="highlight">{match}</mark>
      {after}
    </>
  );
}

function HistoryList({ items, onPick }) {
  if (!items?.length) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Recent questions</h3>
      <ul className="plain-list history">
        {items.map((item) => (
          <li key={item.query_id}>
            <button type="button" className="history-item" onClick={() => onPick(item)}>
              <span>{item.query}</span>
              <span className="status">
                {(STATUS_COPY[item.status] || {}).label || item.status}
                {item.confidence != null ? ` · ${pct(item.confidence)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
