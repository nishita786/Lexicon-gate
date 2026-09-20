import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Logo } from "./Auth";
import { EmptyState, StatusBanner } from "./ui";
import { parseStoryHash, renderMarkdown, storyShareUrl, downloadStoryHtml } from "./markdown";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function StoryReader({ slug, onClose, showSignIn }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [dlMessage, setDlMessage] = useState("");
  const html = useMemo(() => renderMarkdown(story?.body_md || ""), [story?.body_md]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    setDlMessage("");
    api
      .getPublicStory(slug)
      .then((payload) => {
        if (!cancelled) setStory(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Story not found.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function download() {
    if (!story) return;
    downloadStoryHtml({
      title: story.title,
      body_md: story.body_md,
      author_name: story.author_name,
      published_at: story.published_at,
      status: "published",
    });
    setDlMessage("Downloaded as a styled HTML file.");
  }

  return (
    <article className="story-reader">
      <div className="story-reader-bar">
        <Logo size="nav" />
        <div className="story-reader-actions">
          {story ? (
            <button type="button" className="ghost" onClick={download}>
              Download
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          ) : null}
          {showSignIn ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.hash = "";
                onClose?.();
              }}
            >
              Sign in to write
            </button>
          ) : null}
        </div>
      </div>
      {busy ? <p className="muted">Loading story…</p> : null}
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {dlMessage ? <StatusBanner tone="success">{dlMessage}</StatusBanner> : null}
      {story ? (
        <div className="story-reader-body">
          <p className="story-meta">
            {story.author_name || "Anonymous"}
            {story.published_at ? ` · ${formatDate(story.published_at)}` : ""}
          </p>
          <h1>{story.title}</h1>
          <div className="story-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
    </article>
  );
}

export default function WritePage({ onOpenStory }) {
  const [tab, setTab] = useState("mine");
  const [mine, setMine] = useState([]);
  const [feed, setFeed] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("draft");
  const [slug, setSlug] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [readerSlug, setReaderSlug] = useState(null);

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);
  const dirty = Boolean(selectedId || title.trim() || body.trim());

  async function refreshLists() {
    const [myStories, publicStories] = await Promise.all([
      api.listMyStories(),
      api.listPublicStories(40),
    ]);
    setMine(myStories.stories || []);
    setFeed(publicStories.stories || []);
  }

  useEffect(() => {
    refreshLists().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const hashSlug = parseStoryHash();
    if (hashSlug) setReaderSlug(hashSlug);
    function onHash() {
      const next = parseStoryHash();
      if (next) setReaderSlug(next);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function resetEditor() {
    setSelectedId(null);
    setTitle("");
    setBody("");
    setStatus("draft");
    setSlug("");
    setPreview(false);
  }

  async function loadStory(id) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const story = await api.getStory(id);
      setSelectedId(story.story_id);
      setTitle(story.title || "");
      setBody(story.body_md || "");
      setStatus(story.status || "draft");
      setSlug(story.slug || "");
      setTab("mine");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveStory() {
    const cleanTitle = title.trim() || "Untitled";
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let story;
      if (selectedId) {
        story = await api.updateStory(selectedId, { title: cleanTitle, body_md: body });
      } else {
        story = await api.createStory({ title: cleanTitle, body_md: body });
        setSelectedId(story.story_id);
      }
      setTitle(story.title);
      setBody(story.body_md);
      setStatus(story.status);
      setSlug(story.slug);
      setMessage("Saved.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let id = selectedId;
      if (!id) {
        const created = await api.createStory({
          title: title.trim() || "Untitled",
          body_md: body,
        });
        id = created.story_id;
        setSelectedId(id);
      } else {
        await api.updateStory(id, { title: title.trim() || "Untitled", body_md: body });
      }
      const story = await api.publishStory(id);
      setStatus(story.status);
      setSlug(story.slug);
      setTitle(story.title);
      setBody(story.body_md);
      setMessage("Published. Anyone with the link can read it.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const story = await api.unpublishStory(selectedId);
      setStatus(story.status);
      setMessage("Unpublished. It is a draft again.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeStory() {
    if (!selectedId) {
      resetEditor();
      return;
    }
    if (!window.confirm("Delete this story? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteStory(selectedId);
      resetEditor();
      setMessage("Story deleted.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!slug) {
      setError("Publish the story first, then copy its link.");
      return;
    }
    const url = storyShareUrl(slug);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setError("");
      setMessage(`Link copied: ${url}`);
      return;
    }
    // Last resort: select-friendly prompt so the user can copy manually.
    window.prompt("Copy this story link:", url);
    setMessage(`Share link: ${url}`);
  }

  function downloadStory() {
    const cleanTitle = title.trim() || "Untitled";
    if (!title.trim() && !body.trim()) {
      setError("Write something before downloading.");
      return;
    }
    downloadStoryHtml({
      title: cleanTitle,
      body_md: body,
      published_at: status === "published" ? new Date().toISOString() : "",
      status,
    });
    setError("");
    setMessage("Downloaded as a styled HTML file.");
  }

  if (readerSlug) {
    return (
      <StoryReader
        slug={readerSlug}
        onClose={() => {
          window.location.hash = "";
          setReaderSlug(null);
          onOpenStory?.(null);
        }}
      />
    );
  }

  return (
    <div className="write-page">
      <div className="page-title">
        <div>
          <h2>Write</h2>
          <p>Draft freely in Markdown, then publish for anyone with the link.</p>
        </div>
        <div className="write-tabs">
          <button
            type="button"
            className={`ghost${tab === "mine" ? " active" : ""}`}
            onClick={() => setTab("mine")}
          >
            My stories
          </button>
          <button
            type="button"
            className={`ghost${tab === "discover" ? " active" : ""}`}
            onClick={() => setTab("discover")}
          >
            Discover
          </button>
        </div>
      </div>

      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}

      {tab === "discover" ? (
        <div className="story-feed">
          {!feed.length ? (
            <EmptyState title="No published stories yet">
              Be the first — write something in My stories and hit Publish.
            </EmptyState>
          ) : (
            feed.map((item) => (
              <div key={item.story_id} className="story-feed-card">
                <button
                  type="button"
                  className="story-feed-card-main"
                  onClick={() => {
                    window.location.hash = `#/s/${item.slug}`;
                    setReaderSlug(item.slug);
                  }}
                >
                  <strong>{item.title}</strong>
                  <span className="story-meta">
                    {item.author_name || "Anonymous"}
                    {item.published_at ? ` · ${formatDate(item.published_at)}` : ""}
                  </span>
                  {item.excerpt ? <p>{item.excerpt}</p> : null}
                </button>
                <button
                  type="button"
                  className="ghost story-feed-download"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setError("");
                    try {
                      const full = await api.getPublicStory(item.slug);
                      downloadStoryHtml({
                        title: full.title,
                        body_md: full.body_md,
                        author_name: full.author_name,
                        published_at: full.published_at,
                        status: "published",
                      });
                      setMessage(`Downloaded “${full.title}”.`);
                    } catch (err) {
                      setError(err.message || "Could not download this story.");
                    }
                  }}
                >
                  Download
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="write-layout">
          <aside className="write-sidebar">
            <button type="button" className="primary" disabled={busy} onClick={resetEditor}>
              New story
            </button>
            <ul className="write-story-list">
              {mine.map((item) => (
                <li key={item.story_id}>
                  <button
                    type="button"
                    className={`write-story-item${selectedId === item.story_id ? " active" : ""}`}
                    onClick={() => loadStory(item.story_id)}
                  >
                    <strong>{item.title}</strong>
                    <span className={`flag ${item.status === "published" ? "good" : ""}`}>
                      {item.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!mine.length ? <p className="muted">No stories yet. Start writing.</p> : null}
          </aside>

          <section className="write-editor">
            <input
              className="write-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              disabled={busy}
            />
            <div className="write-toolbar">
              <button
                type="button"
                className={`ghost${preview ? "" : " active"}`}
                onClick={() => setPreview(false)}
              >
                Edit
              </button>
              <button
                type="button"
                className={`ghost${preview ? " active" : ""}`}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
              <span className="write-status-pill">{status}</span>
            </div>
            {preview ? (
              <div
                className="story-prose write-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='muted'>Nothing to preview.</p>" }}
              />
            ) : (
              <textarea
                className="write-body-input"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write anything… Markdown works (headings, lists, **bold**, links)."
                disabled={busy}
                rows={18}
              />
            )}
            <div className="write-actions">
              <button type="button" className="primary" disabled={busy || !dirty} onClick={saveStory}>
                {busy ? "Saving…" : "Save"}
              </button>
              {status === "published" ? (
                <button type="button" className="ghost" disabled={busy || !selectedId} onClick={unpublish}>
                  Unpublish
                </button>
              ) : (
                <button type="button" className="ghost" disabled={busy || !dirty} onClick={publish}>
                  Publish
                </button>
              )}
              {status === "published" && slug ? (
                <>
                  <button type="button" className="ghost" onClick={copyLink}>
                    Copy link
                  </button>
                  <p className="write-share-url" title={storyShareUrl(slug)}>
                    {storyShareUrl(slug)}
                  </p>
                </>
              ) : null}
              <button
                type="button"
                className="ghost"
                disabled={busy || (!title.trim() && !body.trim())}
                onClick={downloadStory}
              >
                Download
              </button>
              <button type="button" className="ghost" disabled={busy || !dirty} onClick={removeStory}>
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
