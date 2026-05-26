// =============================================================
// AiDecision.jsx — AI Decision & Explainability Page
// Moved from Overview.jsx right column (workflow intelligence)
// =============================================================

import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from "react";
import { LayerContext } from "../App_MES";

// =====================================================
// API Base URL — SSOT (copied from Overview.jsx)
// =====================================================
const API_BASE =
  (import.meta?.env?.VITE_API_BASE_URL &&
    String(import.meta.env.VITE_API_BASE_URL).trim()) ||
  "http://127.0.0.1:5000";

// =====================================================
// useAuthFetch — local copy (same logic as Overview.jsx)
// =====================================================
function useAuthFetch(baseUrl = API_BASE) {
  const controllers = useRef(new Set());

  const authFetch = useCallback(
    async (path, options = {}) => {
      const ctrl = new AbortController();
      controllers.current.add(ctrl);

      const allow404 = options?.allow404 === true;
      const opt = { ...options };
      delete opt.allow404;

      try {
        const url =
          path.startsWith("http://") || path.startsWith("https://")
            ? path
            : `${baseUrl}${path}`;

        const resp = await fetch(url, {
          ...opt,
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            ...(opt.headers || {}),
          },
        });

        const ct = resp.headers.get("content-type") || "";
        const text = await resp.text().catch(() => "");

        if (!resp.ok) {
          if (allow404 && resp.status === 404) return null;
          const isHtml =
            text.includes("<!doctype html") || text.includes("<html");
          const hint = isHtml
            ? "（看起來是打到前端 dev server 的 HTML；請確認 VITE_API_BASE_URL 指向 FastAPI 5000）"
            : "";
          console.error("authFetch resp error:", resp.status, hint, text.slice(0, 200));
          throw new Error(`HTTP ${resp.status} ${hint}`.trim());
        }

        if (!ct.includes("application/json")) {
          const isHtml =
            text.includes("<!doctype html") || text.includes("<html");
          const hint = isHtml
            ? "（回傳 HTML 而非 JSON；通常是打到 Vite index.html；請確認 VITE_API_BASE_URL）"
            : "";
          console.error("authFetch not-json:", ct, hint, text.slice(0, 200));
          throw new Error(`Not JSON ${hint}`.trim());
        }

        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("authFetch JSON parse failed:", e, text.slice(0, 200));
          throw new Error(`JSON parse failed: ${String(e)}`.trim());
        }
      } catch (err) {
        if (err?.name === "AbortError") return null;
        throw err;
      } finally {
        controllers.current.delete(ctrl);
      }
    },
    [baseUrl]
  );

  useEffect(() => {
    return () => {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
    };
  }, []);

  return authFetch;
}

// =====================================================
// Helpers (copied from Overview.jsx)
// =====================================================
function safeStr(v, fallback = "UNKNOWN") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function activeModelClass(model) {
  switch (model) {
    case "auto":      return "bg-sky-500 border-sky-300 text-white";
    case "openai":    return "bg-emerald-500 border-emerald-300 text-white";
    case "gemini_flash": return "bg-violet-500 border-violet-300 text-white";
    case "gemini_pro":   return "bg-amber-500 border-amber-300 text-slate-900";
    default:          return "bg-blue-500 border-blue-300 text-white";
  }
}

function riskColor(level) {
  const L = (level || "").toUpperCase();
  if (L === "LOW")      return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20";
  if (L === "MEDIUM" || L === "MED") return "bg-amber-500/10 text-amber-300 border-amber-400/20";
  if (L === "HIGH")     return "bg-orange-500/10 text-orange-300 border-orange-400/20";
  if (L === "CRITICAL") return "bg-red-500/10 text-red-300 border-red-400/20";
  return "bg-slate-500/10 text-slate-300 border-slate-400/20";
}

function summaryBadgeColor(level) {
  const L = (level || "").toUpperCase();
  if (L === "CRITICAL")              return "bg-red-500/25 text-red-200 border-red-400/50 font-semibold";
  if (L === "HIGH")                  return "bg-orange-500/20 text-orange-200 border-orange-400/40 font-semibold";
  if (L === "MED" || L === "MEDIUM") return "bg-amber-500/10 text-amber-300 border-amber-400/20";
  if (L === "LOW")                   return "bg-emerald-500/10 text-emerald-300 border-emerald-400/20";
  return "bg-slate-500/10 text-slate-300 border-slate-400/20";
}

function parseSummaryJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && (obj.summary || obj.possible_root_causes || obj.recommended_actions)) return obj;
  } catch {}
  return null;
}

