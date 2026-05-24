import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import { apiFetch } from "../lib/api";


function fmtTs(ts) {
  if (!ts) return "—";
  const s = String(ts);
  return s.replace("T", " ").replace("Z", "").slice(0, 19);
}
function safeNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return n.toFixed(digits);
}

export default function MachineDetail() {
  const { machineId } = useParams();
  const [sp] = useSearchParams();
  const layer = (sp.get("layer") || "ILD").toUpperCase();
  const hours = Number(sp.get("hours") || 168);
  const limit = Number(sp.get("limit") || 200);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const data = await apiFetch(`/machine/${encodeURIComponent(
          machineId || ""
        )}`, { params: { layer, hours, limit } });
        if (!cancelled) setRows(Array.isArray(data) ? data : []);      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setErr(String(e?.message || e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (machineId) load();
    return () => {
      cancelled = true;
    };
  }, [machineId, layer, hours, limit]);

  const thkSeries = useMemo(() => {
    const xs = [];
    const ys = [];
    for (const r of rows) {
      const t = r.timestamp || r.time || r.ts;
      const thk = r.thk;
      if (t && thk !== null && thk !== undefined && !Number.isNaN(Number(thk))) {
        xs.push(fmtTs(t));
        ys.push(Number(thk));
      }
    }
    return { xs, ys };
  }, [rows]);

  const last = rows && rows.length ? rows[rows.length - 1] : null;

  const thkOption = useMemo(() => {
    return {
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: {
        type: "category",
        data: thkSeries.xs,
        axisLabel: { color: "rgba(255,255,255,0.6)" },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "rgba(255,255,255,0.6)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      series: [
        {
          type: "line",
          data: thkSeries.ys,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
        },
      ],
      tooltip: { trigger: "axis" },
    };
  }, [thkSeries]);

  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-3xl font-semibold">
            Machine Detail – {machineId} ({layer})
          </div>
          <div className="text-white/60 text-sm">
            hours={hours}, limit={limit}
          </div>
        </div>

        <Link
          className="text-sky-300 hover:underline"
          to={`/machines?layer=${encodeURIComponent(layer)}`}
        >
          ← Back to Machines
        </Link>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-4 mb-4 w-full max-w-xl">
        <div>Last THK: {last ? `${safeNum(last.thk)} nm` : "—"}</div>
        <div>Last Defect Type: {last ? (last.defect_type || last.defectType || "—") : "—"}</div>
        <div>Last Scrap: {last ? (last.scrap ?? last.scrap_flag ?? "—") : "—"}</div>
        <div>Last Wait: {last ? (last.wait ?? last.wait_flag ?? "—") : "—"}</div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-4 mb-4">
        <div className="text-lg font-semibold mb-2">CMP Thickness (nm)</div>
        {loading && <div className="text-white/60">Loading...</div>}
        {err && <div className="text-yellow-300/80">{err}</div>}
        {!loading && !err && thkSeries.xs.length === 0 && (
          <div className="text-white/50">（目前無資料）</div>
        )}
        {!loading && !err && thkSeries.xs.length > 0 && (
          <ReactECharts option={thkOption} style={{ height: 240 }} />
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="text-lg font-semibold mb-2">Recent Defects</div>
        {!loading && !err && rows.length === 0 && (
          <div className="text-white/50">（目前無資料）</div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-right p-2">THK (nm)</th>
                  <th className="text-right p-2">Scrap</th>
                  <th className="text-right p-2">Wait</th>
                  <th className="text-left p-2">Defect Type</th>
                  <th className="text-right p-2">Defect</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .reverse()
                  .slice(0, 50)
                  .map((r, idx) => (
                    <tr key={idx} className="border-t border-white/10">
                      <td className="p-2">{fmtTs(r.timestamp || r.time || r.ts)}</td>
                      <td className="p-2 text-right">{r.thk === null || r.thk === undefined ? "—" : safeNum(r.thk)}</td>
                      <td className="p-2 text-right">{r.scrap ?? r.scrap_flag ?? "—"}</td>
                      <td className="p-2 text-right">{r.wait ?? r.wait_flag ?? "—"}</td>
                      <td className="p-2">{r.defect_type ?? r.defectType ?? "—"}</td>
                      <td className="p-2 text-right">{r.defect ?? r.defect_count ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
