const BASE = "/api";

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth")) {
      window.dispatchEvent(new Event("selfrag-auth-lost"));
    }
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail?.message || body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  me: () => request("/auth/me"),
  signup: (payload) =>
    request("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  logout: () => request("/auth/logout", { method: "POST" }),
  health: () => request("/health"),
  documents: () => request("/documents"),
  clusters: () => request("/documents/clusters"),
  extractions: () => request("/documents/extractions"),
  refreshExtractions: () => request("/documents/extractions/refresh", { method: "POST" }),
  upload: (files) => {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    return request("/documents/upload", { method: "POST", body: data });
  },
  deleteDocument: (id) => request(`/documents/${id}`, { method: "DELETE" }),
  searchPapers: (q, opts = {}) => {
    const limit = opts.limit ?? 10;
    const filter = opts.filter ?? "all";
    return request(
      `/papers/search?q=${encodeURIComponent(q)}&limit=${limit}&filter=${encodeURIComponent(filter)}`
    );
  },
  importPaper: (payload) =>
    request("/papers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  query: (payload) =>
    request("/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  recent: (limit = 12) => request(`/query/recent?limit=${limit}`),
  historyItem: (id) => request(`/query/history/${id}`),
  events: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== "") qs.set(key, String(value));
    });
    const suffix = qs.toString() ? `?${qs}` : "";
    return request(`/events${suffix}`);
  },
  workspaceRecents: (limit = 24) => request(`/workspace/recents?limit=${limit}`),
  savePaperSearch: (payload) =>
    request("/workspace/paper-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  paperSearchItem: (id) => request(`/workspace/paper-searches/${id}`),
  deleteRecentAsk: (id) => request(`/workspace/recents/ask/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteRecentPapers: (id) =>
    request(`/workspace/recents/papers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createPaperDraft: (payload) =>
    request("/paper-drafts/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  listPaperDrafts: (limit = 20) => request(`/paper-drafts/?limit=${limit}`),
  getPaperDraft: (id) => request(`/paper-drafts/${encodeURIComponent(id)}`),
  updatePaperDraft: (id, payload) =>
    request(`/paper-drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deletePaperDraft: (id) =>
    request(`/paper-drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  previewPaperDraft: async (id) => {
    const response = await fetch(
      `${BASE}/paper-drafts/${encodeURIComponent(id)}/preview.html`,
      { credentials: "include" }
    );
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event("selfrag-auth-lost"));
      }
      let detail = response.statusText;
      try {
        const body = await response.json();
        detail = body.detail?.message || body.detail || JSON.stringify(body);
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return response.text();
  },
  exportPaperDraft: async (id, format) => {
    const response = await fetch(`${BASE}/paper-drafts/${encodeURIComponent(id)}/export.${format}`, {
      credentials: "include",
    });
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event("selfrag-auth-lost"));
      }
      let detail = response.statusText;
      try {
        const body = await response.json();
        detail = body.detail?.message || body.detail || JSON.stringify(body);
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob, filename: match?.[1] || `paper.${format}` };
  },
};

export function pct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function ms(value) {
  if (value == null) return "—";
  return `${Math.round(value)} ms`;
}
