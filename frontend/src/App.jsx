import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ms, pct } from "./api";

const NAV = [
  ["ask", "Ask"],
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
          <p>One grounded answer, with citations, claim support, and confidence from the evidence.</p>
        </div>
      </div>

      {emptyLibrary && (
        <div className="card banner" style={{ marginBottom: 16 }}>
          Upload sources first. Open <strong>Library</strong> and add PDF, Markdown, or text files.
          There is nothing to retrieve from until you do.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={emptyLibrary ? "Add documents in Library, then ask a question." : "Ask a question about your sources…"}
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
          <p>These files are the only sources answers can use. Nothing is invented from outside them.</p>
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
            Upload the documents you want answers from. Supported types depend on the backend
            loaders (typically PDF, Markdown, and plain text).
          </p>
        </div>
      )}
      {docs.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Passages</th>
                <th className="num">Pages</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.document_id}>
                  <td>{doc.name}</td>
                  <td className="num">{doc.n_chunks}</td>
                  <td className="num">{doc.n_pages ?? "—"}</td>
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

  function selectClaim(claim) {
    const cite = claim.supporting_citations?.[0] ?? claim.contradicting_citations?.[0];
    if (cite != null && evidenceByCite.has(cite)) onSelect(evidenceByCite.get(cite));
  }

  return (
    <>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`flag ${status.tone}`}>{status.label}</span>
            {result.abstained && <span className="flag warn">Did not guess</span>}
          </div>
          {result.status === "INSUFFICIENT_EVIDENCE" && (
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
                      {claim.supporting_citations?.length > 0 && (
                        <span className="cite-inline">
                          {claim.supporting_citations.map((id) => `[${id}]`).join(" ")}
                        </span>
                      )}
                    </button>
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
              <li>
                <span className="dot" />
                <div>
                  Evidence gate: {lastGate?.action || "n/a"}
                  {lastGate?.rationale && <div className="detail">{lastGate.rationale}</div>}
                </div>
              </li>
              <li>
                <span className="dot" />
                <div>
                  Retrieval attempts: {result.metrics?.retrieval_attempts ?? 0}
                  {result.rewritten_queries?.length ? (
                    <div className="detail">Rewrites: {result.rewritten_queries.join(" → ")}</div>
                  ) : null}
                </div>
              </li>
              <li>
                <span className={`dot ${result.metrics?.correction_loops ? "warn" : ""}`} />
                <div>Self-correct loops: {result.metrics?.correction_loops ?? 0}</div>
              </li>
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
