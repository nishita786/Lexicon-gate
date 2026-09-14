import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ms, pct } from "./api";
import AuthScreen, { Logo } from "./Auth";

const NAV = [
  ["workspace", "Workspace"],
  ["ask", "Ask"],
  ["find", "Find papers"],
  ["library", "Library"],
  ["compare", "Compare"],
  ["events", "Events"],
];

const STATUS_COPY = {
  ANSWERED: { label: "Answered", tone: "good" },
  INSUFFICIENT_EVIDENCE: { label: "Not enough evidence", tone: "warn" },
  CONFLICTING_EVIDENCE: { label: "Sources disagree", tone: "warn" },
  CLARIFICATION_NEEDED: { label: "Needs a clearer question", tone: "warn" },
  NO_RETRIEVAL_NEEDED: { label: "No documents needed", tone: "" },
};

const CLAIM_META = {
  SUPPORTED: { label: "supported", tone: "neutral" },
  PARTIALLY_SUPPORTED: { label: "insufficient evidence", tone: "warn" },
  UNSUPPORTED: { label: "unsupported", tone: "warn" },
  CONTRADICTED: { label: "contradicted", tone: "warn" },
};

export default function App() {
  const [session, setSession] = useState(undefined);
  const [page, setPage] = useState("workspace");
  const [health, setHealth] = useState(null);
  const [docs, setDocs] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [history, setHistory] = useState([]);
  const [askScope, setAskScope] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    api.me().then(setSession).catch(() => setSession(null));
  }, []);

  useEffect(() => {
    function onLost() {
      setSession(null);
    }
    window.addEventListener("selfrag-auth-lost", onLost);
    return () => window.removeEventListener("selfrag-auth-lost", onLost);
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
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
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* still leave the session locally */
    }
    setSession(null);
    setDocs([]);
    setLastResult(null);
    setHistory([]);
    setPage("workspace");
  }

  const navIndex = Math.max(0, NAV.findIndex(([id]) => id === page));

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function place() {
      const btn = nav.querySelector("button.active");
      if (!btn) return;
      nav.style.setProperty("--thumb-x", `${btn.offsetLeft}px`);
      nav.style.setProperty("--thumb-w", `${btn.offsetWidth}px`);
      nav.style.setProperty("--thumb-y", `${btn.offsetTop}px`);
      nav.style.setProperty("--thumb-h", `${btn.offsetHeight}px`);
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [page, session]);

  if (session === undefined) {
    return (
      <div className="auth-screen session-splash">
        <div className="auth-orbs" aria-hidden="true">
          <span className="orb orb-violet" />
          <span className="orb orb-magenta" />
          <span className="orb orb-orange" />
        </div>
        <Logo size="hero" />
        <p className="muted">Opening the gate…</p>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onSignedIn={setSession} />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <Logo size="nav" />
          <p>Question, evidence, verified answer.</p>
        </div>
        <nav ref={navRef} data-active={page} data-index={navIndex} aria-label="Primary">
          <span className="nav-thumb" aria-hidden="true" />
          {NAV.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="topbar-user">{session.name || session.email}</span>
          <button type="button" className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-bar">
          <span>
            {health
              ? `${docs.length} source${docs.length === 1 ? "" : "s"} · ${health.knowledge_base?.chunks ?? 0} passages`
              : "Connecting to API…"}
          </span>
        </header>
        <main className="main" id="main" data-page={page} key={page}>
          {page === "workspace" && (
            <UserWorkspace session={session} docs={docs} onLibraryChange={refresh} />
          )}
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
          {page === "compare" && <ComparePapers docs={docs} />}
          {page === "events" && <Events />}
        </main>
      </div>
    </div>
  );
}

function formatEventDate(value) {
  if (!value) return "—";
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function UserWorkspace({ session, docs, onLibraryChange }) {
  const [mode, setMode] = useState("ask");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recents, setRecents] = useState([]);
  const [askResult, setAskResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paperResults, setPaperResults] = useState(null);
  const emptyLibrary = (docs || []).length === 0;

  const loadRecents = useCallback(async () => {
    try {
      const payload = await api.workspaceRecents(24);
      setRecents(payload.items || []);
    } catch {
      /* keep prior list */
    }
  }, []);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  async function submit(event) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    if (mode === "ask" && emptyLibrary) {
      setError("Add sources to your library before asking.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setSelected(null);
    try {
      if (mode === "ask") {
        const payload = await api.query({ query: text, include_trace: true });
        setAskResult(payload);
        setPaperResults(null);
        await onLibraryChange?.();
        await loadRecents();
      } else {
        const payload = await api.searchPapers(text);
        setPaperResults(payload);
        setAskResult(null);
        await api.savePaperSearch({
          query: text,
          provider: payload.provider || "unknown",
          papers: (payload.papers || []).slice(0, 20).map((paper) => ({
            paper_id: paper.paper_id,
            title: paper.title,
            authors: paper.authors || [],
            year: paper.year,
            source: paper.source,
            url: paper.url,
            pdf_url: paper.pdf_url,
            doi: paper.doi,
            venue: paper.venue,
            abstract: paper.abstract,
            open_access: paper.open_access,
            citation_count: paper.citation_count,
          })),
        });
        if (!payload.papers?.length) setMessage("No papers found. Try a more specific title or author.");
        await loadRecents();
      }
    } catch (err) {
      setError(err.message || "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openRecent(item) {
    setError("");
    setMessage("");
    setSelected(null);
    setQuery(item.query || "");
    if (item.kind === "ask") {
      setMode("ask");
      try {
        const saved = await api.historyItem(item.id);
        setAskResult(saved);
        setPaperResults(null);
      } catch (err) {
        setError(err.message || "Could not restore that Ask result.");
      }
      return;
    }
    setMode("papers");
    try {
      const saved = await api.paperSearchItem(item.id);
      setPaperResults({
        query: saved.query,
        provider: saved.provider,
        papers: saved.papers || [],
      });
      setAskResult(null);
    } catch (err) {
      setError(err.message || "Could not restore that paper search.");
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
      await onLibraryChange();
      if (result.ingested === "pdf") {
        setMessage(`Added “${paper.title}”. Full PDF indexed.`);
      } else {
        setMessage(
          `Added “${paper.title}”. Could not fetch a PDF. Abstract saved — use Open paper for the official copy.`
        );
      }
      if (result.warnings?.length) setError(result.warnings.join(" · "));
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(null);
    }
  }

  const askBadge = askResult ? verificationBadge(askResult) : null;

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Workspace</h2>
          <p>
            Welcome{session?.name ? `, ${session.name}` : ""}. Keep past Ask and paper searches in
            Recents, reopen them, and run the next search here.
          </p>
        </div>
      </div>

      <p className="workspace-library-hint status">
        {(docs || []).length
          ? `${docs.length} source${docs.length === 1 ? "" : "s"} in your library`
          : "Library is empty — Find papers or upload in Library, then Ask."}
      </p>

      <form className="card workspace-search" onSubmit={submit}>
        <div className="workspace-mode-chips" role="group" aria-label="Search mode">
          <button
            type="button"
            className={`chip${mode === "ask" ? " active" : ""}`}
            onClick={() => setMode("ask")}
          >
            Ask
          </button>
          <button
            type="button"
            className={`chip${mode === "papers" ? " active" : ""}`}
            onClick={() => setMode("papers")}
          >
            Find papers
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === "ask"
              ? emptyLibrary
                ? "Add library sources first, then ask…"
                : "Ask a question about your sources…"
              : "Paper title, topic, or author…"
          }
          disabled={mode === "ask" && emptyLibrary}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className={`primary${busy ? " is-busy" : ""}`}
            type="submit"
            disabled={busy || !query.trim() || (mode === "ask" && emptyLibrary)}
          >
            {busy ? (mode === "ask" ? "Checking sources…" : "Searching…") : mode === "ask" ? "Ask" : "Search"}
          </button>
          {paperResults?.provider && mode === "papers" && (
            <span className="status">Results from {String(paperResults.provider).replaceAll("_", " ")}</span>
          )}
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}

      <div className="workspace-panels">
        <div className="card">
          <h3>Recents</h3>
          {!recents.length ? (
            <p className="status" style={{ marginTop: 0 }}>
              No searches yet. Ask a question or find papers above — they stay here so you can continue.
            </p>
          ) : (
            <ul className="plain-list history">
              {recents.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button type="button" className="history-item" onClick={() => openRecent(item)}>
                    <span className="workspace-recent-main">
                      <span className={`workspace-kind ${item.kind}`}>
                        {item.kind === "ask" ? "Ask" : "Papers"}
                      </span>
                      <span>{item.query}</span>
                    </span>
                    <span className="status">
                      {item.kind === "ask"
                        ? `${(STATUS_COPY[item.status] || {}).label || item.status || "Ask"}${
                            item.confidence != null ? ` · ${pct(item.confidence)}` : ""
                          }`
                        : `${item.paper_count ?? 0} paper${(item.paper_count ?? 0) === 1 ? "" : "s"}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="workspace-active">
          {askResult && (
            <div className="card">
              <h3>Ask result</h3>
              {askBadge && (
                <div className="verify-block" style={{ marginBottom: 10 }}>
                  <span className={`flag ${askBadge.tone}`}>{askBadge.label}</span>
                </div>
              )}
              <AnswerView result={askResult} docs={docs} selected={selected} onSelect={setSelected} />
            </div>
          )}

          {paperResults && (
            <div className="workspace-paper-hits">
              <h3 className="workspace-active-heading">Paper hits</h3>
              {!(paperResults.papers || []).length ? (
                <p className="status">No papers in this search.</p>
              ) : (
                (paperResults.papers || []).map((paper) => (
                  <div key={`${paper.source}-${paper.paper_id}`} className="card paper-row">
                    <div>
                      <strong>{paper.title}</strong>
                      <div className="status" style={{ margin: "4px 0 0" }}>
                        {(paper.authors || []).slice(0, 8).join(", ") || "Unknown author"}
                        {paper.year ? ` · ${paper.year}` : ""}
                        {paper.venue ? ` · ${paper.venue}` : ""}
                      </div>
                      {paper.abstract && (
                        <p className="cite-snippet">
                          {paper.abstract.slice(0, 280)}
                          {paper.abstract.length > 280 ? "…" : ""}
                        </p>
                      )}
                    </div>
                    <div className="paper-actions">
                      {paperHref(paper) && (
                        <a className="ghost" href={paperHref(paper)} target="_blank" rel="noreferrer">
                          Open paper
                        </a>
                      )}
                      <button
                        type="button"
                        className="primary"
                        disabled={importing === paper.paper_id}
                        onClick={() => addPaper(paper)}
                      >
                        {importing === paper.paper_id ? "Adding…" : "Add to library"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!askResult && !paperResults && (
            <div className="card">
              <h3>Active research</h3>
              <p className="status" style={{ marginTop: 0 }}>
                Run a search or open a recent item to continue here.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const EVENT_TYPE_LABELS = {
  conference: "Conference",
  ieee: "IEEE",
  research_cfp: "Research CFP",
  workshop: "Workshop",
  hackathon: "Hackathon",
  meetup: "Meetup",
};

const EVENT_TYPE_ICONS = {
  conference: "▣",
  ieee: "⚡",
  research_cfp: "¶",
  workshop: "◇",
  hackathon: "⌘",
  meetup: "◎",
};

function Events() {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("all");
  const [city, setCity] = useState("");
  const [topic, setTopic] = useState("");
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("active");
  const [items, setItems] = useState([]);
  const [cities, setCities] = useState([]);
  const [topics, setTopics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [brokenIcons, setBrokenIcons] = useState({});

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const list = await api.events({ q, region, city, topic, event_type: eventType, status });
      setItems(list.events || []);
      setCities(list.cities || []);
      setTopics(list.topics || []);
      setBrokenIcons({});
    } catch (err) {
      setError(err.message || "Could not load events.");
    } finally {
      setBusy(false);
    }
  }, [q, region, city, topic, eventType, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Events</h2>
          <p>Current and upcoming conferences, IEEE, research CFPs, and hackathons — apply on the official site.</p>
        </div>
      </div>
      <div className="spotlight spotlight-magenta">
        <p className="spotlight-kicker">Live & upcoming</p>
        <p>Browse events happening now or coming up next. Filter by type and city, then open Apply now.</p>
      </div>
      <form
        className="card event-filters"
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events, cities, topics…"
          aria-label="Search events"
        />
        <div className="chips" style={{ marginTop: 12 }}>
          {[
            ["all", "All regions"],
            ["india", "India"],
            ["worldwide", "Worldwide"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${region === id ? " active" : ""}`}
              onClick={() => setRegion(id)}
            >
              {label}
            </button>
          ))}
          {[
            ["active", "Happening & upcoming"],
            ["live", "Happening now"],
            ["upcoming", "Upcoming"],
            ["open", "Registration open"],
            ["closed", "Registration closed"],
            ["past", "Past"],
          ].map(([id, label]) => (
            <button
              key={`status-${id}`}
              type="button"
              className={`chip${status === id ? " active" : ""}`}
              onClick={() => setStatus(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          <button
            type="button"
            className={`chip${!eventType ? " active" : ""}`}
            onClick={() => setEventType("")}
          >
            All types
          </button>
          {Object.entries(EVENT_TYPE_LABELS).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${eventType === id ? " active" : ""}`}
              onClick={() => setEventType(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="event-select">
            City
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">All cities</option>
              {cities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="event-select">
            Topic
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">All topics</option>
              {topics.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button className={`primary${busy ? " is-busy" : ""}`} type="submit" disabled={busy}>
            {busy ? "Loading…" : "Apply filters"}
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="event-grid">
        {items.map((item) => {
          const typeLabel = EVENT_TYPE_LABELS[item.event_type] || "Event";
          const typeIcon = EVENT_TYPE_ICONS[item.event_type] || "▣";
          const imageUrl = (item.image_url || "").trim();
          const showImg = Boolean(imageUrl) && !brokenIcons[item.event_id];
          const registrationOpen = item.registration_open !== false;
          const timing = item.timing || "upcoming";
          const timingLabel =
            timing === "live" ? "Happening now" : timing === "past" ? "Past" : "Upcoming";
          const timingTone = timing === "live" ? "good" : timing === "past" ? "neutral" : "neutral";
          return (
            <article key={item.event_id} className="card event-card">
              <div className={`event-media type-${item.event_type || "conference"}`}>
                {showImg ? (
                  <img
                    className="event-logo"
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() =>
                      setBrokenIcons((prev) => ({ ...prev, [item.event_id]: true }))
                    }
                  />
                ) : (
                  <span className="event-icon" aria-hidden="true">
                    {typeIcon}
                  </span>
                )}
                <span className="event-type-badge">{typeLabel}</span>
                {timing === "live" && <span className="event-live-badge">Live</span>}
              </div>
              <div className="event-card-body">
                <div className="event-card-top">
                  <h3>{item.name}</h3>
                  <span className={`flag ${item.region === "india" ? "good" : "neutral"}`}>
                    {item.region === "india" ? "India" : "Worldwide"}
                  </span>
                </div>
                <p className="event-location">
                  {item.city}, {item.country}
                  {item.venue ? ` · ${item.venue}` : ""}
                </p>
                <p className="status" style={{ marginTop: 6 }}>
                  <span className={`flag ${timingTone}`} style={{ marginRight: 8 }}>
                    {timingLabel}
                  </span>
                  {formatEventDate(item.start_date)} – {formatEventDate(item.end_date)}
                </p>
                <p className="status" style={{ marginTop: 4 }}>
                  {registrationOpen ? (
                    <>
                      {item.cfp_deadline ? `CFP ${formatEventDate(item.cfp_deadline)}` : ""}
                      {item.cfp_deadline && item.registration_deadline ? " · " : ""}
                      {item.registration_deadline
                        ? `Apply by ${formatEventDate(item.registration_deadline)}`
                        : !item.cfp_deadline
                          ? "Registration open"
                          : ""}
                    </>
                  ) : (
                    <span className="event-closed">Registration closed</span>
                  )}
                </p>
                {item.summary && <p className="event-summary">{item.summary}</p>}
                <div className="chips" style={{ marginTop: 10 }}>
                  {item.topics.map((tag) => (
                    <span key={tag} className="chip" style={{ cursor: "default" }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  {registrationOpen && (item.apply_url || item.website) ? (
                    <a
                      className="primary"
                      href={item.apply_url || item.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Apply now
                    </a>
                  ) : (
                    <span className="event-closed-pill">Registration closed</span>
                  )}
                  {item.website && item.website !== item.apply_url && (
                    <a className="ghost" href={item.website} target="_blank" rel="noreferrer">
                      Open site
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!busy && items.length === 0 && (
        <div className="card">
          <h3>No events match</h3>
          <p className="status">Try Happening & upcoming, or clear the city and topic filters.</p>
        </div>
      )}
    </>
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
          <div className="spotlight spotlight-violet">
            <p className="spotlight-kicker">Start here</p>
            <p>
              Upload sources first. Open Find papers to search academic indexes, or Library
              to upload your own files.
            </p>
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
            <button
              className={`primary${busy ? " is-busy" : ""}`}
              disabled={busy || emptyLibrary || !query.trim()}
              onClick={() => ask()}
            >
              {busy ? "Checking sources…" : "Ask"}
            </button>
            {error && <span className="error">{error}</span>}
          </div>
          {badge && (
            <div className="verify-block">
              <span className={`flag ${badge.tone}`}>{badge.label}</span>
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
      <div className="spotlight spotlight-orange">
        <p className="spotlight-kicker">Academic search</p>
        <p>Drop a title, topic, or author. Add open copies into the library, then ask against your own sources.</p>
      </div>
      <form className="card" style={{ marginBottom: 16 }} onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Paper title, topic, or author…"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className={`primary${busy ? " is-busy" : ""}`} type="submit" disabled={busy || !query.trim()}>
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
        <label className={`primary upload-btn${busy ? " is-busy" : ""}`}>
          {busy ? "Indexing…" : "Upload files"}
          <input type="file" multiple hidden disabled={busy} onChange={onUpload} />
        </label>
      </div>
      <div className="spotlight spotlight-violet">
        <p className="spotlight-kicker">Your sources</p>
        <p>Everything Ask retrieves from lives here — imported papers and files you upload.</p>
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

const STRUCTURE_COLUMNS = ["objective", "method", "dataset", "metric", "result", "limitation"];

function ComparePapers({ docs }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api.extractions();
      setRows(payload.papers || []);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, docs]);

  async function refreshAll() {
    setBusy(true);
    setError("");
    try {
      const payload = await api.refreshExtractions();
      setRows(payload.papers || []);
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
          <h2>Compare papers</h2>
          <p>
            Structured fields extracted once when a paper is added. Low-confidence cells stay visible and are marked.
          </p>
        </div>
        <button className="ghost" type="button" disabled={busy || !docs.length} onClick={refreshAll}>
          {busy ? "Extracting…" : "Re-extract library"}
        </button>
      </div>
      <div className="spotlight spotlight-magenta">
        <p className="spotlight-kicker">Side by side</p>
        <p>Objective, method, dataset, metric, result, limitation — extracted once per paper, kept even when confidence is low.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {!docs.length && (
        <div className="card">
          <h3>No sources yet</h3>
          <p className="status">Add papers in Library or Find papers. Comparison uses stored records, not a question.</p>
        </div>
      )}
      {docs.length > 0 && (
        <div className="card compare-wrap">
          <table className="compare-papers">
            <thead>
              <tr>
                <th>Paper</th>
                {STRUCTURE_COLUMNS.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const record = rows.find((row) => row.document_id === doc.document_id);
                return (
                  <tr key={doc.document_id}>
                    <td>
                      <strong>{doc.title || doc.name}</strong>
                      <div className="status" style={{ margin: 0 }}>
                        {(doc.authors || []).slice(0, 4).join(", ") || "Unknown author"}
                        {doc.year ? ` · ${doc.year}` : ""}
                      </div>
                    </td>
                    {STRUCTURE_COLUMNS.map((col) => {
                      const field = record?.fields?.[col];
                      const value = (field?.value || "").trim();
                      const missing = !value;
                      const low = Boolean(value && field?.low_confidence);
                      return (
                        <td key={col} className={missing || low ? "field-low" : ""}>
                          <span>{value || "—"}</span>
                          {low && (
                            <span className="flag warn low-flag" title="Extracted, but not clearly supported by this paper's passages">
                              Low
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="status" style={{ marginBottom: 0 }}>
            Empty cells mean that field was not found in the paper. A Low tag means a value was extracted but failed a support check — it is still shown.
          </p>
        </div>
      )}
    </>
  );
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

function claimMeta(claim) {
  const nli = String(claim?.nli_label || "").toLowerCase();
  if (nli === "supported") return CLAIM_META.SUPPORTED;
  if (nli === "contradicted") return CLAIM_META.CONTRADICTED;
  if (nli === "unsupported") {
    if (claim?.status === "PARTIALLY_SUPPORTED") return CLAIM_META.PARTIALLY_SUPPORTED;
    return CLAIM_META.UNSUPPORTED;
  }
  return CLAIM_META[claim?.status] || CLAIM_META.UNSUPPORTED;
}

function claimConfidence(claim) {
  if (claim?.nli_confidence != null && Number.isFinite(Number(claim.nli_confidence))) {
    return Number(claim.nli_confidence);
  }
  if (claim?.support_score != null && Number.isFinite(Number(claim.support_score))) {
    return Number(claim.support_score);
  }
  return null;
}

function sourceForClaim(claim, evidence) {
  const items = evidence || [];
  if (claim?.source_chunk_id) {
    const hit = items.find((item) => item.chunk_id === claim.source_chunk_id);
    if (hit) return hit;
  }
  const cite = claim?.supporting_citations?.[0] ?? claim?.contradicting_citations?.[0];
  if (cite != null) {
    return items.find((item) => item.citation_id === cite) || null;
  }
  return null;
}

function sourceHoverLabel(source, span) {
  if (!source) return "No source chunk tied to this claim";
  const heading = `[${source.citation_id}] ${source.title || source.document_name}`;
  const page = source.page != null ? ` · p. ${source.page}` : "";
  const body = span || source.text || "";
  return `${heading}${page}\n${body}`;
}

function looksLikeDumpedJson(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") && trimmed.includes('"answer"');
}

function visibleClaims(result) {
  return (result.claims || []).filter((claim) => !looksLikeDumpedJson(claim.text));
}

function shouldHideClaims(result) {
  const claims = visibleClaims(result);
  if (!claims.length) return true;
  if (looksLikeDumpedJson(result.answer)) return true;
  if (
    result.status === "INSUFFICIENT_EVIDENCE" &&
    claims.every((claim) => looksLikeDumpedJson(claim.text))
  ) {
    return true;
  }
  return false;
}

function ClaimCard({
  text,
  label,
  tone,
  confidence,
  source,
  span,
  onSelectSource,
  onCite,
  highlights = [],
}) {
  const [open, setOpen] = useState(false);
  const hover = sourceHoverLabel(source, span);

  return (
    <article className={`claim claim-card ${tone || ""}`}>
      <div className="claim-head">
        <span className={`flag ${tone || ""}`}>{label}</span>
        {confidence != null && (
          <span className="claim-conf" title="Verification confidence">
            {pct(confidence)}
          </span>
        )}
      </div>
      <div className="claim-text">
        {onCite ? (
          <AnswerText text={text} onCite={onCite} highlights={highlights} />
        ) : (
          text
        )}
      </div>
      <button
        type="button"
        className="claim-source-toggle"
        title={hover}
        onClick={() => {
          setOpen((value) => !value);
          if (source) onSelectSource?.(source);
        }}
      >
        {source ? `Source [${source.citation_id}]` : "No source chunk"}
      </button>
      {open && (
        <div className="claim-source">
          {source ? (
            <>
              <div className="cite">
                [{source.citation_id}] {source.title || source.document_name}
                {source.page != null ? ` · p. ${source.page}` : ""}
                {source.chunk_id ? ` · ${source.chunk_id}` : ""}
              </div>
              <p>{span || source.text}</p>
            </>
          ) : (
            <p className="status">No retrieved chunk is tied to this claim.</p>
          )}
        </div>
      )}
    </article>
  );
}

function AnswerView({ result, docs, selected, onSelect }) {
  const conf = result.confidence || {};
  const lastGate = (result.gate_decisions || []).at(-1);
  const [copied, setCopied] = useState("");
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
          {!result.unrelated_to_sources &&
            (result.status === "INSUFFICIENT_EVIDENCE" || looksLikeDumpedJson(result.answer)) && (
            <p className="status" style={{ marginTop: 0 }}>
              The indexed files do not contain enough support for a reliable answer.
            </p>
          )}
          {(result.claims || []).length > 0 && !shouldHideClaims(result) ? (
            <ul className="claim-list answer-claims">
              {visibleClaims(result).map((claim) => {
                const meta = claimMeta(claim);
                return (
                  <li key={claim.claim_id}>
                    <ClaimCard
                      text={claim.text}
                      label={meta.label}
                      tone={meta.tone}
                      confidence={claimConfidence(claim)}
                      source={sourceForClaim(claim, result.evidence)}
                      span={claim.best_evidence_span}
                      onSelectSource={(item) => item && onSelect(item)}
                      onCite={selectCite}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="answer">
              {!looksLikeDumpedJson(result.answer) && (
                <AnswerText
                  text={result.answer}
                  onCite={selectCite}
                />
              )}
            </div>
          )}
          <div className="export-bar">
            <button type="button" className="ghost" onClick={copyAnswer}>
              {copied === "copy" ? "Copied" : "Copy"}
            </button>
            <button type="button" className="ghost" onClick={saveAnswer}>
              Save
            </button>
            {copied === "failed" && <span className="error">Copy failed</span>}
          </div>
        </div>
        {contradictions.length > 0 && (
          <div className="card conflict-panel">
            <h3>Conflicting Evidence</h3>
            <p className="status" style={{ marginTop: 0 }}>
              Sources disagree. Both sides stay visible.
            </p>
            <ul className="claim-list">
              {contradictions.map((pair, index) => (
                <li key={`${pair.citation_a}-${pair.citation_b}-${index}`}>
                  <div className="conflict-pair">
                    <ClaimCard
                      text={pair.claim_a}
                      label="contradicted"
                      tone="warn"
                      source={evidenceByCite.get(pair.citation_a)}
                      onSelectSource={(item) => item && onSelect(item)}
                      onCite={selectCite}
                    />
                    <ClaimCard
                      text={pair.claim_b}
                      label="contradicted"
                      tone="warn"
                      source={evidenceByCite.get(pair.citation_b)}
                      onSelectSource={(item) => item && onSelect(item)}
                      onCite={selectCite}
                    />
                    {pair.explanation && <p className="status conflict-note">{pair.explanation}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
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

