const BASE = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail?.message || body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json();
}

export const api = {
  health: () => request("/health"),
  documents: () => request("/documents"),
  upload: (files) => {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    return request("/documents/upload", { method: "POST", body: data });
  },
  deleteDocument: (id) => request(`/documents/${id}`, { method: "DELETE" }),
  searchPapers: (q, limit = 10) =>
    request(`/papers/search?q=${encodeURIComponent(q)}&limit=${limit}`),
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
};

export function pct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function ms(value) {
  if (value == null) return "—";
  return `${Math.round(value)} ms`;
}
