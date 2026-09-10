import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ms, pct } from "./api";

const NAV = [
  ["ask", "Ask"],
  ["find", "Find papers"],
  ["library", "Library"],
  ["plagiarism", "Plagiarism"],
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
  const [askScope, setAskScope] = useState(null);

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
      <header className="topbar">
        <div className="brand">
          <h1>Enhanced Self-RAG</h1>
          <p>Question, evidence, verified answer.</p>
        </div>
        <nav>
          {NAV.map(([id, label]) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-meta">
          {health
            ? `${docs.length} source${docs.length === 1 ? "" : "s"} · ${health.knowledge_base?.chunks ?? 0} passages`
            : "Connecting to API…"}
        </div>
      </header>
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
            askScope={askScope}
            onClearScope={() => setAskScope(null)}
          />
        )}
        {page === "find" && <FindPapers onImported={refresh} />}
        {page === "library" && (
          <Library
            docs={docs}
            onChange={refresh}
            onAskTheme={(scope) => {
              setAskScope(scope);
              setPage("ask");
            }}
          />
        )}
        {page === "plagiarism" && <PlagiarismCheck docs={docs} />}
      </main>
    </div>
  );
}

function Ask({ docs, result, setResult, selected, setSelected, history, onQueried, askScope, onClearScope }) {
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
      const payload = await api.query({
        query: text,
        include_trace: true,
        document_ids: askScope?.document_ids?.length ? askScope.document_ids : undefined,
      });
      setResult(payload);
      await onQueried();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const badge = result ? verificationBadge(result) : null;

  return (
    <div className={`ask-workspace ${result ? "has-result" : ""}`}>
      <div className="ask-col ask-col-query">
        {emptyLibrary && (
          <div className="card banner" style={{ marginBottom: 16 }}>
            Upload sources first. Open <strong>Find papers</strong> to search academic indexes,
            or <strong>Library</strong> to upload your own files.
          </div>
        )}
        <div className="card">
          {askScope?.label && (
            <div className="theme-chip-row">
              <span className="theme-chip">
                Asking in: {askScope.label}
                <button type="button" className="theme-chip-clear" onClick={onClearScope} aria-label="Clear theme filter">
                  ×
                </button>
              </span>
            </div>
          )}
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
          {badge && (
            <div className="verify-block">
              <span className={`flag ${badge.tone}`}>{badge.label}</span>
              {result.plagiarism && (
                <span className={`flag ${plagiarismTone(result.plagiarism.risk)}`}>
                  Originality {Math.round((result.plagiarism.originality ?? 1) * 100)}% unique
                </span>
              )}
              {result.status === "CONFLICTING_EVIDENCE" && (
                <p className="status" style={{ margin: "8px 0 0" }}>Sources disagree. Both views are in the answer.</p>
              )}
            </div>
          )}
        </div>
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
      </div>

      {result && (
        <AnswerView
          result={result}
          docs={docs}
          selected={selected}
          onSelect={setSelected}
        />
      )}
    </div>
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

function Library({ docs, onChange, onAskTheme }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [clusters, setClusters] = useState([]);

  useEffect(() => {
    if (!docs.length) {
      setClusters([]);
      return;
    }
    let cancelled = false;
    api
      .clusters()
      .then((payload) => {
        if (!cancelled) setClusters(payload.clusters || []);
      })
      .catch(() => {
        if (!cancelled) setClusters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docs]);

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
      {docs.length > 0 && clusters.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Themes</h3>
          <p className="status" style={{ marginTop: 0 }}>
            Related papers grouped by content. Ask a theme to retrieve only those sources.
          </p>
          <div className="theme-grid">
            {clusters.map((cluster) => {
              const members = (cluster.document_ids || [])
                .map((id) => docs.find((doc) => doc.document_id === id))
                .filter(Boolean);
              return (
                <div key={cluster.cluster_id} className="theme-card">
                  <strong>{cluster.label}</strong>
                  <div className="status" style={{ margin: "6px 0" }}>
                    {cluster.size} paper{cluster.size === 1 ? "" : "s"}
                    {cluster.keywords?.length ? ` · ${cluster.keywords.slice(0, 3).join(" · ")}` : ""}
                  </div>
                  <ul className="theme-papers">
                    {members.map((doc) => (
                      <li key={doc.document_id}>{doc.title || doc.name}</li>
                    ))}
                  </ul>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      onAskTheme({
                        label: cluster.label,
                        document_ids: cluster.document_ids,
                      })
                    }
                  >
                    Ask this theme
                  </button>
                </div>
              );
            })}
          </div>
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

function PlagiarismCheck({ docs }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  async function check() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const payload = await api.checkPlagiarism(file);
      setReport(payload);
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
          <h2>Plagiarism</h2>
          <p>Upload a paper to score against your Library and academic indexes. The file is parsed, not added to the index.</p>
        </div>
      </div>
      <div className="card plag-upload">
        <label className="ghost upload-btn">
          {file ? file.name : "Choose PDF, Word, or text"}
          <input
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setReport(null);
            }}
          />
        </label>
        <button className="primary" type="button" disabled={busy || !file} onClick={check}>
          {busy ? "Checking…" : "Check plagiarism"}
        </button>
        {error && <span className="error">{error}</span>}
      </div>
      <p className="status plag-disclaimer">
        Checked against your Library and academic indexes (title and abstract), not the full open web.
        {docs.length === 0
          ? " Your Library is empty; indexes can still match titles and abstracts."
          : ""}
      </p>
      {report && <PlagiarismReportView report={report} />}
    </>
  );
}

function PlagiarismReportView({ report }) {
  const plagiarismPct = Math.round((report.similarity ?? 0) * 100);
  const originalityPct = Math.round((report.originality ?? 1) * 100);
  const spans = report.spans?.length ? report.spans : report.flagged_sentences || [];
  return (
    <div className="plag-report">
      <div className="grid two plag-scores">
        <div className="card plag-score">
          <h3>Plagiarism</h3>
          <strong className={plagiarismTone(report.risk)}>{plagiarismPct}%</strong>
          <p className="status">Overlapping wording vs Library and academic indexes</p>
        </div>
        <div className="card plag-score">
          <h3>Originality</h3>
          <strong className="good">{originalityPct}%</strong>
          <p className="status">unique</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="ghost" onClick={() => exportOriginalityReport(report)}>
          Export report
        </button>
      </div>
      <p className="status">
        {report.filename} · {report.n_words} words
        {report.n_pages ? ` · ${report.n_pages} page${report.n_pages === 1 ? "" : "s"}` : ""}
        {report.risk ? ` · ${report.risk} risk` : ""}
      </p>
      {(report.flags || []).length > 0 && (
        <p className="status">{report.flags.join(" ")}</p>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Matching sources</h3>
        {(report.sources || []).length === 0 ? (
          <p className="status" style={{ marginTop: 0 }}>
            {report.library_empty
              ? "No Library papers and no overlapping academic abstracts."
              : "No long overlapping passages were found."}
          </p>
        ) : (
          <ul className="plain-list plag-sources">
            {report.sources.map((source) => {
              const href = paperHref(source);
              return (
                <li key={source.document_id}>
                  <span className="plag-source-main">
                    <span className={`flag ${source.origin === "academic" ? "warn" : "good"}`}>
                      {source.origin === "academic" ? "Academic" : "Library"}
                    </span>
                    <span>{source.document_name}</span>
                    {href && (
                      <a className="ghost" href={href} target="_blank" rel="noreferrer">
                        Open paper
                      </a>
                    )}
                  </span>
                  <strong>{Math.round((source.share ?? 0) * 100)}%</strong>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(report.sections || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Section originality</h3>
          <ul className="plain-list plag-sources">
            {report.sections.map((section) => (
              <li key={section.title}>
                <span>{section.title}</span>
                <strong>{Math.round((section.originality ?? 1) * 100)}% unique</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {spans.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Originality view</h3>
          <p className="status plag-legend" style={{ marginTop: 0 }}>
            <span className="kind-original">Original</span>
            <span className="kind-paraphrased">Paraphrased</span>
            <span className="kind-verbatim">Verbatim uncited</span>
          </p>
          <div className="orig-view">
            {spans.map((span, index) => (
              <p key={`${span.kind}-${index}`} className={`orig-span kind-${span.kind || "verbatim"}`}>
                {span.text}
              </p>
            ))}
          </div>
        </div>
      )}
      {(report.flagged_sentences || []).length > 0 && (
        <details className="card flagged-block" style={{ marginTop: 16 }} open>
          <summary>Areas of correction ({report.flagged_sentences.length})</summary>
          <ul className="plain-list flagged-list">
            {report.flagged_sentences.map((row, index) => (
              <li key={`${row.text}-${index}`}>
                <p className={`flagged-sentence kind-${row.kind || "verbatim"}`}>{row.text}</p>
                {row.kind && row.kind !== "original" && (
                  <span className={`flag ${row.kind === "verbatim" ? "bad" : "warn"}`}>
                    {row.kind === "verbatim" ? "Verbatim uncited" : "Paraphrased"}
                  </span>
                )}
                <ul className="plain-list correction-hints">
                  {correctionHints(row).map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function plagiarismTone(risk) {
  if (risk === "high") return "bad";
  if (risk === "medium") return "warn";
  return "good";
}

function correctionHints(row) {
  if (row.corrections?.length) return row.corrections;
  const lines = ["Reword this passage so it is not a long verbatim copy."];
  const seen = new Set();
  for (const match of row.matches || []) {
    const name = match.document_name || match.document_id || "this source";
    const page = match.page != null ? `, p. ${match.page}` : "";
    const line = `Cite ${name}${page}.`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

function verificationBadge(result) {
  if (
    result.unrelated_to_sources ||
    result.abstained ||
    result.status === "INSUFFICIENT_EVIDENCE"
  ) {
    return { label: "Unsupported", tone: "bad" };
  }
  const claims = result.claims || [];
  if (!claims.length) {
    if (result.status === "CONFLICTING_EVIDENCE") {
      return { label: "Partially supported", tone: "warn" };
    }
    if (result.status === "ANSWERED" || result.status === "NO_RETRIEVAL_NEEDED") {
      return { label: "Supported", tone: "good" };
    }
    return { label: "Unsupported", tone: "bad" };
  }
  const statuses = claims.map((claim) => claim.status);
  if (statuses.some((status) => status === "UNSUPPORTED" || status === "CONTRADICTED")) {
    return { label: "Unsupported", tone: "bad" };
  }
  if (statuses.some((status) => status === "PARTIALLY_SUPPORTED")) {
    return { label: "Partially supported", tone: "warn" };
  }
  return { label: "Supported", tone: "good" };
}

function exportText(result) {
  const cites = (result.evidence || [])
    .map((item) => `[${item.citation_id}] ${item.apa || item.title || item.document_name}`)
    .join("\n");
  return cites ? `${result.answer}\n\n${cites}` : result.answer || "";
}

function AnswerView({ result, docs, selected, onSelect }) {
  const conf = result.confidence || {};
  const lastGate = (result.gate_decisions || []).at(-1);
  const [copied, setCopied] = useState("");
  const [showFlagged, setShowFlagged] = useState(false);
  const plag = result.plagiarism || {};
  const evidenceByCite = useMemo(() => {
    const map = new Map();
    for (const item of result.evidence || []) map.set(item.citation_id, item);
    return map;
  }, [result.evidence]);
  const usedIds = new Set((result.evidence || []).map((item) => item.document_id));
  const usedNames = new Set((result.evidence || []).map((item) => item.document_name));
  const unused = docs.filter((d) => !usedIds.has(d.document_id) && !usedNames.has(d.name));
  const contradictions = result.contradictions || [];

  function selectCite(id) {
    const item = evidenceByCite.get(id);
    if (item) onSelect(item);
  }

  async function copyAnswer() {
    const ok = await copyText(exportText(result));
    setCopied(ok ? "copy" : "failed");
    setTimeout(() => setCopied(""), 1600);
  }

  function saveAnswer() {
    const blob = new Blob([exportText(result)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "self-rag-answer.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="ask-col ask-col-answer">
        <div className="card answer-card">
          <h3>Answer</h3>
          {result.unrelated_to_sources && (
            <p className="status" style={{ marginTop: 0 }}>
              This question is not covered by your files.
            </p>
          )}
          {!result.unrelated_to_sources && result.status === "INSUFFICIENT_EVIDENCE" && (
            <p className="status" style={{ marginTop: 0 }}>
              The indexed files do not contain enough support for a reliable answer.
            </p>
          )}
          <div className="answer">
            <AnswerText
              text={result.answer}
              onCite={selectCite}
              highlights={showFlagged ? (plag.matches || []).map((m) => m.text) : []}
            />
          </div>
          <div className="export-bar">
            <button type="button" className="ghost" onClick={copyAnswer}>
              {copied === "copy" ? "Copied" : "Copy"}
            </button>
            <button type="button" className="ghost" onClick={saveAnswer}>
              Save
            </button>
            {copied === "failed" && <span className="error">Copy failed</span>}
          </div>
          {(plag.flagged_sentences || []).length > 0 && (
            <details
              className="flagged-block"
              onToggle={(event) => setShowFlagged(event.target.open)}
            >
              <summary>View flagged sentences ({plag.flagged_sentences.length})</summary>
              <ul className="plain-list flagged-list">
                {plag.flagged_sentences.map((row, index) => (
                  <li key={`${row.text}-${index}`}>
                    <p className="flagged-sentence">{row.text}</p>
                    {(row.matches || []).map((match, mIndex) => (
                      <button
                        key={`${match.document_id}-${mIndex}`}
                        type="button"
                        className="flagged-source"
                        onClick={() => {
                          const item = (result.evidence || []).find(
                            (ev) => ev.document_id === match.document_id,
                          );
                          if (item) onSelect(item);
                        }}
                      >
                        <span className={`flag ${match.cited ? "good" : "bad"}`}>
                          {match.cited ? "Cited" : "Uncited"}
                        </span>
                        {match.document_name}
                        {match.page != null ? ` · p. ${match.page}` : ""}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <details className="card details-card">
          <summary>Details</summary>
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
                      onClick={() => {
                        const cite = claim.supporting_citations?.[0] ?? claim.contradicting_citations?.[0];
                        if (cite != null) selectCite(cite);
                      }}
                    >
                      <span className={`flag ${CLAIM_TONE[claim.status] || ""}`}>{claim.status.replaceAll("_", " ")}</span>
                      <span>{claim.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 style={{ marginTop: 16 }}>Not used</h3>
          {unused.length === 0 ? (
            <p className="status">Every indexed file contributed, or the library is empty.</p>
          ) : (
            <ul className="plain-list">
              {unused.map((doc) => (
                <li key={doc.document_id}>{doc.title || doc.name}</li>
              ))}
            </ul>
          )}
          <h3 style={{ marginTop: 16 }}>Check trace</h3>
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
        </details>
      </div>

      <div className="ask-col ask-col-evidence">
        <div className="card">
          <h3>Evidence</h3>
          {(result.evidence || []).length === 0 && (
            <p className="status">No passages were cited.</p>
          )}
          <div className="evidence-list">
            {(result.evidence || []).map((item) => (
              <EvidenceCard
                key={item.chunk_id}
                item={item}
                active={selected?.chunk_id === item.chunk_id}
                expanded={selected?.chunk_id === item.chunk_id}
                onSelect={() => onSelect(item)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function AnswerText({ text, onCite, highlights = [] }) {
  const parts = String(text || "").split(/(\[\d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const id = Number(match[1]);
      return (
        <button key={`${part}-${index}`} type="button" className="cite-link" onClick={() => onCite(id)}>
          [{id}]
        </button>
      );
    }
    return <span key={index}>{markOverlaps(part, highlights)}</span>;
  });
}

function markOverlaps(text, highlights) {
  if (!text || !highlights?.length) return text;
  const needles = [...new Set(highlights.filter(Boolean))].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  let cut = 0;
  const nodes = [];
  while (cut < text.length) {
    let best = null;
    for (const needle of needles) {
      const at = lower.indexOf(needle.toLowerCase(), cut);
      if (at === -1) continue;
      if (!best || at < best.at || (at === best.at && needle.length > best.needle.length)) {
        best = { at, needle };
      }
    }
    if (!best) {
      nodes.push(text.slice(cut));
      break;
    }
    if (best.at > cut) nodes.push(text.slice(cut, best.at));
    nodes.push(
      <mark key={`${best.at}-${best.needle.length}`} className="highlight">
        {text.slice(best.at, best.at + best.needle.length)}
      </mark>,
    );
    cut = best.at + best.needle.length;
  }
  return nodes;
}

function EvidenceCard({ item, active, expanded, onSelect }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (active || expanded) setOpen(true);
  }, [active, expanded]);
  const showFull = open;
  const authors = (item.authors || []).join(", ") || "Unknown author";
  const year = item.year || "n.d.";
  const snippet = item.text.slice(0, 160);

  async function copy(kind) {
    const ok = await copyText(kind === "apa" ? item.apa : item.bibtex);
    setCopied(ok ? kind : "failed");
    setTimeout(() => setCopied(""), 1600);
  }

  return (
    <div className={`evidence-card ${active ? "active" : ""}`}>
      <button type="button" className="evidence-card-main" onClick={onSelect}>
        <div className="cite">[{item.citation_id}] {item.title || item.document_name}</div>
        <div className="status" style={{ margin: "4px 0 0" }}>
          {authors} · {year}
          {item.page != null ? ` · p. ${item.page}` : ""}
          {item.doi ? ` · ${item.doi}` : ""}
        </div>
        <p className="cite-snippet">{showFull ? item.text : `${snippet}${item.text.length > 160 ? "…" : ""}`}</p>
      </button>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="ghost"
          onClick={() => setOpen((value) => !value)}
        >
          {showFull ? "View less" : "View more"}
        </button>
        {showFull && (
          <>
            <button type="button" className="ghost" onClick={() => copy("apa")}>
              {copied === "apa" ? "Copied APA" : "Copy APA"}
            </button>
            <button type="button" className="ghost" onClick={() => copy("bibtex")}>
              {copied === "bibtex" ? "Copied BibTeX" : "Copy BibTeX"}
            </button>
          </>
        )}
        {copied === "failed" && <span className="error">Copy failed</span>}
      </div>
    </div>
  );
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

function exportOriginalityReport(report) {
  const plag = Math.round((report.similarity ?? 0) * 100);
  const orig = Math.round((report.originality ?? 1) * 100);
  const lines = [
    `Originality report: ${report.filename || "upload"}`,
    `Plagiarism ${plag}% · Originality ${orig}% unique · ${report.risk || "low"} risk`,
    (report.flags || []).join(" "),
    "",
    "Sources",
    ...(report.sources || []).map(
      (source) =>
        `- ${source.origin === "academic" ? "Academic" : "Library"} ${source.document_name} (${Math.round((source.share ?? 0) * 100)}%)`,
    ),
    "",
    "Sections",
    ...(report.sections || []).map(
      (section) =>
        `- ${section.title}: ${Math.round((section.originality ?? 1) * 100)}% unique (${section.n_flagged || 0} flagged)`,
    ),
    "",
    "Flagged passages",
  ];
  for (const row of report.flagged_sentences || []) {
    lines.push(`[${row.kind || "verbatim"}] ${row.text}`);
    for (const hint of correctionHints(row)) lines.push(`  · ${hint}`);
  }
  const blob = new Blob([lines.filter((line) => line != null).join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "originality-report.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function HistoryList({ items, onPick }) {
  if (!items?.length) return null;
  return (
    <details className="card history-card">
      <summary>Recent questions</summary>
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
    </details>
  );
}

