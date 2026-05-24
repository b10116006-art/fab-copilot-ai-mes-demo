// =============================================================
// frontend/src/lib/api.js  (SSOT Fetch Helper)
// - This file MUST stay as your project's API helper.
// - Do NOT replace it with any file from node_modules/echarts.
// =============================================================

const DEFAULT_TIMEOUT_MS = 60000; // 60s (backend aggregation may take time on first load)

function buildUrl(base, path, params) {
  const url = new URL(path, base);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
}

export function getApiBase() {
  // Vite: use VITE_API_BASE if you set it, otherwise default to local FastAPI.
  return (import.meta.env?.VITE_API_BASE || "http://127.0.0.1:5000").replace(/\/$/, "");
}

export async function apiFetch(
  path,
  {
    method = "GET",
    params,
    body,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = {}
) {
  const base = getApiBase();
  const url = buildUrl(base, path, params);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort);

  try {
    const resp = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!resp.ok) {
      const msg = data && data.detail ? data.detail : `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    return data;
  } catch (err) {
    // Normalize AbortError into a readable message
    if (err?.name === "AbortError" || String(err?.message || "").includes("timeout")) {
      throw new Error("Request timeout (backend is slow or not responding)");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// Convenience wrappers
export const apiGet = (path, params, opt) =>
  apiFetch(path, { ...(opt || {}), method: "GET", params });
export const apiPost = (path, body, opt) =>
  apiFetch(path, { ...(opt || {}), method: "POST", body });