function renderActionLines(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const out = [];
  for (const a of actions) {
    if (typeof a === "string") { out.push(a); continue; }
    if (a && typeof a === "object" && (a.action || a.owner || a.priority)) {
      const p = a.priority ? `${a.priority} ` : "";
      const o = a.owner ? `[${a.owner}] ` : "";
      const act = a.action ?? "";
      const s = `${p}${o}${act}`.trim();
      if (s) out.push(s);
      continue;
    }
    if (a && typeof a === "object" && Array.isArray(a.items)) {
      for (const it of a.items) {
        if (String(it || "").trim()) out.push(String(it));
      }
      continue;
    }
  }
  return out.slice(0, 3);
}

// =====================================================
// AiDecision — export default
// =====================================================
export default function AiDecision() {
  const { layer } = useContext(LayerContext);
  const authFetch = useAuthFetch();

  const [aiModel, setAiModel] = useState("auto");
  const [aiSummary, setAiSummary] = useState("（載入中…）");
  const [aiPanel, setAiPanel] = useState({
    risk_level: "UNKNOWN",
    actions: [],
    worsening: "",
    provider: "",
    model: "",
    rule_lines: [],
    // workflow intelligence fields
    workflow_context: null,
    trigger_gate: "",
    evidence_source: "",
    line_trigger_preview: null,
  });
  const [actionTrigger, setActionTrigger] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function safeGet(p, opt) {
      const delays = [0, 300, 800];
      for (let i = 0; i < delays.length; i++) {
        try {
          if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
          return await authFetch(p, opt);
        } catch (e) {
          const msg = String(e?.message || e || "");
          console.error("fetch failed:", p, e);
          if (i === delays.length - 1) return null;
          if (!/Failed to fetch|ERR_CONNECTION|NetworkError|fetch/i.test(msg)) return null;
        }
      }
      return null;
    }

    async function loadAll() {
      const aiRes = await safeGet(`/overview/ai?layer=${layer}&model=${aiModel}`);
      const aiPanelRes = await safeGet(`/overview/ai/action?layer=${layer}&model=${aiModel}`, { allow404: true });

      if (cancelled) return;

      if (aiRes?.summary || aiRes?.reply) setAiSummary(aiRes.summary || aiRes.reply);
      if (aiRes?.action_trigger) setActionTrigger(aiRes.action_trigger);

      const panelFromAi = aiRes?.action_panel || aiRes?.panel || null;
      const panel = panelFromAi || aiPanelRes;

      if (panel) {
        setAiPanel({
          risk_level: safeStr(panel.risk_level || panel.risk || aiRes?.risk_level, "UNKNOWN"),
          actions: Array.isArray(panel.actions) ? panel.actions : [],
          worsening: panel.worsening || "",
          provider: panel.provider || panel.provider_used || aiRes?.provider_used || "",
          model: panel.model || panel.model_used || aiRes?.model_used || "",
          rule_lines: Array.isArray(panel.rule_lines)
            ? panel.rule_lines
            : Array.isArray(aiRes?.rule_lines)
            ? aiRes.rule_lines
            : [],
          // workflow intelligence fields
          workflow_context: panel?.workflow_context || aiRes?.workflow_context || null,
          trigger_gate: panel?.action_trigger?.trigger_gate || aiRes?.action_trigger?.trigger_gate || "",
          evidence_source: panel?.evidence_source || aiRes?.evidence_source || "",
          line_trigger_preview: panel?.line_trigger_preview || aiRes?.line_trigger_preview || null,
        });
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [layer, aiModel, authFetch]);

  return (
    <div className="relative w-full text-gray-100">
      {/* Page header */}
      <div className="flex justify-between items-start mb-6">
        <div className="border-l-4 border-l-blue-400/40 pl-4">
          <div className="text-xl font-semibold text-gray-100 tracking-wide">AI Decision &amp; Explainability</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Layer: <span className="text-blue-400">{layer}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-400">
            Model: <span className="text-blue-300 font-semibold">{aiModel}</span>
          </div>
          <div className="flex gap-2">
            {["auto", "openai", "gemini_flash", "gemini_pro"].map((m) => (
              <button
                key={m}
                onClick={() => setAiModel(m)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-all duration-150 active:scale-95 ${
                  aiModel === m
                    ? activeModelClass(m)
                    : "border-white/20 text-gray-300 hover:bg-white/5"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content — two-column on wide, single on narrow */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left: AI Summary + Action Trigger */}
        <div className="col-span-6 flex flex-col gap-4">

          {/* AI Summary */}
          <div className={`bg-slate-900/70 rounded-xl border border-white/10 p-4 min-h-[120px] flex-1${
            aiPanel?.risk_level === "CRITICAL" ? " border-l-4 border-l-red-400/60" :
            aiPanel?.risk_level === "HIGH"     ? " border-l-4 border-l-orange-400/60" :
            aiPanel?.risk_level === "MEDIUM"   ? " border-l-4 border-l-amber-400/40" :
            aiPanel?.risk_level === "LOW"      ? " border-l-4 border-l-emerald-400/40" : ""
          }`}>
            <div className="mb-3 pb-2 border-b border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">AI Summary</span>
                  <span className="text-xs text-gray-500">· {aiModel}</span>
                </div>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className={`text-xs px-2.5 py-1 rounded-md border font-medium ${summaryBadgeColor(aiPanel?.risk_level)}`}>
                    {`● Risk: ${(aiPanel?.risk_level || "").toUpperCase() || "—"}`}
                  </span>
                  {aiPanel?.workflow_context?.case_status && (
                    <span className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
                      aiPanel.workflow_context.case_status === "open"
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/20"
                        : "bg-slate-500/10 text-slate-300 border-slate-400/20"
                    }`}>
                      {`● Case: ${aiPanel.workflow_context.case_status}`}
                    </span>
                  )}
                  {aiPanel?.trigger_gate && (
                    <span className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
                      aiPanel.trigger_gate === "blocked"
                        ? "bg-red-500/10 text-red-300 border-red-400/20"
                        : aiPanel.trigger_gate === "preview_eligible"
                        ? "bg-amber-500/10 text-amber-300 border-amber-400/20"
                        : "bg-slate-500/10 text-slate-300 border-slate-400/20"
                    }`}>
                      {`● Gate: ${aiPanel.trigger_gate}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Risk headline */}
            {(() => {
              const L = (aiPanel?.risk_level || "").toUpperCase();
              if (!L || L === "UNKNOWN") return null;
              const cfg =
                L === "CRITICAL"
                  ? { icon: "⚠", text: "Critical Risk",         cls: "text-red-300",     bg: "bg-red-500/20"     }
                  : L === "HIGH"
                  ? { icon: "⚠", text: "Quality Risk Detected", cls: "text-orange-300",  bg: "bg-orange-500/20"  }
                  : L === "MEDIUM"
                  ? { icon: "▶", text: "Monitoring Active",      cls: "text-amber-300",   bg: "bg-amber-500/20"   }
                  : { icon: "✓", text: "Normal Operations",      cls: "text-emerald-300", bg: "bg-emerald-500/20" };
              return (
                <div className={`flex items-center gap-2 text-lg font-bold mb-3 px-4 py-3 rounded-md ${cfg.bg} ${cfg.cls}`}>
                  <span>{cfg.icon}</span>
                  <span>{cfg.text}</span>
                </div>
              );
            })()}

            <div className="text-sm">
              {(() => {
                if (!aiSummary || aiSummary === "（載入中…）") {
                  return <div className="text-xs text-gray-500 italic py-2">Loading analysis…</div>;
                }
                const parsed = parseSummaryJson(aiSummary);
                if (parsed) {
                  return (
                    <div className="space-y-2 pr-2">
                      {parsed.summary && (
                        <div>
                          <div className="text-sm font-medium text-gray-300 mb-1">▸ Summary</div>
                          <div className="text-base text-gray-100 leading-relaxed">{parsed.summary}</div>
                        </div>
                      )}
                      {Array.isArray(parsed.possible_root_causes) && parsed.possible_root_causes.length > 0 && (
                        <div>
                          <div className="text-sm font-medium text-gray-300 mb-1">⚑ Root Causes</div>
                          <ul className="list-disc list-outside pl-4 text-gray-200 space-y-0.5">
                            {parsed.possible_root_causes.map((rc, i) => <li key={i}>{rc}</li>)}
                          </ul>
                        </div>
                      )}
                      {Array.isArray(parsed.recommended_actions) && parsed.recommended_actions.length > 0 && (
                        <div>
                          <div className="text-sm font-medium text-gray-300 mb-1">→ Recommended Actions</div>
                          <ul className="list-disc list-outside pl-4 text-gray-200 space-y-0.5">
                            {parsed.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                          {parsed.recommended_actions[0] && (
                            <div className="mt-3 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-400/20">
                              <div className="text-xs font-semibold text-blue-400 tracking-widest uppercase mb-1">Next Action</div>
                              <div className="text-sm text-blue-200 leading-relaxed">{parsed.recommended_actions[0]}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="text-sm leading-relaxed whitespace-pre-line text-gray-100 pr-2">
                    {aiSummary || "（今日無異常）"}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Action Trigger + C6 Decision Trace */}
          {actionTrigger && (
            <div className="bg-blue-500/5 rounded-xl border border-blue-400/20 p-4">
              <div className="text-xs text-blue-300 font-semibold mb-1.5">Recommended Action</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {actionTrigger.trigger_type && (
                  <div>
                    <div className="text-gray-500 mb-0.5">Trigger Type</div>
                    <div className="text-gray-200">{actionTrigger.trigger_type}</div>
                  </div>
                )}
                {actionTrigger.trigger_target && (
                  <div>
                    <div className="text-gray-500 mb-0.5">Target</div>
                    <div className="text-gray-200">{actionTrigger.trigger_target}</div>
                  </div>
                )}
                {actionTrigger.suggested_channel && (
                  <div>
                    <div className="text-gray-500 mb-0.5">Channel</div>
                    <div className="text-gray-200">{actionTrigger.suggested_channel}</div>
                  </div>
                )}
              </div>
              {/* Decision Trace sub-row */}
              {(aiPanel?.workflow_context || aiPanel?.evidence_source || aiPanel?.line_trigger_preview !== null) && (
                <div className="border-t border-blue-400/10 mt-2 pt-2 grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
                  <div>
                    <div className="text-gray-400 mb-0.5">Case</div>
                    <div className="text-gray-300">{aiPanel?.workflow_context?.case_status || "--"}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Progression</div>
                    <div className="text-gray-300">{aiPanel?.workflow_context?.case_progression || "--"}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Existing?</div>
                    <div className="text-gray-300">
                      {aiPanel?.workflow_context?.is_existing_case === true
                        ? "yes"
                        : aiPanel?.workflow_context?.is_existing_case === false
                        ? "no"
                        : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">LINE Preview</div>
                    <div className="text-gray-300">
                      {aiPanel?.line_trigger_preview ? "available" : "--"}
                    </div>
                  </div>
                  <div className="col-span-3">
                    <div className="text-gray-400 mb-0.5">Evidence</div>
                    <div className="text-gray-300 truncate">{aiPanel?.evidence_source || "--"}</div>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-0.5">Workflow ID</div>
                    <div className="text-gray-300 font-mono">
                      {aiPanel?.workflow_context?.workflow_id
                        ? String(aiPanel.workflow_context.workflow_id).slice(0, 8)
                        : "--"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: LLM Action + Rule-based */}
        <div className="col-span-6 flex flex-col gap-4">

          {/* LLM Action Panel */}
          <div className="bg-slate-900/70 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-100 font-semibold">LLM Action Panel</div>
              <div className={`text-xs px-2.5 py-1 rounded-md border font-medium ${riskColor(aiPanel?.risk_level)}`}>
                {`● ${safeStr(aiPanel?.risk_level, "UNKNOWN")}`}
              </div>
            </div>

            {(aiPanel?.provider || aiPanel?.model) && (
              <div className="text-xs text-gray-400 mb-2">
                {aiPanel.provider ? `provider: ${aiPanel.provider}` : ""}
                {aiPanel.provider && aiPanel.model ? " · " : ""}
                {aiPanel.model ? `model: ${aiPanel.model}` : ""}
              </div>
            )}

            <div className="text-sm font-medium text-gray-300 mb-1">Top Actions</div>
            <div className="pr-2">
              {renderActionLines(aiPanel?.actions).length > 0 ? (
                <ul className="text-base text-left list-disc list-outside pl-5 space-y-1 text-gray-100">
                  {renderActionLines(aiPanel?.actions).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-base text-gray-400">
                  （尚無建議，可先看 Rule-based 或用 FAB Copilot 詢問）
                </div>
              )}
              <div className="mt-3 text-sm font-medium text-gray-300">Worsening Forecast</div>
              <div className="text-base text-gray-100 whitespace-pre-line">
                {aiPanel?.worsening
                  ? aiPanel.worsening
                  : "（目前無明確惡化訊號；若 Scrap/THK/Defect 突增，將提升風險等級）"}
              </div>
            </div>
          </div>

          {/* Rule-based Diagnosis */}
          <div className="bg-slate-900/70 rounded-xl border border-white/10 p-4">
            <div className="text-sm text-gray-100 font-semibold mb-2">Rule-based Diagnosis</div>
            <div className="text-base text-gray-100 space-y-2">
              {(Array.isArray(aiPanel?.rule_lines) && aiPanel.rule_lines.length > 0
                ? aiPanel.rule_lines
                : [
                    "請先確認 Defect Type 是否集中於單一類型。",
                    "若缺陷集中於少數機台 → 優先檢查該機台硬體 / 清洗。",
                    "THK 若連續偏薄/偏厚 → 建議 FEM / RDA 補償並觀察 2–3 天。",
                  ]).map((line, idx) => (
                <div className="flex items-start gap-2" key={idx}>
                  <div className="w-5 shrink-0 text-gray-200 font-semibold text-right">{idx + 1}.</div>
                  <div className="flex-1">{line}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
