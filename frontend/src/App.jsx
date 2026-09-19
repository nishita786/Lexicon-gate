import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ms, pct } from "./api";
import AuthScreen, { Logo } from "./Auth";

const NAV = [
  ["ask", "Ask"],
  ["find", "Find papers"],
  ["library", "Library"],
  ["compare", "Compare"],
  ["write", "Write paper"],
  ["events", "Events"],
];

const PAPER_SECTION_ORDER = [
  ["abstract", "Abstract"],
  ["keywords", "Keywords"],
  ["introduction", "I. Introduction"],
  ["related_work", "II. Related Work"],
  ["methodology", "III. Methodology"],
  ["results", "IV. Results / Discussion"],
  ["conclusion", "V. Conclusion"],
];

const STATUS_COPY = {
  ANSWERED: { label: "Answered", tone: "good" },
  INSUFFICIENT_EVIDENCE: { label: "Not enough evidence", tone: "warn" },
  CONFLICTING_EVIDENCE: { label: "Sources disagree", tone: "warn" },
  CLARIFICATION_NEEDED: { label: "Needs a clearer question", tone: "warn" },
  NO_RETRIEVAL_NEEDED: { label: "No documents needed", tone: "" },
};

export default function App() {
  const [session, setSession] = useState(undefined);
  const [page, setPage] = useState("ask");
  const [health, setHealth] = useState(null);
  const [docs, setDocs] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [history, setHistory] = useState([]);
  const [askScope, setAskScope] = useState(null);
  const [askDraft, setAskDraft] = useState("");
  const [chatEpoch, setChatEpoch] = useState(0);
  const [sidebarRecents, setSidebarRecents] = useState([]);
  const [activeRecentId, setActiveRecentId] = useState(null);
  const [findRestore, setFindRestore] = useState(null);
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

  const loadSidebarRecents = useCallback(async () => {
    if (!session) return;
    try {
      const payload = await api.workspaceRecents(24);
      setSidebarRecents(payload.items || []);
    } catch {
      /* keep prior list */
    }
  }, [session]);

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
      await loadSidebarRecents();
    } catch (err) {
      console.warn(err);
    }
  }, [session, loadSidebarRecents]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startNewChat() {
    setLastResult(null);
    setSelectedEvidence(null);
    setAskScope(null);
    setAskDraft("");
    setActiveRecentId(null);
    setFindRestore(null);
    setChatEpoch((n) => n + 1);
    setPage("ask");
  }

  async function openSidebarRecent(item) {
    setActiveRecentId(`${item.kind}:${item.id}`);
    if (item.kind === "ask") {
      setAskDraft(item.query || "");
      setSelectedEvidence(null);
      setAskScope(null);
      setChatEpoch((n) => n + 1);
      try {
        const saved = await api.historyItem(item.id);
        setLastResult(saved);
        setAskDraft(saved.query || item.query || "");
      } catch {
        setLastResult(null);
      }
      setPage("ask");
      return;
    }
    try {
      const saved = await api.paperSearchItem(item.id);
      setFindRestore({
        id: saved.search_id || item.id,
        query: saved.query,
        provider: saved.provider,
        papers: saved.papers || [],
      });
      setPage("find");
    } catch {
      setFindRestore(null);
    }
  }

  async function deleteSidebarRecent(item, event) {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const key = `${item.kind}:${item.id}`;
    try {
      if (item.kind === "ask") {
        await api.deleteRecentAsk(item.id);
      } else {
        await api.deleteRecentPapers(item.id);
      }
      if (activeRecentId === key) {
        setActiveRecentId(null);
        if (item.kind === "ask") {
          setLastResult(null);
          setSelectedEvidence(null);
          setAskScope(null);
          setAskDraft("");
          setChatEpoch((n) => n + 1);
        } else {
          setFindRestore(null);
        }
      }
      setHistory((prev) => (item.kind === "ask" ? prev.filter((h) => h.query_id !== item.id) : prev));
      await loadSidebarRecents();
    } catch (err) {
      console.warn(err);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* still leave the session locally */
    }
    setSession(null);
    setDocs([]);
    setLastResult(null);
    setSelectedEvidence(null);
    setAskScope(null);
    setAskDraft("");
    setHistory([]);
    setSidebarRecents([]);
    setActiveRecentId(null);
    setFindRestore(null);
    setPage("ask");
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
  }, [page, session, sidebarRecents.length]);

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
        <button type="button" className="new-chat-btn" onClick={startNewChat}>
          New Chat
        </button>
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
        <div className="sidebar-recents">
          <div className="sidebar-recents-label">Recents</div>
          {!sidebarRecents.length ? (
            <p className="sidebar-recents-empty">No chats yet. Ask or find papers to continue later.</p>
          ) : (
            <ul className="sidebar-recents-list">
              {sidebarRecents.map((item) => {
                const key = `${item.kind}:${item.id}`;
                return (
                  <li key={key} className="sidebar-recent-row">
                    <button
                      type="button"
                      className={`sidebar-recent-item${activeRecentId === key ? " active" : ""}`}
                      onClick={() => openSidebarRecent(item)}
                      title={item.query}
                    >
                      <span className={`sidebar-recent-kind ${item.kind}`}>
                        {item.kind === "ask" ? "Ask" : "Papers"}
                      </span>
                      <span className="sidebar-recent-title">{item.query}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-recent-delete"
                      aria-label={`Delete ${item.query || "recent"}`}
                      title="Delete"
                      onClick={(event) => deleteSidebarRecent(item, event)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
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
          {page === "ask" && (
            <Ask
              key={chatEpoch}
              docs={docs}
              query={askDraft}
              setQuery={setAskDraft}
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
          {page === "find" && (
            <FindPapers
              onImported={refresh}
              onRecentsChange={loadSidebarRecents}
              restore={findRestore}
            />
          )}
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
          {page === "write" && <WritePaper docs={docs} health={health} />}
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

function Ask({ docs, query, setQuery, result, setResult, selected, setSelected, history, onQueried, askScope, onClearScope }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const emptyLibrary = docs.length === 0;

  function toggleDoc(id) {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function ask(next = query) {
    const text = (next || "").trim();
    if (!text || emptyLibrary) return;
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const scopedIds = selectedDocIds.length
        ? selectedDocIds
        : askScope?.document_ids?.length
          ? askScope.document_ids
          : undefined;
      const payload = await api.query({
        query: text,
        include_trace: true,
        document_ids: scopedIds,
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
  const scopeLabel = selectedDocIds.length
    ? `${selectedDocIds.length} selected source${selectedDocIds.length === 1 ? "" : "s"}`
    : askScope?.label || "";

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
          {scopeLabel && (
            <div className="theme-chip-row">
              <span className="theme-chip">
                Asking in: {scopeLabel}
                <button
                  type="button"
                  className="theme-chip-clear"
                  onClick={() => {
                    setSelectedDocIds([]);
                    onClearScope?.();
                  }}
                  aria-label="Clear document filter"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          {!emptyLibrary && (
            <div className="ask-doc-pick" style={{ marginBottom: 10 }}>
              <div className="write-sources-head" style={{ marginBottom: 6 }}>
                <strong>Sources for this question</strong>
                <span className="status" style={{ margin: 0 }}>
                  {selectedDocIds.length ? "Selected docs only" : "All library (or theme)"}
                </span>
              </div>
              <div className="chips write-source-chips">
                {docs.map((doc) => {
                  const id = doc.document_id;
                  const active = selectedDocIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`chip${active ? " active" : ""}`}
                      onClick={() => toggleDoc(id)}
                    >
                      {doc.title || doc.name}
                    </button>
                  );
                })}
              </div>
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

function FindPapers({ onImported, onRecentsChange, restore }) {
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "academic", label: "Academic Papers" },
    { id: "research_web", label: "Research Websites" },
    { id: "open_access", label: "Open Access" },
  ];
  const [query, setQuery] = useState(restore?.query || "");
  const [filter, setFilter] = useState(restore?.filter || "all");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(
    restore
      ? { query: restore.query, provider: restore.provider, papers: restore.papers || [], notes: restore.notes || [] }
      : null
  );

  useEffect(() => {
    if (!restore?.id) return;
    setQuery(restore.query || "");
    setFilter(restore.filter || "all");
    setResults({
      query: restore.query,
      provider: restore.provider,
      papers: restore.papers || [],
      notes: restore.notes || [],
      filter: restore.filter,
    });
    setError("");
    setMessage("");
  }, [restore?.id]);

  async function search(event) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await api.searchPapers(text, { filter });
      setResults(payload);
      await api.savePaperSearch({
        query: text,
        provider: payload.provider || "unknown",
        filter,
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
          summary: paper.summary,
          open_access: paper.open_access,
          citation_count: paper.citation_count,
          result_kind: paper.result_kind,
          full_text_available: paper.full_text_available,
        })),
      });
      await onRecentsChange?.();
      if (payload.notes?.length) setMessage(payload.notes.join(" "));
      if (!payload.papers?.length) {
        setMessage((prev) => prev || "No results. Try another filter or a more specific query.");
      }
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
        summary: paper.summary,
        doi: paper.doi,
        pdf_url: paper.pdf_url,
        url: paper.url,
        result_kind: paper.result_kind,
      });
      await onImported();
      if (result.ingested === "pdf") {
        setMessage(`Added “${paper.title}”. Full PDF indexed. Ask over it from Ask.`);
      } else if (result.ingested === "web") {
        setMessage(`Added “${paper.title}”. Page text indexed (no open PDF).`);
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

  function availabilityLabel(paper) {
    if (paper.full_text_available || paper.pdf_url) return { text: "Full text", tone: "good" };
    if (paper.result_kind === "web") return { text: "Web page", tone: "" };
    return { text: "Abstract only", tone: "warn" };
  }

  function canAdd(paper) {
    return Boolean(
      paper.pdf_url ||
        paper.full_text_available ||
        paper.open_access ||
        paper.abstract ||
        paper.summary ||
        paper.url
    );
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Find papers</h2>
          <p>
            Search academic indexes and research websites. Prefer open-access PDFs when adding to Library, then Ask.
          </p>
        </div>
      </div>
      <div className="spotlight spotlight-orange">
        <p className="spotlight-kicker">Unified search</p>
        <p>Filter by All, Academic Papers, Research Websites, or Open Access. Full PDFs are indexed when legally available.</p>
      </div>
      <form className="card" style={{ marginBottom: 16 }} onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Paper title, topic, author, or research question…"
        />
        <div className="chips find-filter-chips" style={{ marginTop: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className={`primary${busy ? " is-busy" : ""}`} type="submit" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
          {results?.provider && (
            <span className="status">
              Results from {(results.providers_used || String(results.provider).split("+")).filter(Boolean).join(", ").replaceAll("_", " ") || results.provider}
            </span>
          )}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      {(results?.papers || []).map((paper) => {
        const avail = availabilityLabel(paper);
        const blurb = paper.summary || paper.abstract || "";
        return (
          <div key={`${paper.source}-${paper.paper_id}`} className="card paper-row">
            <div>
              <strong>{paper.title}</strong>
              <div className="status" style={{ margin: "4px 0 0" }}>
                <span className="paper-source-badge">{(paper.source || "").replaceAll("_", " ")}</span>
                {(paper.authors || []).slice(0, 8).join(", ") || (paper.result_kind === "web" ? "Web result" : "Unknown author")}
                {paper.year ? ` · ${paper.year}` : ""}
                {paper.venue ? ` · ${paper.venue}` : ""}
                {paper.citation_count ? ` · cited ${paper.citation_count}` : ""}
              </div>
              {paper.url && (
                <div className="status" style={{ margin: "2px 0 0", wordBreak: "break-all" }}>
                  {paper.url}
                </div>
              )}
              <div className="paper-flags" style={{ marginTop: 8 }}>
                {paper.open_access && <span className="flag good">Open access</span>}
                <span className={`flag ${avail.tone}`.trim()}>{avail.text}</span>
              </div>
              {blurb && (
                <p className="cite-snippet">
                  {blurb.slice(0, 360)}
                  {blurb.length > 360 ? "…" : ""}
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
                className="primary"
                disabled={importing === paper.paper_id || !canAdd(paper)}
                onClick={() => addPaper(paper)}
              >
                {importing === paper.paper_id ? "Adding…" : "Add to library"}
              </button>
            </div>
          </div>
        );
      })}
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
  const [extractBusy, setExtractBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);

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

  function toggleSource(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function refreshAll() {
    setExtractBusy(true);
    setError("");
    try {
      const payload = await api.refreshExtractions();
      setRows(payload.papers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setExtractBusy(false);
    }
  }

  async function runCompare() {
    const text = question.trim();
    if (!text || selectedIds.length < 2) return;
    setBusy(true);
    setError("");
    setSelectedEvidence(null);
    try {
      const payload = await api.query({
        query: text,
        document_ids: selectedIds,
        include_trace: true,
      });
      setResult(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const badge = result ? verificationBadge(result) : null;
  const canAsk = selectedIds.length >= 2 && question.trim() && !busy;

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Compare papers</h2>
          <p>
            Side-by-side structure fields, plus a multi-paper question over sources you select.
          </p>
        </div>
        <button className="ghost" type="button" disabled={extractBusy || !docs.length} onClick={refreshAll}>
          {extractBusy ? "Extracting…" : "Re-extract library"}
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
          <p className="status">Add papers in Library or Find papers, then compare structure or ask across two or more sources.</p>
        </div>
      )}
      {docs.length > 0 && (
        <>
          <div className="card compare-qa">
            <h3>Ask across papers</h3>
            <p className="status" style={{ marginTop: 0 }}>
              Select at least two library papers, then ask about similarities, differences, methods, findings, or limitations.
            </p>
            <div className="write-sources">
              <div className="write-sources-head">
                <strong>Papers to compare</strong>
                <span className="status" style={{ margin: 0 }}>
                  {selectedIds.length ? `${selectedIds.length} selected` : "Select 2+"}
                </span>
              </div>
              <div className="chips write-source-chips">
                {docs.map((doc) => {
                  const id = doc.document_id;
                  const active = selectedIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`chip${active ? " active" : ""}`}
                      onClick={() => toggleSource(id)}
                    >
                      {doc.title || doc.name}
                    </button>
                  );
                })}
              </div>
              {selectedIds.length > 0 && selectedIds.length < 2 && (
                <p className="status">Select at least two papers to run a comparison question.</p>
              )}
            </div>
            <label>
              Comparison question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. How do these papers differ in method and limitations?"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canAsk) runCompare();
                  }
                }}
              />
            </label>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className={`primary${busy ? " is-busy" : ""}`}
                type="button"
                disabled={!canAsk}
                onClick={runCompare}
              >
                {busy ? "Comparing…" : "Compare"}
              </button>
              {badge && <span className={`flag ${badge.tone}`}>{badge.label}</span>}
            </div>
          </div>

          {result && (
            <CompareResultView
              result={result}
              selectedDocIds={selectedIds}
              docs={docs}
              selected={selectedEvidence}
              onSelect={setSelectedEvidence}
            />
          )}

          <div className="card compare-wrap">
            <h3>Structure table</h3>
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
        </>
      )}
    </>
  );
}

function claimPaperLabels(claim, evidenceByCite) {
  const cites = claim.supporting_citations || [];
  const names = [];
  const seen = new Set();
  for (const cite of cites) {
    const item = evidenceByCite.get(cite);
    if (!item) continue;
    const label = item.title || item.document_name;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    names.push(label);
  }
  return names;
}

function CompareResultView({ result, selectedDocIds, docs, selected, onSelect }) {
  const evidenceByCite = useMemo(() => {
    const map = new Map();
    for (const item of result.evidence || []) map.set(item.citation_id, item);
    return map;
  }, [result.evidence]);

  const evidenceByPaper = useMemo(() => {
    const groups = new Map();
    for (const item of result.evidence || []) {
      const key = item.document_id || item.document_name || "unknown";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: item.title || item.document_name || "Source",
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }
    return [...groups.values()];
  }, [result.evidence]);

  const claims = result.claims || [];
  const usedIds = new Set((result.evidence || []).map((item) => item.document_id).filter(Boolean));
  const unusedSelected = docs.filter(
    (d) => selectedDocIds.includes(d.document_id) && !usedIds.has(d.document_id),
  );

  function selectCite(id) {
    const item = evidenceByCite.get(id);
    if (item) onSelect(item);
  }

  return (
    <div className="compare-result">
      <div className="card">
        <h3>Comparison answer</h3>
        {result.unrelated_to_sources && (
          <p className="status" style={{ marginTop: 0 }}>
            This question is not covered by the selected papers.
          </p>
        )}
        {!result.unrelated_to_sources &&
          (result.status === "INSUFFICIENT_EVIDENCE" || looksLikeDumpedJson(result.answer)) && (
            <p className="status" style={{ marginTop: 0 }}>
              The selected papers do not contain enough support for a reliable comparison.
            </p>
          )}
        <div className="answer">
          {!looksLikeDumpedJson(result.answer) && (result.answer || "").trim() && (
            <AnswerText text={result.answer} onCite={selectCite} />
          )}
        </div>
        {(result.status === "INSUFFICIENT_EVIDENCE" || result.unrelated_to_sources) &&
          result.mismatch_detail && (
          <p className="status" style={{ marginTop: 8 }}>
            {result.mismatch_detail}
          </p>
        )}
      </div>

      <div className="card">
        <h3>Claims by paper</h3>
        {!claims.length ? (
          <p className="status">No claims were extracted for this answer.</p>
        ) : (
          <ul className="claim-list compare-claim-list">
            {claims.map((claim) => {
              const papers = claimPaperLabels(claim, evidenceByCite);
              const tone =
                claim.status === "SUPPORTED"
                  ? "good"
                  : claim.status === "PARTIALLY_SUPPORTED"
                    ? "warn"
                    : "bad";
              return (
                <li key={claim.claim_id}>
                  <div className="compare-claim-head">
                    <span className={`flag ${tone}`}>{claim.status.replace(/_/g, " ")}</span>
                    {papers.length > 0 ? (
                      <span className="status" style={{ margin: 0 }}>
                        {papers.join(" · ")}
                      </span>
                    ) : (
                      <span className="status" style={{ margin: 0 }}>
                        No supporting paper cited
                      </span>
                    )}
                  </div>
                  <p className="compare-claim-text">{claim.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Evidence by paper</h3>
        {!evidenceByPaper.length ? (
          <p className="status">No passages were retrieved.</p>
        ) : (
          evidenceByPaper.map((group) => (
            <div key={group.key} className="compare-evidence-group">
              <h4>{group.title}</h4>
              <div className="evidence-list">
                {group.items.map((item) => (
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
          ))
        )}
        {unusedSelected.length > 0 && (
          <p className="status">
            Not represented in retrieved evidence:{" "}
            {unusedSelected.map((d) => d.title || d.name).join(", ")}
          </p>
        )}
      </div>

      {(result.hallucination?.flags || []).length > 0 && (
        <div className="card">
          <h3>Verification notes</h3>
          <p className="error">{result.hallucination.flags.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

function WritePaper({ docs, health }) {
  const [prompt, setPrompt] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [draft, setDraft] = useState(null);
  const [past, setPast] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const saveTimer = useRef(null);
  const progressTimer = useRef(null);

  const GEN_STEPS = [
    "Retrieving Library evidence…",
    "Outlining manuscript and figures…",
    "Writing Introduction…",
    "Writing Related Work…",
    "Writing Methodology…",
    "Writing Results…",
    "Writing Abstract and Conclusion…",
    "Drawing original figures…",
  ];

  const llmName = health?.llm?.name || health?.llm_provider?.name || "";
  const llmModel = health?.llm?.model || health?.llm_provider?.model || "";
  const isExtractive = llmName === "extractive" || health?.llm?.deterministic;
  const providerLabel = llmName
    ? `${llmName}${llmModel ? ` · ${llmModel}` : ""}`
    : "unknown";

  const loadPast = useCallback(async () => {
    try {
      const payload = await api.listPaperDrafts();
      setPast(payload.drafts || []);
    } catch {
      /* ignore list errors on mount */
    }
  }, []);

  const refreshPreview = useCallback(async (draftId) => {
    if (!draftId) {
      setPreviewHtml("");
      return;
    }
    setPreviewBusy(true);
    try {
      const html = await api.previewPaperDraft(draftId);
      setPreviewHtml(html);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewBusy(false);
    }
  }, []);

  useEffect(() => {
    loadPast();
  }, [loadPast]);

  useEffect(() => {
    if (!draft?.draft_id) {
      setPreviewHtml("");
      return;
    }
    refreshPreview(draft.draft_id);
  }, [draft?.draft_id, draft?.updated_at, refreshPreview]);

  useEffect(() => {
    if (!previewHtml) {
      setPreviewSrc("");
      return undefined;
    }
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setPreviewSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [previewHtml]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  function toggleSource(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function startProgressCycle() {
    let i = 0;
    setProgressMsg(GEN_STEPS[0]);
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      i = Math.min(i + 1, GEN_STEPS.length - 1);
      setProgressMsg(GEN_STEPS[i]);
    }, 2200);
  }

  function stopProgressCycle() {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
  }

  async function generate() {
    const text = prompt.trim();
    if (!text) {
      setError("Enter a topic or prompt for the paper.");
      return;
    }
    if (selectedIds.length < 2) {
      setError("");
    }
    setBusy(true);
    setError("");
    startProgressCycle();
    try {
      const created = await api.createPaperDraft({
        prompt: text,
        format: "ieee_conference",
        document_ids: selectedIds,
        title_hint: titleHint.trim() || undefined,
      });
      setDraft(created);
      setSavedAt(created.updated_at);
      setEditorsOpen(false);
      const last = (created.generation_steps || []).slice(-1)[0];
      setProgressMsg(last || "Draft ready.");
      await loadPast();
    } catch (err) {
      setError(err.message);
      setProgressMsg("");
    } finally {
      stopProgressCycle();
      setBusy(false);
    }
  }

  function scheduleSave(next) {
    setDraft(next);
    if (!next?.draft_id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError("");
      try {
        const updated = await api.updatePaperDraft(next.draft_id, {
          title: next.title,
          authors: next.authors,
          sections: next.sections,
          references: next.references,
        });
        setDraft(updated);
        setSavedAt(updated.updated_at);
        await loadPast();
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    }, 700);
  }

  function patchField(field, value) {
    if (!draft) return;
    scheduleSave({ ...draft, [field]: value });
  }

  function patchSection(key, value) {
    if (!draft) return;
    scheduleSave({
      ...draft,
      sections: { ...(draft.sections || {}), [key]: value },
    });
  }

  function patchReferences(text) {
    if (!draft) return;
    const references = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    scheduleSave({ ...draft, references });
  }

  async function saveNow() {
    if (!draft?.draft_id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    setError("");
    try {
      const updated = await api.updatePaperDraft(draft.draft_id, {
        title: draft.title,
        authors: draft.authors,
        sections: draft.sections,
        references: draft.references,
      });
      setDraft(updated);
      setSavedAt(updated.updated_at);
      await loadPast();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function download(format) {
    if (!draft?.draft_id) return;
    setExporting(format);
    setError("");
    try {
      const { blob, filename } = await api.exportPaperDraft(draft.draft_id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting("");
    }
  }

  async function openPast(id) {
    setError("");
    try {
      const item = await api.getPaperDraft(id);
      setDraft(item);
      setPrompt(item.prompt || "");
      setSelectedIds(item.document_ids || []);
      setSavedAt(item.updated_at);
      setEditorsOpen(false);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>Write paper</h2>
          <p>
            Topic on the left; live IEEE two-column manuscript on the right. Select 2–3 Library papers for grounded citations, then generate an elaborated draft with original figures.
          </p>
        </div>
      </div>

      <div className="write-split">
        <div className="write-split-left">
          <div className="card write-paper-setup">
            <label>
              Paper topic / prompt
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Self-RAG: retrieval-augmented generation with self-reflection"
                rows={4}
              />
            </label>
            <div className="write-paper-meta">
              <label>
                Title hint (optional)
                <input
                  value={titleHint}
                  onChange={(e) => setTitleHint(e.target.value)}
                  placeholder="Suggested manuscript title"
                />
              </label>
              <div className="write-format-chip">
                <span className="chip active">IEEE conference</span>
              </div>
            </div>
            <div className="write-sources">
              <div className="write-sources-head">
                <strong>Reference papers (Library)</strong>
                <span className="status" style={{ margin: 0 }}>
                  Select 2–3 for best quality
                </span>
              </div>
              {!docs.length ? (
                <p className="status">
                  Add papers via Find papers or Library first, then select them here for grounded citations.
                </p>
              ) : (
                <div className="chips write-source-chips">
                  {docs.map((doc) => {
                    const id = doc.document_id;
                    const active = selectedIds.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`chip${active ? " active" : ""}`}
                        onClick={() => toggleSource(id)}
                      >
                        {doc.title || doc.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedIds.length > 0 && selectedIds.length < 2 && (
                <p className="status">Tip: selecting at least two papers improves related work and citations.</p>
              )}
            </div>
            <div className={`write-llm-panel${isExtractive ? " write-llm-warn" : ""}`}>
              <div className="write-llm-chip-row">
                <span className="write-llm-chip" title="Active LLM from /api/health">
                  Provider: {providerLabel}
                </span>
              </div>
              {isExtractive ? (
                <div className="write-llm-setup">
                  <p className="write-llm-setup-title">Full drafting needs a language model</p>
                  <p className="status write-llm-hint">
                    Extractive / offline mode only builds a short skeleton (about one page). It cannot
                    produce 10-page IEEE drafts. Enable OpenAI or Ollama, then regenerate.
                  </p>
                  <ol className="write-llm-steps">
                    <li>
                      Copy <code>.env.example</code> to <code>.env</code> in the project root.
                    </li>
                    <li>
                      Set <code>SELFRAG_OPENAI_API_KEY=…</code> <strong>or</strong> run Ollama and set{" "}
                      <code>SELFRAG_OLLAMA_MODEL</code> (optional: leave <code>SELFRAG_LLM_PROVIDER=auto</code>).
                    </li>
                    <li>Restart the backend, then confirm this chip shows <code>openai</code> or <code>ollama</code>.</li>
                  </ol>
                </div>
              ) : (
                <p className="status write-llm-hint">
                  Conference-style multi-pass drafting via {providerLabel} targets ~10+ IEEE two-column
                  pages. Select 2–3 Library papers for grounded citations and originality.
                </p>
              )}
            </div>
            {busy && progressMsg && <p className="write-progress">{progressMsg}</p>}
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" className="primary" disabled={busy || !prompt.trim()} onClick={generate}>
                {busy ? "Generating…" : draft ? "Regenerate" : "Generate paper"}
              </button>
            </div>
            <p className="status" style={{ marginBottom: 0 }}>
              AI drafts are strong starting manuscripts — not a guarantee of conference acceptance. Review claims, figures, and citations before submit.
            </p>
          </div>

          {past.length > 0 && (
            <div className="card write-past-card">
              <h3>Recent drafts</h3>
              <ul className="write-past-list">
                {past.slice(0, 6).map((item) => (
                  <li key={item.draft_id}>
                    <button type="button" className="ghost write-past-item" onClick={() => openPast(item.draft_id)}>
                      <strong>{item.title || "Untitled"}</strong>
                      <span className="status">{item.grounded ? "Grounded" : "Outline"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft && (
            <div className="card write-paper-editor">
              <div className="write-editor-bar">
                <div>
                  <h3 style={{ margin: 0 }}>Draft controls</h3>
                  <p className="status" style={{ margin: "4px 0 0" }}>
                    {draft.grounded ? "Grounded" : "Exploratory outline"}
                    {saving ? " · Saving…" : savedAt ? " · Saved" : ""}
                  </p>
                </div>
                <div className="actions">
                  <button type="button" className="ghost" disabled={saving} onClick={saveNow}>
                    Save
                  </button>
                  <button type="button" disabled={!!exporting} onClick={() => download("docx")}>
                    {exporting === "docx" ? "DOCX…" : "DOCX"}
                  </button>
                  <button type="button" disabled={!!exporting} onClick={() => download("pdf")}>
                    {exporting === "pdf" ? "PDF…" : "PDF"}
                  </button>
                </div>
              </div>
              {(draft.notes || []).length > 0 && (
                <ul className="write-notes">
                  {draft.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              <label>
                Title
                <input value={draft.title || ""} onChange={(e) => patchField("title", e.target.value)} />
              </label>
              <label>
                Authors
                <input value={draft.authors || ""} onChange={(e) => patchField("authors", e.target.value)} />
              </label>
              <button
                type="button"
                className="ghost write-editors-toggle"
                onClick={() => setEditorsOpen((o) => !o)}
              >
                {editorsOpen ? "Hide section editors" : "Edit sections"}
              </button>
              {editorsOpen && (
                <div className="write-section-editors">
                  {PAPER_SECTION_ORDER.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <textarea
                        className="write-section"
                        rows={key === "keywords" ? 2 : 5}
                        value={(draft.sections && draft.sections[key]) || ""}
                        onChange={(e) => patchSection(key, e.target.value)}
                      />
                    </label>
                  ))}
                  <label>
                    References (one per line)
                    <textarea
                      className="write-section"
                      rows={4}
                      value={(draft.references || []).join("\n")}
                      onChange={(e) => patchReferences(e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="write-split-right">
          <div className="write-preview-frame card">
            <div className="write-preview-bar">
              <span className="write-preview-label">IEEE conference preview</span>
              {previewBusy && <span className="status">Updating…</span>}
            </div>
            {!draft ? (
              <div className="write-preview-empty">
                <p>Generate a paper to see the live IEEE two-column layout here.</p>
              </div>
            ) : previewSrc ? (
              <iframe
                className="write-preview-iframe"
                title="IEEE paper preview"
                src={previewSrc}
              />
            ) : (
              <div className="write-preview-empty">
                <p>{previewBusy ? "Building preview…" : "Preview unavailable."}</p>
              </div>
            )}
          </div>
        </div>
      </div>
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
  if ((result.uncovered_aspects || []).length > 0) {
    return { label: "Partially supported", tone: "warn" };
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
          <div className="answer">
            {!looksLikeDumpedJson(result.answer) && (result.answer || "").trim() && (
              <AnswerText
                text={result.answer}
                onCite={selectCite}
              />
            )}
          </div>
          {(result.status === "INSUFFICIENT_EVIDENCE" || result.unrelated_to_sources) &&
            result.mismatch_detail && (
            <p className="status" style={{ marginTop: 8 }}>
              {result.mismatch_detail}
            </p>
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

