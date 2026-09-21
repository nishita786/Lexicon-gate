import { useEffect, useState } from "react";
import { api } from "./api";
import { EmptyState, StatusBanner } from "./ui";

/**
 * Main-nav Collaborators hub: Researcher ID, invites, shared workspaces,
 * and inviting teammates onto your IEEE papers.
 */
export default function CollaboratorsPage({ session, onOpenPaper }) {
  const [mine, setMine] = useState([]);
  const [shared, setShared] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [story, setStory] = useState(null);
  const [inviteRid, setInviteRid] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const myUserId = session?.user_id || session?.id || "";
  const myRid = session?.researcher_id || "";
  const isOwner = story && story.author_user_id === myUserId;
  const pendingOnStory = (story?.invites || []).filter((i) => i.status === "pending");

  async function refresh() {
    const [myStories, sharedStories, invites] = await Promise.all([
      api.listMyStories(),
      api.listSharedStories(),
      api.listStoryInvitesPending(),
    ]);
    setMine(myStories.stories || []);
    setShared(sharedStories.stories || []);
    setPendingInvites(invites.invites || []);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function selectPaper(id) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await api.getStory(id);
      setSelectedId(id);
      setStory(payload);
    } catch (err) {
      setError(err.message);
      setStory(null);
      setSelectedId(null);
    } finally {
      setBusy(false);
    }
  }

  async function copyRid() {
    if (!myRid) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(myRid);
        setCopied(true);
        setMessage(`Copied your Researcher ID: ${myRid}`);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
    } catch {
      /* fall through */
    }
    window.prompt("Copy your Researcher ID:", myRid);
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
      const updated = await api.getStory(selectedId);
      setStory(updated);
      setInviteRid("");
      setMessage(`Invite sent as ${inviteRole}.`);
      await refresh();
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
      const updated = await api.revokeStoryInvite(selectedId, inviteId);
      setStory(updated);
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
      const updated = await api.updateStoryCollaboratorRole(selectedId, userId, role);
      setStory(updated);
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
        setSelectedId(null);
        setStory(null);
        setMessage("You left the shared workspace.");
      } else {
        const updated = await api.getStory(selectedId);
        setStory(updated);
        setMessage("Collaborator removed.");
      }
      await refresh();
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
      const accepted = await api.acceptStoryInvite(inviteId);
      setMessage("Joined shared workspace.");
      await refresh();
      await selectPaper(accepted.story_id);
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
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="collab-page">
      <div className="page-title">
        <div>
          <h2>Collaborators</h2>
          <p>
            Share your Researcher ID, invite teammates onto IEEE papers, and open shared workspaces
            together.
          </p>
        </div>
      </div>

      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
      {message ? <StatusBanner tone="success">{message}</StatusBanner> : null}

      <section className="collab-rid-card">
        <h3>Your Researcher ID</h3>
        <p className="muted">
          Teammates use this ID to invite you. It is not a password — only a way to find your account.
        </p>
        <div className="researcher-id-row">
          <code className="researcher-id-code">{myRid || "Not assigned yet"}</code>
          <button type="button" className="ghost" disabled={!myRid || busy} onClick={copyRid}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      {pendingInvites.length ? (
        <section className="write-invite-inbox">
          <h3>Pending invites</h3>
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
        </section>
      ) : null}

      <div className="collab-layout">
        <aside className="collab-side">
          <div className="write-side-block">
            <h3 className="write-side-heading">Shared with me</h3>
            <ul className="write-story-list write-shared-list">
              {shared.map((item) => (
                <li key={item.story_id}>
                  <button
                    type="button"
                    className={`write-story-item${selectedId === item.story_id ? " active" : ""}`}
                    onClick={() => selectPaper(item.story_id)}
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

          <div className="write-side-block">
            <h3 className="write-side-heading">My papers</h3>
            <ul className="write-story-list">
              {mine.map((item) => (
                <li key={item.story_id}>
                  <button
                    type="button"
                    className={`write-story-item${selectedId === item.story_id ? " active" : ""}`}
                    onClick={() => selectPaper(item.story_id)}
                  >
                    <strong>{item.title}</strong>
                    <span className={`flag ${item.status === "published" ? "good" : ""}`}>
                      {item.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!mine.length ? (
              <p className="muted">Create a paper in Write, then invite collaborators here.</p>
            ) : null}
          </div>
        </aside>

        <section className="collab-main">
          {!story ? (
            <EmptyState title="Pick a paper">
              Choose one of your papers to invite teammates, or open a shared workspace from the left.
            </EmptyState>
          ) : (
            <>
              <div className="collab-paper-head">
                <div>
                  <h3>{story.title}</h3>
                  <p className="muted">
                    {isOwner
                      ? "You own this paper — invite editors or viewers."
                      : `Shared workspace · you are ${
                          (story.collaborators || []).find((c) => c.user_id === myUserId)?.role ||
                          "viewer"
                        }`}
                  </p>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onOpenPaper?.(story.story_id)}
                >
                  Open in Write
                </button>
              </div>

              <div className="write-collab-panel collab-manage">
                <h3 className="write-side-heading">People on this paper</h3>
                <ul className="write-collab-list">
                  <li className="write-collab-row">
                    <div>
                      <strong>
                        {isOwner ? "You (owner)" : story.author_name || "Owner"}
                      </strong>
                      <span className="muted"> · owner</span>
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
                  {(story.collaborators || [])
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
                  {!isOwner &&
                  (story.collaborators || []).some((c) => c.user_id === myUserId) ? (
                    <li className="write-collab-row">
                      <div>
                        <strong>You</strong>
                        <span className="muted">
                          {" "}
                          ·{" "}
                          {(story.collaborators || []).find((c) => c.user_id === myUserId)?.role ||
                            "viewer"}
                        </span>
                      </div>
                    </li>
                  ) : null}
                </ul>

                {isOwner ? (
                  <div className="write-invite-form">
                    <input
                      value={inviteRid}
                      onChange={(e) => setInviteRid(e.target.value.toUpperCase())}
                      placeholder="Teammate’s Researcher ID"
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
