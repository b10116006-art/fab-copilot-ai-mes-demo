import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import MachinesMatrix from "../components/MachinesMatrix";
import { apiFetch } from "../lib/api";

function safeNum(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

export default function Machines() {
  const [sp] = useSearchParams();
  const layer = (sp.get("layer") || "ILD").toUpperCase();
  const hours = Number(sp.get("hours") || 24);

  const [utilLoading, setUtilLoading] = useState(false);
  const [utilError, setUtilError] = useState(null);
  const [utilData, setUtilData] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchUtilization() {
      setUtilLoading(true);
      setUtilError(null);

      try {
        const data = await apiFetch(
          `/machines/utilization?layer=${encodeURIComponent(
            layer
          )}&hours=${encodeURIComponent(hours)}`
        );

        if (!cancelled) {
          const arr = Array.isArray(data) ? data : (Array.isArray(data?.machines) ? data.machines : []);
          setUtilData(arr);
        }
      } catch (e) {
        console.error("machines/utilization error:", e);
        if (!cancelled) {
          setUtilError(String(e?.message || e));
          setUtilData([]);
        }
      } finally {
        if (!cancelled) setUtilLoading(false);
      }
    }

    fetchUtilization();
    return () => {
      cancelled = true;
    };
  }, [layer, hours]);

  const rows = useMemo(() => {
    const arr = Array.isArray(utilData) ? utilData : [];
    return arr
      .map((r) => ({
        ...r,
        utilization: Number(r.utilization || 0),
        up: Number(r.up || 0),
        down: Number(r.down || 0),
        idle: Number(r.idle || 0),
        total: Number(r.total || 0),
      }))
      .sort((a, b) => (b.utilization || 0) - (a.utilization || 0));
  }, [utilData]);

  const L = layer;
  const h = hours;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Machines</h2>
        <div style={{ opacity: 0.75, fontSize: 13 }}>
          layer={layer} • hours={hours}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Link
            to={`/machines?layer=${encodeURIComponent("ILD")}&hours=${encodeURIComponent(
              h
            )}`}
          >
            ILD
          </Link>
          <Link
            to={`/machines?layer=${encodeURIComponent("PSG")}&hours=${encodeURIComponent(
              h
            )}`}
          >
            PSG
          </Link>
          <Link
            to={`/machines?layer=${encodeURIComponent("STI")}&hours=${encodeURIComponent(
              h
            )}`}
          >
            STI
          </Link>
        </div>
      </div>

      {utilLoading && (
        <div style={{ marginTop: 10, opacity: 0.8 }}>Loading utilization…</div>
      )}
      {utilError && (
        <div style={{ marginTop: 10, color: "#ff6b6b", whiteSpace: "pre-wrap" }}>
          {utilError}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <MachinesMatrix rows={rows} layer={L} hours={h} />
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Machine
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Util(%)
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Up
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Down
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Idle
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Total
              </th>
              <th style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #2a2a2a" }}>
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.machine}`}>
                <td style={{ padding: 8, borderBottom: "1px solid #1f1f1f" }}>
                  {r.machine}
                </td>
                <td
                  style={{
                    padding: 8,
                    textAlign: "right",
                    borderBottom: "1px solid #1f1f1f",
                  }}
                >
                  {safeNum(r.utilization, 1)}
                </td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #1f1f1f" }}>
                  {safeNum(r.up)}
                </td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #1f1f1f" }}>
                  {safeNum(r.down)}
                </td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #1f1f1f" }}>
                  {safeNum(r.idle)}
                </td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #1f1f1f" }}>
                  {safeNum(r.total)}
                </td>
                <td style={{ padding: 8, textAlign: "center", borderBottom: "1px solid #1f1f1f" }}>
                  <Link
                    to={`/machine/${encodeURIComponent(
                      r.machine
                    )}?layer=${encodeURIComponent(layer)}&hours=${encodeURIComponent(
                      hours
                    )}&limit=200`}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && !utilLoading && !utilError && (
              <tr>
                <td colSpan={7} style={{ padding: 12, opacity: 0.75 }}>
                  No utilization data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
