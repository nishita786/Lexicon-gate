import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Logo } from "./Auth";
import { EmptyState, StatusBanner } from "./ui";
import { parseStoryHash, renderMarkdown, storyShareUrl } from "./markdown";

export const IEEE_SECTIONS = [
  ["abstract", "Abstract"],
  ["keywords", "Keywords"],
  ["introduction", "Introduction"],
  ["related_work", "Related Work"],
  ["methodology", "Methodology"],
  ["results", "Results"],
  ["discussion", "Discussion"],
  ["limitations", "Limitations"],
  ["conclusion", "Conclusion"],
  ["references", "References"],
];

function emptySections() {
  return Object.fromEntries(IEEE_SECTIONS.map(([key]) => [key, ""]));
}

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

async function saveBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function StoryReader({ slug, onClose, showSignIn }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [dlMessage, setDlMessage] = useState("");

  // IEEE papers: title / authors / affiliation are shown once in the chrome.
  // Only render section Markdown in the body (ignore legacy duplicated header in body_md).
  const bodyMarkdown = useMemo(() => {
    if (!story) return "";
    if (story.format === "ieee") {
      const parts = [];
      for (const [key, label] of IEEE_SECTIONS) {
        const text = (story.sections?.[key] || "").trim();
        if (text) parts.push(`## ${label}\n\n${text}`);
      }
      if (parts.length) return parts.join("\n\n");
    }
    return story.body_md || "";
  }, [story]);

  const html = useMemo(() => renderMarkdown(bodyMarkdown), [bodyMarkdown]);

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

  async function downloadDocx() {
    if (!story) return;
    try {
      const { blob, filename } = await api.downloadPublicStoryDocx(story.slug);
      await saveBlobFile(blob, filename);
      setDlMessage("Downloaded IEEE-style Word document (.docx).");
    } catch (err) {
      setError(err.message || "Download failed.");
    }
  }

  return (
    <article className="story-reader">
      <div className="story-reader-bar">
        <Logo size="nav" />
        <div className="story-reader-actions">
          {story ? (
            <button type="button" className="ghost" onClick={downloadDocx}>
              Download .docx
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
        <div className="story-reader-body ieee-reader">
          <p className="story-meta">
            {story.authors_line || story.author_name || "Anonymous"}
            {story.published_at ? ` · ${formatDate(story.published_at)}` : ""}
            {story.format === "ieee" ? " · IEEE format" : ""}
          </p>
          {story.affiliation ? <p className="ieee-affiliation">{story.affiliation}</p> : null}
          <h1>{story.title}</h1>
          <div className="story-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
    </article>
  );
}

export default function WritePage({ onOpenStory, session }) {
  const [tab, setTab] = useState("mine");
  const [mine, setMine] = useState([]);
  const [shared, setShared] = useState([]);
  const [feed, setFeed] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState("");
  const [authorsLine, setAuthorsLine] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [sections, setSections] = useState(() => emptySections());
  const [activeSection, setActiveSection] = useState("abstract");
  const [status, setStatus] = useState("draft");
  const [slug, setSlug] = useState("");
  const [collaborators, setCollaborators] = useState([]);
  const [storyInvites, setStoryInvites] = useState([]);
  const [authorUserId, setAuthorUserId] = useState("");
  const [myRole, setMyRole] = useState("owner");
  const [inviteRid, setInviteRid] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [readerSlug, setReaderSlug] = useState(null);

  const myUserId = session?.user_id || session?.id || "";
  const isOwner = myRole === "owner";
  const canEdit = myRole === "owner" || myRole === "editor";
  const canPublish = isOwner;
  const canDelete = isOwner;
  const readOnly = Boolean(selectedId) && !canEdit;

  const previewMd = useMemo(() => {
    const parts = [];
    if (title.trim()) parts.push(`# ${title.trim()}`);
    if (authorsLine.trim()) parts.push(`*${authorsLine.trim()}*`);
    if (affiliation.trim()) parts.push(affiliation.trim());
    for (const [key, label] of IEEE_SECTIONS) {
      const text = (sections[key] || "").trim();
      if (text) parts.push(`## ${label}\n\n${text}`);
    }
    return parts.join("\n\n");
  }, [title, authorsLine, affiliation, sections]);

  const previewHtml = useMemo(() => renderMarkdown(previewMd), [previewMd]);
  const hasContent =
    title.trim() ||
    authorsLine.trim() ||
    affiliation.trim() ||
    Object.values(sections).some((v) => (v || "").trim());
  const dirty = Boolean(selectedId || hasContent);
  const pendingOnStory = (storyInvites || []).filter((i) => i.status === "pending");

  function resolveRole(story) {
    if (!story) return "owner";
    if (story.author_user_id === myUserId) return "owner";
    const collab = (story.collaborators || []).find((c) => c.user_id === myUserId);
    return collab?.role || "viewer";
  }

  async function refreshLists() {
    const [myStories, sharedStories, publicStories, invites] = await Promise.all([
      api.listMyStories(),
      api.listSharedStories(),
      api.listPublicStories(40),
      api.listStoryInvitesPending(),
    ]);
    setMine(myStories.stories || []);
    setShared(sharedStories.stories || []);
    setFeed(publicStories.stories || []);
    setPendingInvites(invites.invites || []);
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
    setAuthorsLine("");
    setAffiliation("");
    setSections(emptySections());
    setActiveSection("abstract");
    setStatus("draft");
    setSlug("");
    setCollaborators([]);
    setStoryInvites([]);
    setAuthorUserId(myUserId);
    setMyRole("owner");
    setInviteRid("");
    setInviteRole("editor");
    setPreview(false);
  }

  function applyStory(story) {
    setSelectedId(story.story_id);
    setTitle(story.title || "");
    setAuthorsLine(story.authors_line || story.author_name || "");
    setAffiliation(story.affiliation || "");
    setSections({ ...emptySections(), ...(story.sections || {}) });
    setStatus(story.status || "draft");
    setSlug(story.slug || "");
    setCollaborators(story.collaborators || []);
    setStoryInvites(story.invites || []);
    setAuthorUserId(story.author_user_id || "");
    setMyRole(resolveRole(story));
  }

  async function loadStory(id) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const story = await api.getStory(id);
      applyStory(story);
      setTab("mine");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function payloadFromEditor() {
    return {
      title: title.trim() || "Untitled Paper",
      format: "ieee",
      authors_line: authorsLine,
      affiliation,
      sections,
      body_md: previewMd,
    };
  }

  async function saveStory() {
    if (readOnly) {
      setError("You have view-only access to this shared workspace.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = payloadFromEditor();
      let story;
      if (selectedId) {
        story = await api.updateStory(selectedId, payload);
      } else {
        story = await api.createStory(payload);
      }
      applyStory(story);
      setMessage(isOwner ? "Saved IEEE draft." : "Saved in shared workspace.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!canPublish) {
      setError("Only the paper owner can publish.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = payloadFromEditor();
      let id = selectedId;
      if (!id) {
        const created = await api.createStory(payload);
        id = created.story_id;
        applyStory(created);
      } else {
        await api.updateStory(id, payload);
      }
      const story = await api.publishStory(id);
      applyStory(story);
      setMessage("Published. Anyone with the link can read it.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!selectedId || !canPublish) return;
    setBusy(true);
    setError("");
    try {
      const story = await api.unpublishStory(selectedId);
      applyStory(story);
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
    if (!canDelete) {
      setError("Only the paper owner can delete this paper.");
      return;
    }
    if (!window.confirm("Delete this paper? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteStory(selectedId);
      resetEditor();
      setMessage("Paper deleted.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!slug) {
      setError("Publish the paper first, then copy its link.");
      return;
    }
    const url = storyShareUrl(slug);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setMessage(`Link copied: ${url}`);
        return;
      }
    } catch {
      /* fall through */
    }
    window.prompt("Copy this paper link:", url);
    setMessage(`Share link: ${url}`);
  }

  async function downloadDocx() {
    setBusy(true);
    setError("");
    try {
      let id = selectedId;
      if (!readOnly && (!id || hasContent)) {
        const payload = payloadFromEditor();
        if (!id) {
          const created = await api.createStory(payload);
          id = created.story_id;
          applyStory(created);
        } else {
          const updated = await api.updateStory(id, payload);
          applyStory(updated);
        }
        await refreshLists();
      }
      if (!id) {
        setError("Save the paper before downloading.");
        return;
      }
      const { blob, filename } = await api.downloadStoryDocx(id);
      await saveBlobFile(blob, filename);
      setMessage("Downloaded IEEE-style Word document (.docx).");
    } catch (err) {
      setError(err.message || "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!selectedId || !isOwner) return;
    const rid = inviteRid.trim();
    if (!rid) {
      setError("Enter a Researcher ID to invite.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.lookupResearcher(rid);
      await api.inviteStoryCollaborator(selectedId, {
        researcher_id: rid,
        role: inviteRole,
      });
      const story = await api.getStory(selectedId);
      applyStory(story);
      setInviteRid("");
      setMessage(
        `Invite sent as ${inviteRole}. They will see it under Shared with me after accepting.`
      );
      await refreshLists();
    } catch (err) {
      setError(err.message || "Could not send invite.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(inviteId) {
    if (!selectedId || !isOwner) return;
    setBusy(true);
    setError("");
    try {
      const story = await api.revokeStoryInvite(selectedId, inviteId);
      applyStory(story);
      setMessage("Invite revoked.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeCollabRole(userId, role) {
    if (!selectedId || !isOwner) return;
    setBusy(true);
    setError("");
    try {
      const story = await api.updateStoryCollaboratorRole(selectedId, userId, role);
      applyStory(story);
      setMessage(`Updated role to ${role}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCollab(userId) {
    if (!selectedId) return;
    const leaving = userId === myUserId;
    if (
      !window.confirm(
        leaving
          ? "Leave this shared workspace?"
          : "Remove this collaborator from the paper?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.removeStoryCollaborator(selectedId, userId);
      if (leaving) {
        resetEditor();
        setMessage("You left the shared workspace.");
        setTab("mine");
      } else {
        const story = await api.getStory(selectedId);
        applyStory(story);
        setMessage("Collaborator removed.");
      }
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptPending(inviteId) {
    setBusy(true);
    setError("");
    try {
      const story = await api.acceptStoryInvite(inviteId);
      applyStory(story);
      setTab("mine");
      setMessage("Joined shared workspace. You can edit or view based on your role.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function declinePending(inviteId) {
    setBusy(true);
    setError("");
    try {
      await api.declineStoryInvite(inviteId);
      setMessage("Invite declined.");
      await refreshLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function setSectionValue(key, value) {
    setSections((prev) => ({ ...prev, [key]: value }));
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
          <p>
            Draft in IEEE research-paper structure, invite teammates to a shared workspace, then
            download a Word (.docx) file or publish a public link.
          </p>
        </div>
        <div className="write-tabs">
          <button
            type="button"
            className={`ghost${tab === "mine" ? " active" : ""}`}
            onClick={() => setTab("mine")}
          >
            My papers
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

      {pendingInvites.length ? (
        <div className="write-invite-inbox">
          <h3>Paper invites</h3>
          <ul>
            {pendingInvites.map((inv) => (
              <li key={inv.invite_id}>
                <div>
                  <strong>{inv.story_title || "Untitled paper"}</strong>
                  <span className="muted">
                    {" "}
                    · {inv.invited_by_name || "Someone"} invited you as {inv.role}
                  </span>
                </div>
                <div className="write-invite-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => acceptPending(inv.invite_id)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => declinePending(inv.invite_id)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "discover" ? (
        <div className="story-feed">
          {!feed.length ? (
            <EmptyState title="No published papers yet">
              Be the first — write an IEEE draft in My papers and hit Publish.
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
                    {item.format === "ieee" ? " · IEEE" : ""}
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
                      const { blob, filename } = await api.downloadPublicStoryDocx(item.slug);
                      await saveBlobFile(blob, filename);
                      setMessage(`Downloaded “${item.title}” as .docx.`);
                    } catch (err) {
                      setError(err.message || "Could not download this paper.");
                    }
                  }}
                >
                  Download .docx
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="write-layout ieee-layout">
          <aside className="write-sidebar">
            <button type="button" className="primary" disabled={busy} onClick={resetEditor}>
              New IEEE paper
            </button>

            <div className="write-side-block">
              <h3 className="write-side-heading">My papers</h3>
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
                        {item.format === "ieee" ? " · IEEE" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!mine.length ? <p className="muted">No papers yet. Start a new IEEE draft.</p> : null}
            </div>

            <div className="write-side-block">
              <h3 className="write-side-heading">Shared with me</h3>
              <ul className="write-story-list write-shared-list">
                {shared.map((item) => (
                  <li key={item.story_id}>
                    <button
                      type="button"
                      className={`write-story-item${selectedId === item.story_id ? " active" : ""}`}
                      onClick={() => loadStory(item.story_id)}
                    >
                      <strong>{item.title}</strong>
                      <span className="flag">
                        {item.my_role || "viewer"}
                        {item.author_name ? ` · ${item.author_name}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!shared.length ? (
                <p className="muted">Accept an invite to join a shared editing workspace.</p>
              ) : null}
            </div>

            {selectedId ? (
              <div className="write-side-block write-collab-panel">
                <h3 className="write-side-heading">Collaborators</h3>
                <p className="muted write-collab-hint">
                  {isOwner
                    ? "Invite a teammate by Researcher ID — Editor can write sections; Viewer can only read."
                    : "People on this shared workspace."}
                </p>
                <ul className="write-collab-list">
                  <li className="write-collab-row">
                    <div>
                      <strong>You</strong>
                      <span className="muted"> · {myRole}</span>
                    </div>
                    {!isOwner ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => removeCollab(myUserId)}
                      >
                        Leave
                      </button>
                    ) : null}
                  </li>
                  {collaborators
                    .filter((c) => c.user_id !== myUserId)
                    .map((c) => (
                      <li key={c.user_id} className="write-collab-row">
                        <div>
                          <strong>{c.name || c.researcher_id || "Collaborator"}</strong>
                          <span className="muted">
                            {" "}
                            · {c.role}
                            {c.researcher_id ? ` · ${c.researcher_id}` : ""}
                          </span>
                        </div>
                        {isOwner ? (
                          <div className="write-collab-actions">
                            <select
                              value={c.role}
                              disabled={busy}
                              onChange={(e) => changeCollabRole(c.user_id, e.target.value)}
                              aria-label={`Role for ${c.name || c.researcher_id}`}
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button
                              type="button"
                              className="ghost"
                              disabled={busy}
                              onClick={() => removeCollab(c.user_id)}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                </ul>

                {isOwner ? (
                  <div className="write-invite-form">
                    <input
                      value={inviteRid}
                      onChange={(e) => setInviteRid(e.target.value.toUpperCase())}
                      placeholder="Researcher ID"
                      disabled={busy}
                      aria-label="Collaborator Researcher ID"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      disabled={busy}
                      aria-label="Invite role"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button type="button" className="primary" disabled={busy} onClick={sendInvite}>
                      Invite
                    </button>
                  </div>
                ) : null}

                {isOwner && pendingOnStory.length ? (
                  <ul className="write-pending-invites">
                    {pendingOnStory.map((inv) => (
                      <li key={inv.invite_id} className="write-collab-row">
                        <div>
                          <strong>{inv.recipient_name || inv.recipient_researcher_id}</strong>
                          <span className="muted"> · pending {inv.role}</span>
                        </div>
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => revokeInvite(inv.invite_id)}
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </aside>

          <section className="write-editor ieee-editor">
            {selectedId && !isOwner ? (
              <div className={`write-workspace-banner ${readOnly ? "view" : "edit"}`}>
                Shared workspace · {readOnly ? "View only" : "You can edit"}
                {authorUserId ? " · owner’s paper" : ""}
              </div>
            ) : null}
            <div className="ieee-badge">IEEE research paper format</div>
            <input
              className="write-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Paper title"
              disabled={busy || readOnly}
            />
            <input
              className="ieee-meta-input"
              value={authorsLine}
              onChange={(e) => setAuthorsLine(e.target.value)}
              placeholder="Author names (e.g. A. Researcher, B. Coauthor)"
              disabled={busy || readOnly}
            />
            <input
              className="ieee-meta-input"
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder="Affiliation / institution"
              disabled={busy || readOnly}
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
              <span className="write-status-pill">
                {status}
                {myRole !== "owner" ? ` · ${myRole}` : ""}
              </span>
            </div>

            {preview ? (
              <div
                className="story-prose write-preview ieee-preview"
                dangerouslySetInnerHTML={{
                  __html: previewHtml || "<p class='muted'>Fill sections to preview.</p>",
                }}
              />
            ) : (
              <div className="ieee-section-editor">
                <div className="ieee-section-nav" role="tablist" aria-label="Paper sections">
                  {IEEE_SECTIONS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeSection === key}
                      className={`ieee-section-tab${activeSection === key ? " active" : ""}${
                        (sections[key] || "").trim() ? " has-text" : ""
                      }`}
                      onClick={() => setActiveSection(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="ieee-section-label" htmlFor="ieee-section-body">
                  {IEEE_SECTIONS.find(([k]) => k === activeSection)?.[1] || "Section"}
                </label>
                <textarea
                  id="ieee-section-body"
                  className="write-body-input ieee-section-body"
                  value={sections[activeSection] || ""}
                  onChange={(e) => setSectionValue(activeSection, e.target.value)}
                  placeholder={
                    activeSection === "keywords"
                      ? "Comma-separated index terms…"
                      : activeSection === "references"
                        ? '[1] A. Author, “Title,” Journal, vol. x, no. y, pp. z–z, Year.'
                        : `Write the ${IEEE_SECTIONS.find(([k]) => k === activeSection)?.[1] || "section"}…`
                  }
                  disabled={busy || readOnly}
                  rows={14}
                />
              </div>
            )}

            <div className="write-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || !dirty || readOnly}
                onClick={saveStory}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              {canPublish ? (
                status === "published" ? (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || !selectedId}
                    onClick={unpublish}
                  >
                    Unpublish
                  </button>
                ) : (
                  <button type="button" className="ghost" disabled={busy || !dirty} onClick={publish}>
                    Publish
                  </button>
                )
              ) : null}
              <button
                type="button"
                className="ghost"
                disabled={busy || (!hasContent && !selectedId)}
                onClick={downloadDocx}
              >
                Download .docx
              </button>
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
              {canDelete ? (
                <button type="button" className="ghost" disabled={busy || !dirty} onClick={removeStory}>
                  Delete
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
