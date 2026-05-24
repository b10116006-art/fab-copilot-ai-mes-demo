// =============================================================
// Ultra v27C+SSOT — Overview.jsx (SINGLE FILE BASELINE)
// ✅ Single source of truth（不拆 Part1/Part2）
// ✅ 保留：KPI / Pie / Trend / AI Summary / LLM Action / Rule-based / Tables / Chatbox 全保留
// ✅ FIX: trend/thk 支援後端回 {x,y} 或 [{time,thk}]
// ✅ FIX: API fail 不會整頁掛；單一 endpoint 壞了其他照顯示
// ✅ FIX: LLM Action panel actions 支援多種 shape
// =============================================================

import React, {
  useState,
  useEffect,
  useMemo,
  useContext,
  useCallback,
  useRef,
} from "react";
import ReactECharts from "echarts-for-react";
import { Link } from "react-router-dom";
import { LayerContext } from "../App_MES";

console.log("### LOADED Overview.jsx Ultra v27C+SSOT ###");

// =====================================================
// API Base URL — SSOT
// =====================================================
const API_BASE =
  (import.meta?.env?.VITE_API_BASE_URL &&
    String(import.meta.env.VITE_API_BASE_URL).trim()) ||
  "http://127.0.0.1:5000";

// =====================================================
// useAuthFetch：獨立 AbortController（不互相 abort）
// + allow404：遇到 404 直接回 null（不要噴紅）
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
// Helper
// =====================================================
function safeNum(v, digits = 2) {
  if (v === null || v === undefined || isNaN(v)) return "--";
  return Number(v).toFixed(digits);
}
function safeStr(v, fallback = "UNKNOWN") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function normalizeKpi(raw) {
  if (!raw || typeof raw !== "object") return null;

  const capacity = Number(raw.capacity ?? raw.capacity_month);
  const confirmed =
    raw.confirmed !== undefined
      ? Number(raw.confirmed)
      : raw.confirmed_scrap !== undefined
      ? Number(raw.confirmed_scrap)
      : raw.scrap_qty !== undefined
      ? Number(raw.scrap_qty)
      : raw.scrapQty !== undefined
      ? Number(raw.scrapQty)
      : undefined;

  const pending =
    raw.pending !== undefined
      ? Number(raw.pending)
      : raw.pending_scrap !== undefined
      ? Number(raw.pending_scrap)
      : undefined;

  const yield_rate =
    raw.yield_rate !== undefined
      ? Number(raw.yield_rate)
      : raw.yield !== undefined
      ? Number(raw.yield)
      : undefined;

  const thk_mean =
    raw.thk_mean !== undefined ? Number(raw.thk_mean) : Number(raw.thk);

  const scrap_rate =
    raw.scrap_rate !== undefined && raw.scrap_rate !== null
      ? Number(raw.scrap_rate)
      : undefined;

  const utilization =
    raw.utilization !== undefined && raw.utilization !== null
      ? Number(raw.utilization)
      : undefined;

  return {
    ...raw,
    capacity: isNaN(capacity) ? raw.capacity : capacity,
    confirmed,
    pending,
    scrap_rate,
    yield_rate,
    thk_mean,
    utilization,
  };
}

// =====================================================
// Model button style + SSOT model
// =====================================================
function activeModelClass(model) {
  switch (model) {
    case "auto":
      return "bg-sky-500 border-sky-300 text-white";
    case "openai":
      return "bg-emerald-500 border-emerald-300 text-white";
    case "gemini_flash":
      return "bg-violet-500 border-violet-300 text-white";
    case "gemini_pro":
      return "bg-amber-500 border-amber-300 text-slate-900";
    default:
      return "bg-blue-500 border-blue-300 text-white";
  }
}

// =====================================================
// FAB Copilot floating chatbox
// =====================================================
const SUGGEST = [
  "今天 ILD 報廢是否正常？",
  "THK 偏薄時 FEM / RDA 怎麼調？",
  "請幫我用工程師語氣總結今日風險。",
  "哪一種缺陷占比最高？",
];

