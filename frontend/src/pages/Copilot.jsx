// =============================================================
// Copilot.jsx — FAB Copilot Full-Page Chat
// Chat logic moved from FabChatbox in Overview.jsx
// Rendered as a full page (no floating toggle, no drag)
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
function activeModelClass(model) {
  switch (model) {
    case "auto":         return "bg-sky-500 border-sky-300 text-white";
    case "openai":       return "bg-emerald-500 border-emerald-300 text-white";
    case "gemini_flash": return "bg-violet-500 border-violet-300 text-white";
    case "gemini_pro":   return "bg-amber-500 border-amber-300 text-slate-900";
    default:             return "bg-blue-500 border-blue-300 text-white";
  }
}

const SUGGEST = [
  "今天 ILD 報廢是否正常？",
  "THK 偏薄時 FEM / RDA 怎麼調？",
  "請幫我用工程師語氣總結今日風險。",
  "哪一種缺陷占比最高？",
];

// =====================================================
// Copilot — export default
// =====================================================
export default function Copilot() {
  const { layer } = useContext(LayerContext);
  const authFetch = useAuthFetch();

  const [aiModel, setAiModel] = useState("auto");
  const [status, setStatus] = useState("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", text: "您好，我是 FAB Copilot，請問要分析哪個 Layer？" },
  ]);

  const model = aiModel;
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          text: replyText,
          provider: res.provider_used ?? res.provider,
          model: res.model_used ?? res.model,
        },
      ]);
      setStatus("idle");
    } catch (err) {
      console.error("chatbot err:", err);
      setMessages((p) => [
        ...p,
        {
          role: "assistant",
          text: "LLM 無回應，改用本地 Rule-based 建議：請檢查 Top 缺陷與 FEM/THK 趨勢。",
        },
      ]);
      setStatus("error");
    }
  };

  return (
    <div className="relative w-full text-gray-100 flex justify-center">
      <div className="w-full max-w-[680px] bg-[#050816]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col" style={{ minHeight: "70vh" }}>

        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center">
          <div className="text-sm text-white font-semibold flex items-center gap-2">
            FAB Copilot
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "loading"
                  ? "bg-amber-400"
                  : status === "error"
                  ? "bg-red-500"
                  : "bg-emerald-400"
              }`}
            />
            <span className="text-[11px] text-gray-400 ml-3">
              layer: <span className="text-blue-300 font-semibold">{layer}</span>
            </span>
          </div>
          <div className="flex gap-1.5">
            {["auto", "openai", "gemini_flash", "gemini_pro"].map((m) => (
              <button
                key={m}
                onClick={() => setAiModel(m)}
                className={`px-2.5 py-1 rounded-full text-[10px] border ${
                  model === m
                    ? activeModelClass(m)
                    : "border-white/20 text-gray-300 hover:bg-white/5"
                }`}
                title={`switch to ${m}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Message area */}
        <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto text-sm">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-3 py-2 rounded-2xl max-w-[80%] leading-relaxed ${
                  m.role === "user"
                    ? "bg-blue-500 text-white rounded-br-sm"
                    : "bg-white/10 text-gray-200 rounded-bl-sm"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion chips */}
        <div className="px-3 py-2 flex gap-2 overflow-x-auto">
          {SUGGEST.map((s, i) => (
            <button
              key={i}
              onClick={() => setInput(s)}
              className="shrink-0 px-3 py-1 text-[11px] bg-white/5 text-gray-200 rounded-full border border-white/10 hover:bg-white/10 transition-colors duration-150"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div className="border-t border-white/10 px-3 py-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMsg()}
            placeholder={`Ask about ${layer} layer…`}
            className="flex-1 bg-transparent border border-white/20 rounded-full px-3 py-1.5 text-xs text-gray-200"
          />
          <button
            onClick={sendMsg}
            className="px-3 py-1.5 rounded-full text-xs bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all duration-150"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
