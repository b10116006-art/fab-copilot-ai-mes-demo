// useMESData.js - MES data fetch hook (curated for public snapshot)
// Source: GET <API_BASE>/<path> (e.g. /machines/state?layer=ILD)

import { useState, useEffect } from "react";

// API base. Configurable via frontend/.env: VITE_API_BASE_URL=http://127.0.0.1:5000
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://127.0.0.1:5000";

function buildUrl(path) {
  if (!path) return API_BASE;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

export function useMESData(apiPath, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const fullUrl = buildUrl(apiPath);
        const res = await fetch(fullUrl);
        if (!res.ok) throw new Error(`API Error: ${res.status} ${apiPath}`);

        const json = await res.json();
        if (active) setData(json);
      } catch (err) {
        if (active) setError(err);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchData();
    return () => (active = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath, ...deps]);

  return { data, loading, error };
}

export default useMESData;