function FabChatbox({ layer, aiModel, setAiModel }) {
  const authFetch = useAuthFetch();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", text: "您好，我是 FAB Copilot，請問要分析哪個 Layer？" },
  ]);

  const model = aiModel || "auto";
  const changeModel = (m) => setAiModel && setAiModel(m);

  // Drag + resize (SE corner only)
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 680, h: 720 });
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const resize = useRef({ active: false, sx: 0, sy: 0, ow: 0, oh: 0 });

  const onHeaderDown = (e) => {
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onResizeDown = (e) => {
    e.stopPropagation();
    resize.current = { active: true, sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onMove = (e) => {
    if (drag.current.active) {
      setPos({ x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) });
    }
    if (resize.current.active) {
      const newW = Math.min(960, Math.max(480, resize.current.ow + (e.clientX - resize.current.sx)));
      const newH = Math.min(Math.floor(window.innerHeight * 0.88), Math.max(480, resize.current.oh + (e.clientY - resize.current.sy)));
      setSize({ w: newW, h: newH });
    }
  };
  const onUp = () => {
    drag.current.active = false;
    resize.current.active = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  const sendMsg = async () => {
    const msg = input.trim();
    if (!msg) return;
    setMessages((p) => [...p, { role: "user", text: msg }]);
    setInput("");
    setStatus("loading");
    try {
      const res = await authFetch("/chatbot", {
        method: "POST",
        body: JSON.stringify({ layer, message: msg, model, session_id: "web" }),
      });
      const replyText = res?.answer ?? res?.reply ?? res?.text ?? "";
      if (!replyText) throw new Error("無回應");
      setMessages((p) => [...p, { role: "assistant", text: replyText, provider: res.provider_used ?? res.provider, model: res.model_used ?? res.model }]);
      setStatus("idle");
    } catch (err) {
      console.error("chatbot err:", err);
      setMessages((p) => [...p, { role: "assistant", text: "LLM 無回應，改用本地 Rule-based 建議：請檢查 Top 缺陷與 FEM/THK 趨勢。" }]);
      setStatus("error");
    }
  };

  // Status light — visible-first glow dot
  const statusDotClass =
    status === "loading" ? "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.55)]"
  : status === "error"   ? "bg-red-500 shadow-[0_0_6px_2px_rgba(239,68,68,0.65)]"
  :                        "bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.55)] animate-pulse";
  const statusLabel = status === "loading" ? "Thinking…" : status === "error" ? "Error" : "Online";

  return (
    <>
      {/* FAB trigger */}
      <button
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-2xl bg-blue-500 text-white shadow-xl shadow-blue-500/30 hover:bg-blue-600 hover:-translate-y-0.5 active:scale-95 transition-all duration-150 flex flex-col items-center justify-center gap-0.5"
        onClick={() => setOpen((o) => !o)}
        title="Open FAB Copilot"
      >
        <span className="text-xs font-bold leading-none tracking-wide">FAB</span>
        <span className="text-[10px] leading-none text-blue-200">Copilot</span>
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 max-w-[calc(100vw-3rem)] max-h-[calc(100vh-8rem)] bg-[#0a0f1c]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col select-none"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, width: size.w, height: size.h }}
        >
          {/* Header — identity row (draggable) */}
          <div
            className="flex-shrink-0 px-5 py-4 border-b border-white/8 rounded-t-2xl bg-slate-900/40 cursor-move"
            onMouseDown={onHeaderDown}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-blue-500/15 border border-blue-400/25 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_2px_rgba(96,165,250,0.12)]">
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                    <polygon points="7,1 12.5,4 12.5,10 7,13 1.5,10 1.5,4" stroke="#93c5fd" strokeWidth="1.2" fill="rgba(147,197,253,0.08)"/>
                    <circle cx="7" cy="7" r="1.7" fill="#93c5fd"/>
                  </svg>
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  {/* Title — single line */}
                  <div className="text-sm font-bold text-white tracking-wide leading-none">
                    FAB Copilot
                  </div>
                  {/* Subtitle — single line, bullet-separated */}
                  <div className="text-[10px] text-gray-500 leading-none">
                    <span className="text-blue-400/90 font-semibold uppercase tracking-widest">{layer}</span>
                    <span className="mx-1.5 text-gray-700">•</span>
                    <span>Semiconductor AI Assistant</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`h-3 w-3 rounded-full ${statusDotClass}`} />
                <span className={`text-[11px] font-semibold ${status === "error" ? "text-red-400" : status === "loading" ? "text-amber-400" : "text-emerald-400"}`}>{statusLabel}</span>
                <div className="w-px h-4 bg-white/10 mx-0.5" />
                <button
                  onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/8 transition-colors duration-150"
                  title="Close"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Model strip — dedicated zone, clearly separated from header */}
          <div className="flex-shrink-0 px-5 py-2.5 flex items-center gap-2 bg-slate-900/30 border-b border-white/5">
            <span className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold flex-shrink-0">Model</span>
            <div className="flex items-center gap-1.5 flex-1">
              {["auto", "openai", "gemini_flash", "gemini_pro"].map((m) => (
                <button
                  key={m}
                  onClick={() => changeModel(m)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium border transition-all duration-150 active:scale-95 ${
                    model === m
                      ? activeModelClass(m)
                      : "border-white/10 bg-white/[0.02] text-gray-500 hover:text-gray-200 hover:bg-white/5 hover:border-white/20"
                  }`}
                  title={`Switch to ${m}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 px-5 py-4 overflow-y-auto text-sm min-h-0">
            {messages.map((m, i) => {
              const isGreeting = i === 0 && m.role === "assistant" && messages.length <= 1;
              return (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} ${i > 0 ? "mt-3" : ""} ${i === 1 ? "pt-3 border-t border-white/5" : ""}`}
                >
                  {isGreeting ? (
                    <div className="w-full text-[11px] text-gray-500 leading-relaxed py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 block mb-1">Greeting</span>
                      {m.text}
                    </div>
                  ) : (
                    <div className={`px-4 py-2.5 rounded-2xl max-w-[80%] leading-relaxed ${m.role === "user" ? "bg-blue-500 text-white rounded-br-sm shadow-sm shadow-blue-500/20" : "bg-white/5 text-gray-200 rounded-bl-sm border border-white/10"}`}>
                      {m.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer zone — suggestion chips + input, visually grouped */}
          <div className="flex-shrink-0 border-t border-white/8 bg-slate-900/40 rounded-b-2xl">
            {/* Suggestion chips */}
            <div className="px-5 pt-3 pb-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Try asking</div>
              <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
                {SUGGEST.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(s)}
                    className="shrink-0 px-3.5 py-1.5 text-[11px] bg-white/5 text-gray-300 rounded-full border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20 hover:-translate-y-px transition-all duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Input row */}
            <div className="px-5 pb-5 pt-2 flex items-center gap-2.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMsg(); } }}
                placeholder={`Ask about ${layer} layer…`}
                className="flex-1 h-11 bg-slate-800/70 border border-white/10 rounded-lg px-4 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-400/60 focus:bg-slate-800 focus:ring-1 focus:ring-blue-400/20 transition-all duration-150"
              />
              <button
                onClick={sendMsg}
                disabled={status === "loading"}
                className="h-11 px-5 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all duration-150 flex-shrink-0 shadow-md shadow-blue-500/30 border border-blue-400/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <span>Send</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 6H11M7 2L11 6L7 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          {/* SE resize handle — bigger hit area + clearer visual */}
          <div
            className="absolute bottom-0 right-0 w-7 h-7 cursor-se-resize z-10 flex items-end justify-end pb-1.5 pr-1.5 opacity-50 hover:opacity-100 transition-opacity duration-150 group"
            onMouseDown={onResizeDown}
            title="Drag to resize"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-gray-500 group-hover:text-blue-300 transition-colors duration-150">
              <path d="M11 4L4 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M11 8L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      )}
    </>
  );
}

// =====================================================
// Gauge options
// =====================================================
function buildYieldGaugeOption(value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return {
    series: [
      {
        type: "gauge",
        center: ["50%", "60%"],
        radius: "88%",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [0.7, "#3b82f6"],
              [0.85, "#e5e7eb"],
              [1.0, "#ef4444"],
            ],
          },
        },
        axisTick: {
          show: true,
          splitNumber: 4,
          length: 6,
          lineStyle: { color: "rgba(226,232,240,0.55)", width: 1 },
        },
        splitLine: {
          show: true,
          length: 10,
          lineStyle: { color: "rgba(226,232,240,0.9)", width: 2 },
        },
        axisLabel: {
          show: true,
          distance: 20,
          fontSize: 13,
          fontWeight: 700,
          color: "#94a3b8",
        },
        pointer: {
          show: true,
          width: 5,
          length: "56%",
          itemStyle: { color: "#ffffff" },
        },
        anchor: {
          show: true,
          size: 7,
          showAbove: true,
          itemStyle: { color: "#ffffff" },
        },
        detail: {
          show: true,
          valueAnimation: true,
          fontSize: 24,
          fontWeight: 800,
          color: "#ffffff",
          offsetCenter: [0, "55%"],
          formatter: (val) => `${Number(val).toFixed(2)}%`,
        },
        data: [{ value: v }],
      },
    ],
  };
}

function buildThkGaugeOption(value) {
  const min = 80;
  const max = 120;
  const v0 = Number(value);
  const v = Math.max(min, Math.min(max, isNaN(v0) ? 100 : v0));

  return {
    series: [
      {
        type: "gauge",
        center: ["50%", "60%"],
        radius: "88%",
        startAngle: 210,
        endAngle: -30,
        min,
        max,
        splitNumber: 8,
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [(100 - min) / (max - min), "#3b82f6"],
              [1.0, "#e5e7eb"],
            ],
          },
        },
        axisTick: {
          show: true,
          splitNumber: 4,
          length: 6,
          lineStyle: { color: "rgba(226,232,240,0.55)", width: 1 },
        },
        splitLine: {
          show: true,
          length: 10,
          lineStyle: { color: "rgba(226,232,240,0.9)", width: 2 },
        },
        axisLabel: {
          show: true,
          distance: 20,
          fontSize: 13,
          fontWeight: 700,
          color: "#94a3b8",
        },
        pointer: {
          show: true,
          width: 5,
          length: "56%",
          itemStyle: { color: "#ffffff" },
        },
        anchor: {
          show: true,
          size: 7,
          showAbove: true,
          itemStyle: { color: "#ffffff" },
        },
        detail: {
          show: true,
          valueAnimation: true,
          fontSize: 24,
          fontWeight: 800,
          color: "#ffffff",
          offsetCenter: [0, "55%"],
          formatter: (val) => `${Number(val).toFixed(2)} nm`,
        },
        data: [{ value: v }],
      },
    ],
  };
}

// =====================================================
// LLM Action Panel style
// =====================================================
function riskColor(level) {
  const L = (level || "").toUpperCase();
  if (L === "LOW") return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
  if (L === "MEDIUM" || L === "MED") return "bg-amber-500/15 text-amber-300 border-amber-400/30";
  if (L === "HIGH") return "bg-orange-500/15 text-orange-300 border-orange-400/30";
  if (L === "CRITICAL") return "bg-red-500/15 text-red-300 border-red-400/30";
  return "bg-slate-500/15 text-slate-300 border-slate-400/30";
}

function yieldColor(v) {
  const n = Number(v);
  if (isNaN(n)) return "";
  if (n > 95) return "text-emerald-400";
  if (n >= 90) return "text-amber-400";
  return "text-red-400";
}

function utilizationColor(v) {
  const n = Number(v);
  if (isNaN(n)) return "";
  if (n > 85) return "text-emerald-400";
  if (n >= 70) return "text-amber-400";
  return "text-red-400";
}

// Derives semantic border class from existing color class string (no new API field needed)
function kpiBorderClass(colorCls) {
  if (!colorCls) return "border-white/5";
  if (colorCls.includes("emerald")) return "border-emerald-500/25";
  if (colorCls.includes("amber"))   return "border-amber-500/25";
  if (colorCls.includes("red"))     return "border-red-500/30";
  return "border-white/5";
}

function confidenceBadgeColor(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isNaN(n)) {
    if (n >= 0.8) return "bg-emerald-500/15 text-emerald-300";
    if (n >= 0.5) return "bg-amber-500/15 text-amber-300";
    return "bg-red-500/15 text-red-300";
  }
  const s = String(v || "").toUpperCase();
  if (s === "HIGH")   return "bg-emerald-500/15 text-emerald-300";
  if (s === "MEDIUM") return "bg-amber-500/15 text-amber-300";
  if (s === "LOW")    return "bg-red-500/15 text-red-300";
  return "bg-slate-500/15 text-slate-400";
}

function summaryBadgeColor(level) {
  const L = (level || "").toUpperCase();
  if (L === "CRITICAL")              return "bg-red-500/15 text-red-300 border-red-400/30";
  if (L === "HIGH")                  return "bg-orange-500/15 text-orange-300 border-orange-400/30";
  if (L === "MED" || L === "MEDIUM") return "bg-amber-500/15 text-amber-300 border-amber-400/30";
  if (L === "LOW")                   return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
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

function firstSentence(text) {
  if (!text) return "";
  const idx = text.search(/[.!?。！？]/);
  return idx > 0 ? text.slice(0, idx + 1).trim() : text.trim();
}

// =====================================================
// Overview（唯一 export default）
// =====================================================
export default function Overview() {
  const { layer } = useContext(LayerContext);
  const authFetch = useAuthFetch();

  const [aiModel, setAiModel] = useState("auto");

  const [kpi, setKpi] = useState(null);
  const [defectShare, setDefectShare] = useState([]);
  const [thkTrend, setThkTrend] = useState({ x: [], y: [] });
  const [weekScrap, setWeekScrap] = useState([]);
  const [monthScrap, setMonthScrap] = useState([]);

  const [aiSummary, setAiSummary] = useState("（今日無異常）");
  const [aiPanel, setAiPanel] = useState({
    risk_level: "UNKNOWN",
    actions: [],
    worsening: "",
    provider: "",
    model: "",
    rule_lines: [],
    // Phase C6: workflow intelligence fields
    workflow_context: null,
    trigger_gate: "",
    evidence_source: "",
    line_trigger_preview: null,
    confidence: "",
  });

  const [openWeek, setOpenWeek] = useState(false);
  const [openMonth, setOpenMonth] = useState(false);
  const [actionTrigger, setActionTrigger] = useState(null);
  const [topMachine, setTopMachine] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function safeGet(p, opt) {
  // Retry a couple of times to survive transient backend reload / Mongo hiccups.
  const delays = [0, 300, 800]; // ms
  for (let i = 0; i < delays.length; i++) {
    try {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      return await authFetch(p, opt);
    } catch (e) {
      const msg = String(e?.message || e || "");
      console.error("fetch failed:", p, e);
      // If it's the last attempt, give up.
      if (i === delays.length - 1) return null;
      // For non-network errors, don't keep retrying.
      if (!/Failed to fetch|ERR_CONNECTION|NetworkError|fetch/i.test(msg)) return null;
    }
  }
  return null;
}

    async function loadAll() {
      const kpiRes = await safeGet(`/overview/kpi?layer=${layer}`);
      const defectRes = await safeGet(`/overview/defect/share?layer=${layer}`);
      const trendRes = await safeGet(`/overview/trend/thk?layer=${layer}`);
      const weekRes = await safeGet(`/overview/scrap/week?layer=${layer}`);
      const monthRes = await safeGet(`/overview/scrap/month?layer=${layer}`);
      const aiRes = await safeGet(`/overview/ai?layer=${layer}&model=${aiModel}`);
      const aiPanelRes = await safeGet(`/overview/ai/action?layer=${layer}&model=${aiModel}`, { allow404: true });

      if (cancelled) return;

      if (kpiRes) setKpi(normalizeKpi(kpiRes));
      setDefectShare(Array.isArray(defectRes) ? defectRes : []);

      // trendRes: 支援兩種格式
      // A) {x:[...], y:[...]}
      // B) [{time,thk}, ...]
      if (trendRes) {
        if (Array.isArray(trendRes)) {
          const x = [];
          const y = [];
          for (const r of trendRes) {
            if (!r) continue;
            const t = r.time || r.timestamp;
            const v = r.thk ?? r.value;
            if (t && v !== undefined && v !== null) {
              x.push(String(t).replace("T", " ").slice(0, 16));
              y.push(Number(v));
            }
          }
          setThkTrend({ x, y });
        } else if (typeof trendRes === "object" && Array.isArray(trendRes.x) && Array.isArray(trendRes.y)) {
          setThkTrend(trendRes);
        }
      }

      if (Array.isArray(weekRes)) setWeekScrap(weekRes);
      if (Array.isArray(monthRes)) setMonthScrap(monthRes);

      if (aiRes?.summary || aiRes?.reply) setAiSummary(aiRes.summary || aiRes.reply);
      if (aiRes?.action_trigger) setActionTrigger(aiRes.action_trigger);
      if (aiRes?.top_machine || kpiRes?.top_machine) setTopMachine(aiRes?.top_machine || kpiRes?.top_machine);

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
          // Phase C6: workflow intelligence fields
          workflow_context: panel?.workflow_context || aiRes?.workflow_context || null,
          trigger_gate: panel?.action_trigger?.trigger_gate || aiRes?.action_trigger?.trigger_gate || "",
          evidence_source: panel?.evidence_source || aiRes?.evidence_source || "",
          line_trigger_preview: panel?.line_trigger_preview || aiRes?.line_trigger_preview || null,
          confidence: panel?.confidence || aiRes?.confidence || actionTrigger?.confidence || "",
        });
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [layer, aiModel, authFetch]);

  const yieldGaugeOpt = useMemo(
    () => buildYieldGaugeOption(kpi?.yield_rate ?? 0),
    [kpi]
  );

  const thkGaugeOpt = useMemo(
    () => buildThkGaugeOption(kpi?.thk_mean ?? 100),
    [kpi]
  );

  const defectOpt = useMemo(() => {
    const hasData = defectShare.length > 0;

    return {
      title: {
        text: hasData ? "" : "無缺陷資料",
        top: "middle",
        left: "center",
        textStyle: { color: "#94a3b8", fontSize: 14 },
      },
      tooltip: { trigger: "item", formatter: "{b}：{c} 片 ({d}%)" },
      legend: { bottom: 0, textStyle: { color: "#9ca3af", fontSize: 12 } },
      series: [
        {
          type: "pie",
          radius: ["35%", "70%"],
          center: ["50%", "45%"],
          data: defectShare,
          label: {
            formatter: "{b}\n{c} ({d}%)",
            color: "#e2e8f0",
            fontSize: 12,
          },
          itemStyle: { borderColor: "#0f172a", borderWidth: 1 },
        },
      ],
    };
  }, [defectShare]);

  const thkTrendOptUI = useMemo(() => {
    return {
      grid: { left: 44, right: 12, top: 28, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: thkTrend.x,
        axisLabel: {
          color: "#9ca3af",
          fontSize: 11,
          formatter: (_, idx) => (idx % 2 ? "" : thkTrend.x[idx]),
        },
        axisLine: { lineStyle: { color: "#475569", width: 1.2 } },
      },
      yAxis: {
        type: "value",
        name: "THK (nm)",
        nameTextStyle: { color: "#94a3b8", fontSize: 12 },
        axisLabel: { color: "#9ca3af", fontSize: 11 },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: thkTrend.y,
          symbol: "circle",
          symbolSize: 5,
          lineStyle: { width: 2.2 },
        },
      ],
    };
  }, [thkTrend]);

  return (
    <div className="relative w-full text-gray-100">
      {/* Header / KPI */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        <div className="col-span-6 flex justify-between items-center">
          <div className="text-sm text-gray-400">
            Data layer: <span className="text-blue-400 font-semibold">{layer}</span>
          </div>

          {/* 右上角 model selector */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">
              Model: <span className="text-blue-300 font-medium">{aiModel}</span>
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

        {[
          { title: "Capacity (Month)", value: kpi?.capacity, unit: "片", note: "由 mes_totals 提供（若為 demo 分母會有誤差）" },
          { title: "Confirmed Scrap", value: kpi?.confirmed, unit: "片", note: "以 counter-delta 計算（避免累積值被加總）" },
          { title: "Pending Scrap", value: kpi?.pending, unit: "片" },
          { title: "Scrap Rate", value: kpi?.scrap_rate !== undefined ? safeNum(kpi?.scrap_rate) : "--", unit: "%", size: "xl", color: "text-red-400" },
          { title: "Yield", value: safeNum(kpi?.yield_rate), unit: "%", size: "xl", color: yieldColor(kpi?.yield_rate) },
          { title: "Utilization", value: kpi?.utilization !== undefined ? safeNum(kpi?.utilization) : "--", unit: "%", color: utilizationColor(kpi?.utilization), note: "(utilization 目前為估算/或由 machine_state 事件推算)" },
        ].map((c, idx) => (
          <div
            key={idx}
            className={`col-span-1 bg-slate-800/40 rounded-xl p-4 border ${kpiBorderClass(c.color)}`}
          >
            <div className="text-xs text-gray-400 mb-1">{c.title}</div>
            <div className={`${c.size === "xl" ? "text-xl" : "text-base"} font-semibold ${c.color || ""}`}>
              {c.value !== undefined && c.value !== null && c.value !== ""
                ? `${c.value} ${c.unit || ""}`
                : "--"}
            </div>
            {c.note && <div className="text-xs text-gray-500 mt-1">{c.note}</div>}
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-12 gap-5">
        {/* Gauges */}
        <div className="col-span-4 space-y-4">
          <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
            <div className="text-xs text-gray-400 mb-2">Yield Gauge</div>
            <ReactECharts option={yieldGaugeOpt} style={{ height: 240, width: "100%" }} notMerge />
          </div>

          <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
            <div className="flex justify-between text-xs text-gray-400 mb-2">
              <span>CMP Thickness Mean</span>
              <span>目標 100 ± 10 nm</span>
            </div>
            <ReactECharts option={thkGaugeOpt} style={{ height: 240, width: "100%" }} notMerge />
          </div>
        </div>

        {/* Defect + Trend */}
        <div className="col-span-4 space-y-4">
          <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
            <div className="text-xs text-gray-400 mb-1">Defect Type Share</div>
            <ReactECharts option={defectOpt} style={{ height: 240, width: "100%" }} />
          </div>

          <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
            <div className="text-xs text-gray-400 mb-1">CMP Thickness Trend (24h)</div>
            <ReactECharts option={thkTrendOptUI} style={{ height: 240, width: "100%" }} />
          </div>
        </div>

        {/* Right column */}
        <div className="col-span-4">
          <div className="bg-slate-800/80 rounded-xl border border-white/5 p-5 h-full flex flex-col gap-4 ring-1 ring-blue-400/20 shadow-lg shadow-blue-500/10 transition-shadow duration-200 hover:shadow-md">
            {/* AI Summary */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const L = (aiPanel?.risk_level || "").toUpperCase();
                    // Signal-grade status light — graded, glow + pulse + halo
                    if (L === "CRITICAL") {
                      return (
                        <span className="relative flex h-3.5 w-3.5 flex-shrink-0" title="CRITICAL">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-red-500 shadow-[0_0_14px_4px_rgba(239,68,68,1)] ring-2 ring-red-400/80" />
                        </span>
                      );
                    }
                    if (L === "HIGH") {
                      return (
                        <span className="relative flex h-3.5 w-3.5 flex-shrink-0" title="HIGH">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-50" />
                          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-orange-500 shadow-[0_0_12px_3px_rgba(249,115,22,0.95)] ring-2 ring-orange-400/70 animate-pulse" />
                        </span>
                      );
                    }
                    if (L === "MEDIUM") {
                      return (
                        <span className="inline-block h-3.5 w-3.5 rounded-full flex-shrink-0 bg-amber-400 shadow-[0_0_10px_3px_rgba(251,191,36,0.85)] ring-2 ring-amber-300/60 animate-pulse" title="MEDIUM" />
                      );
                    }
                    if (L === "LOW") {
                      return (
                        <span className="inline-block h-3.5 w-3.5 rounded-full flex-shrink-0 bg-emerald-400 shadow-[0_0_7px_2px_rgba(52,211,153,0.7)] ring-2 ring-emerald-300/50" title="LOW" />
                      );
                    }
                    return (
                      <span className="inline-block h-3.5 w-3.5 rounded-full flex-shrink-0 bg-slate-500 ring-1 ring-slate-400/30" title="UNKNOWN" />
                    );
                  })()}
                  <span className="text-xs font-semibold text-gray-200 tracking-wide">AI Summary</span>
                  <span className="text-xs text-gray-500">· {aiModel}</span>
                </div>
                <div className="flex gap-1.5 items-center">
                  <span className={`text-xs px-3 py-1 rounded-full border font-medium ${summaryBadgeColor(aiPanel?.risk_level)}`}>
                    {`Risk: ${(aiPanel?.risk_level || "").toUpperCase() || "—"}`}
                  </span>
                </div>
              </div>
              {/* Risk headline — primary executive signal */}
              {(() => {
                const L = (aiPanel?.risk_level || "").toUpperCase();
                if (!L || L === "UNKNOWN") return null;
                const warnIcon = (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 12H1L7 1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                    <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="7" cy="10" r="0.7" fill="currentColor"/>
                  </svg>
                );
                const playIcon = (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3.5 2.5L11 7L3.5 11.5V2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="currentColor" fillOpacity="0.25"/>
                  </svg>
                );
                const checkIcon = (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                );
                const cfg =
                  L === "CRITICAL"
                    ? { icon: warnIcon,  text: "Critical Risk",          cls: "text-red-300",     bg: "bg-red-500/20"     }
                    : L === "HIGH"
                    ? { icon: warnIcon,  text: "Quality Risk Detected",  cls: "text-orange-300",  bg: "bg-orange-500/20"  }
                    : L === "MEDIUM"
                    ? { icon: playIcon,  text: "Monitoring Active",      cls: "text-amber-300",   bg: "bg-amber-500/20"   }
                    : { icon: checkIcon, text: "Normal Operations",      cls: "text-emerald-300", bg: "bg-emerald-500/20" };
                return (
                  <div className={`flex items-center gap-2 text-base font-bold mb-3 px-3 py-2.5 rounded-md ${cfg.bg} ${cfg.cls}`}>
                    {cfg.icon}
                    <span className="uppercase tracking-wider">{cfg.text}</span>
                  </div>
                );
              })()}

              {/* Primary driver */}
              {(topMachine || defectShare[0]?.name) && (
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-shrink-0">Driver</span>
                  <span className="text-xs text-gray-400 leading-relaxed">
                    {topMachine && defectShare[0]?.name
                      ? `${topMachine} — ${defectShare[0].name} defects dominate`
                      : `${defectShare[0]?.name || topMachine}`}
                  </span>
                </div>
              )}

{(() => {
                const parsed = parseSummaryJson(aiSummary);
                if (parsed) {
                  return (
                    <div className="space-y-3 text-sm">
                      {parsed.summary && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Summary</div>
                          <div className="text-gray-100 leading-relaxed">{firstSentence(parsed.summary)}</div>
                        </div>
                      )}
                      {Array.isArray(parsed.recommended_actions) && parsed.recommended_actions.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Recommended Actions</div>
                          <ul className="list-disc list-outside pl-4 text-gray-200 space-y-0.5">
                            {parsed.recommended_actions.slice(0, 2).map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="text-sm leading-relaxed whitespace-pre-line text-gray-100">
                    {firstSentence(aiSummary) || "（今日無異常）"}
                  </div>
                );
              })()}
            </div>

            {/* CTA — single primary action row (dashboard-style) */}
            <Link
              to="/ai-decision"
              className="group mt-auto -mx-5 -mb-5 px-5 py-3.5 border-t border-white/5 flex items-center justify-between hover:bg-blue-500/10 hover:border-blue-400/20 transition-all duration-150 rounded-b-xl"
            >
              {/* Left: icon + labels */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-400/20 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500/20 group-hover:border-blue-400/40 transition-all duration-150">
                  <svg className="w-4 h-4 text-blue-300" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor"/>
                    <line x1="8" y1="1.5" x2="8" y2="3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <line x1="1.5" y1="8" x2="3.5" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <line x1="12.5" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="leading-tight min-w-0">
                  <div className="text-xs font-semibold text-gray-200 group-hover:text-white transition-colors duration-150">
                    Full AI Decision Report
                  </div>
                  <div className="text-[10px] text-gray-500 group-hover:text-gray-400 mt-0.5 truncate">
                    Root cause · Actions · Explainability
                  </div>
                </div>
              </div>
              {/* Right: arrow pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-400/20 group-hover:bg-blue-500 group-hover:border-blue-400 transition-all duration-150 flex-shrink-0 ml-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-300 group-hover:text-white transition-colors duration-150">
                  Open
                </span>
                <svg className="w-3 h-3 text-blue-300 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-150" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6H10M7 3L10 6L7 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </Link>


          </div>
        </div>
      </div>

      {/* Scrap tables */}
      <div className="grid grid-cols-2 gap-5 mt-6">
        <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-xs font-medium text-gray-500 tracking-wide">本週報廢</div>
            <button
              className="text-xs text-gray-300 border border-white/10 px-2 py-1 rounded-full hover:bg-white/5 transition-all duration-150 active:scale-95"
              onClick={() => setOpenWeek((v) => !v)}
            >
              {openWeek ? "收合" : "展開"}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto text-xs">
            {weekScrap.length === 0 ? (
              <div className="text-gray-500">無資料</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="text-xs text-gray-400 border-b border-white/10">
                  <tr>
                    <th className="py-1 pr-2">Lot</th>
                    <th className="py-1 pr-2">時間</th>
                    <th className="py-1 pr-2">機台</th>
                    <th className="py-1 pr-2">片數</th>
                    <th className="py-1">缺陷</th>
                  </tr>
                </thead>
                <tbody>
                  {(openWeek ? weekScrap : weekScrap.slice(0, 3)).map((r, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-slate-700/30 ${topMachine && r.machine === topMachine ? "border-l-2 border-l-amber-400 bg-amber-400/5" : ""}`}
                    >
                      <td className="py-1 pr-2">{r.lot}</td>
                      <td className="py-1 pr-2">{r.time}</td>
                      <td className="py-1 pr-2">{r.machine}</td>
                      <td className="py-1 pr-2">{r.qty}</td>
                      <td className="py-1">{r.defect_type ?? r.defect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-slate-800/40 rounded-xl border border-white/5 p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-xs font-medium text-gray-500 tracking-wide">本月報廢</div>
            <button
              className="text-xs text-gray-300 border border-white/10 px-2 py-1 rounded-full hover:bg-white/5 transition-all duration-150 active:scale-95"
              onClick={() => setOpenMonth((v) => !v)}
            >
              {openMonth ? "收合" : "展開"}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto text-xs">
            {monthScrap.length === 0 ? (
              <div className="text-gray-500">無資料</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="text-xs text-gray-400 border-b border-white/10">
                  <tr>
                    <th className="py-1 pr-2">Lot</th>
                    <th className="py-1 pr-2">時間</th>
                    <th className="py-1 pr-2">機台</th>
                    <th className="py-1 pr-2">片數</th>
                    <th className="py-1">缺陷</th>
                  </tr>
                </thead>
                <tbody>
                  {(openMonth ? monthScrap : monthScrap.slice(0, 3)).map((r, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-slate-700/30 ${topMachine && r.machine === topMachine ? "border-l-2 border-l-amber-400 bg-amber-400/5" : ""}`}
                    >
                      <td className="py-1 pr-2">{r.lot}</td>
                      <td className="py-1 pr-2">{r.time}</td>
                      <td className="py-1 pr-2">{r.machine}</td>
                      <td className="py-1 pr-2">{r.qty}</td>
                      <td className="py-1">{r.defect_type ?? r.defect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <FabChatbox layer={layer} aiModel={aiModel} setAiModel={setAiModel} />
    </div>
  );
}