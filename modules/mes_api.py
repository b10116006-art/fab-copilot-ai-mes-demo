# mes_api.py
from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient, DESCENDING, ASCENDING
from pymongo.collection import Collection

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(_Path(__file__).resolve().parent.parent / ".env")
    load_dotenv(_Path(__file__).resolve().parent / ".env", override=False)
except Exception:
    pass

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME") or os.getenv("MONGO_DB") or "mes_copilot"

COL_REALTIME_SCRAP = os.getenv("COL_REALTIME_SCRAP", "realtime_scrap")
COL_MES_TOTALS = os.getenv("COL_MES_TOTALS", "mes_totals")
COL_MACHINE_STATE = os.getenv("COL_MACHINE_STATE", "machine_state")
COL_MACHINE_STATE_EVENTS = os.getenv("COL_MACHINE_STATE_EVENTS", "machine_state_events")
COL_AI_MEMORY = os.getenv("COL_AI_MEMORY", "ai_memory_events")
COL_AI_WORKFLOW = os.getenv("COL_AI_WORKFLOW", "ai_workflow_events")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
GEMINI_FLASH_MODEL = os.getenv("OPENROUTER_GEMINI_FLASH_MODEL", os.getenv("GEMINI_FLASH_MODEL", "google/gemini-flash-1.5")).strip()
GEMINI_PRO_MODEL = os.getenv("OPENROUTER_GEMINI_PRO_MODEL", os.getenv("GEMINI_PRO_MODEL", "google/gemini-pro-1.5")).strip()

# Phase E2 — LINE Bot execution config (safe defaults; execution disabled by default)
LINE_BOT_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
LINE_PUSH_USER_ID = (
    os.getenv("LINE_PUSH_USER_ID")
    or os.getenv("LINE_USER_ID")
    or ""
).strip()
LINE_E2_AUTO_EXECUTE = os.getenv("LINE_E2_AUTO_EXECUTE", "false").strip().lower() == "true"

DEFAULT_WINDOW_HOURS = int(os.getenv("DEFAULT_WINDOW_HOURS", "24"))
DEFAULT_MONTH_DAYS = 30
DEFAULT_EVENT_MINUTES_EST = float(os.getenv("UTIL_EVENT_MINUTES_EST", "0.5"))
UTIL_CAP_PCT = float(os.getenv("UTIL_CAP_PCT", "95"))

_ALLOWED_LAYERS = {"ILD", "PSG", "STI"}
KNOWN_MACHINES = ["QA1", "QA2", "QA3", "QA4", "QA6", "QA7", "RA1", "RA2", "RA5"]

app = FastAPI(title="FAB Copilot MES API", version="stable_repair_v1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_mongo_client: Optional[MongoClient] = None

def get_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4000)
    return _mongo_client

def col(name: str) -> Collection:
    return get_client()[DB_NAME][name]

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


@app.on_event("startup")
def _ensure_ai_memory_indexes() -> None:
    try:
        col(COL_AI_MEMORY).create_index(
            [("layer", ASCENDING), ("machine_id", ASCENDING), ("created_at", DESCENDING)],
            name="layer_machine_created",
            background=True,
        )
    except Exception as e:
        print(f"[startup] ai_memory_events index creation failed (non-fatal): {e}")


# ---------------------------------------------------------------------------
# Phase A — Memory Layer helpers
# Sidecar only. Neither function ever raises — all exceptions are caught and
# printed so they cannot affect the existing /overview/ai response contract.
# ---------------------------------------------------------------------------

def parse_llm_structured_output(reply: str) -> Dict[str, Any]:
    """
    Phase B — extract structured fields from LLM reply.
    Strategy 1: parse bare JSON or ```json fenced block.
    Strategy 2: line-based heuristic section extraction.
    Strategy 3: safe defaults (Phase A behavior preserved).
    """
    out: Dict[str, Any] = {
        "summary": "",
        "possible_root_causes": [],
        "engineering_evidence": [],
        "recommended_actions": [],
        "confidence": None,
        "anomaly_type": "general",
    }
    if not reply:
        return out
    import re
    # Strategy 1: JSON extraction
    json_block = None
    m = re.search(r"```json\s*([\s\S]+?)```", reply, re.IGNORECASE)
    if m:
        json_block = m.group(1).strip()
    else:
        # ===============================
        # [PATCH v1] Structured Output Fix — Patch 1: JSON safe extraction
        # ===============================
        _brace = reply.find("{")
        if _brace != -1:
            reply_json_part = reply[_brace:]
        else:
            reply_json_part = reply
        # ===============================
        m = re.search(r"(\{[\s\S]+\})", reply_json_part)
        if m:
            json_block = m.group(1).strip()
    if json_block:
        try:
            parsed = json.loads(json_block)
            if isinstance(parsed, dict):
                # ===============================
                # [PATCH v1] Structured Output Fix — Patch 2: list coercion
                # ===============================
                for _arr_key in ("possible_root_causes", "engineering_evidence", "recommended_actions"):
                    _val = parsed.get(_arr_key)
                    if isinstance(_val, list):
                        parsed[_arr_key] = [str(x) for x in _val[:8]]
                    elif isinstance(_val, str) and _val.strip():
                        parsed[_arr_key] = [
                            s.strip() for s in _val.split(",") if s.strip()
                        ][:8]
                    else:
                        parsed[_arr_key] = []
                # ===============================
                # [PATCH v1] Structured Output Fix — Patch 3: summary fallback
                # ===============================
                if not parsed.get("summary") or not str(parsed.get("summary")).strip():
                    parsed["summary"] = str(reply)[:500]
                # ===============================
                if isinstance(parsed.get("summary"), str):
                    out["summary"] = parsed["summary"][:500]
                if isinstance(parsed.get("possible_root_causes"), list):
                    out["possible_root_causes"] = [str(x) for x in parsed["possible_root_causes"][:8]]
                if isinstance(parsed.get("engineering_evidence"), list):
                    out["engineering_evidence"] = [str(x) for x in parsed["engineering_evidence"][:8]]
                if isinstance(parsed.get("recommended_actions"), list):
                    out["recommended_actions"] = [str(x) for x in parsed["recommended_actions"][:8]]
                raw_conf = parsed.get("confidence")
                if raw_conf is not None:
                    try:
                        v = float(str(raw_conf).replace("%", "").strip())
                        v = v / 100.0 if v > 1.0 else v
                        out["confidence"] = max(0.0, min(1.0, v))
                    except Exception:
                        pass
                _ANOMALY_VALID = {"scrap_high", "thk_drift", "machine_down", "particle", "scratch", "general"}
                if isinstance(parsed.get("anomaly_type"), str):
                    _at = parsed["anomaly_type"].strip().lower()
                    out["anomaly_type"] = _at if _at in _ANOMALY_VALID else "general"
                return out
        except Exception:
            pass
    # Strategy 2: line-based heuristic
    section_map = {
        "summary":              ["summary", "摘要", "診斷"],
        "possible_root_causes": ["possible_root_cause", "root_cause", "root cause", "可能原因"],
        "engineering_evidence": ["engineering_evidence", "evidence", "證據"],
        "recommended_actions":  ["recommended_action", "action", "建議"],
    }
    current_section: Optional[str] = None
    summary_lines: List[str] = []
    for line in reply.splitlines():
        stripped = line.strip().lower()
        matched = False
        for field, keywords in section_map.items():
            if any(kw in stripped for kw in keywords):
                current_section = field
                matched = True
                break
        if matched:
            continue
        text = line.strip().lstrip("-*、。•").strip()
        if not text:
            continue
        if current_section == "summary":
            summary_lines.append(text)
        elif current_section in ("possible_root_causes", "engineering_evidence", "recommended_actions"):
            lst = out[current_section]
            if len(lst) < 8:
                lst.append(text)
    if summary_lines:
        out["summary"] = " ".join(summary_lines)[:500]
    # Strategy 2 — anomaly_type: scan for ANOMALY_TYPE: line pattern
    _m_at = re.search(r"ANOMALY_TYPE:\s*([a-z_]+)", reply, re.IGNORECASE)
    if _m_at:
        _ANOMALY_VALID2 = {"scrap_high", "thk_drift", "machine_down", "particle", "scratch", "general"}
        _at2 = _m_at.group(1).strip().lower()
        out["anomaly_type"] = _at2 if _at2 in _ANOMALY_VALID2 else "general"
    # Strategy 3: raw fallback
    if not out["summary"]:
        out["summary"] = str(reply)[:500]
    return out


def save_memory_event(
    layer: str,
    machine_id: Optional[str],
    anomaly_type: str,
    summary: str,
    possible_root_causes: Optional[List[str]] = None,
    evidence: Optional[Dict[str, Any]] = None,
    recommended_actions: Optional[List[str]] = None,
    confidence: Optional[float] = None,
    source: str = "llm",
    window: Optional[str] = None,
) -> None:
    try:
        ts = now_utc()
        doc = {
            "ts":                   ts,
            "machine_id":           str(machine_id or "").upper() or None,
            "layer":                parse_layer(layer),
            "anomaly_type":         str(anomaly_type or "general"),
            "summary":              str(summary or ""),
            "possible_root_causes": possible_root_causes or [],
            "evidence":             evidence or {},
            "recommended_actions":  recommended_actions or [],
            "confidence":           float(confidence) if confidence is not None else None,
            "source":               str(source or "llm"),
            "window":               str(window or "24h"),
            "created_at":           ts,
        }
        col(COL_AI_MEMORY).insert_one(doc)
    except Exception as e:
        print(f"[memory] save_memory_event failed (non-fatal): {e}")


def get_recent_memory(
    layer: str,
    machine_id: Optional[str] = None,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    try:
        q: Dict[str, Any] = {"layer": parse_layer(layer)}
        if machine_id:
            q["machine_id"] = str(machine_id).upper()
        docs = list(
            col(COL_AI_MEMORY)
            .find(
                q,
                {"_id": 0, "summary": 1, "anomaly_type": 1,
                 "possible_root_causes": 1, "created_at": 1},
            )
            .sort([("created_at", DESCENDING)])
            .limit(max(1, min(int(limit), 10)))
        )
        return docs
    except Exception as e:
        print(f"[memory] get_recent_memory failed (non-fatal): {e}")
        return []


def get_ranked_memory(
    layer: str,
    machine_id: Optional[str] = None,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    """
    Phase B+ — ranked memory retrieval.
    Fetches a broader pool then scores each record by:
      score = 0.2 * anomaly_type_match + 0.5 * confidence + 0.3 * recency
    Uses the most recent record's anomaly_type as the match hint (pre-LLM proxy).
    Returns top `limit` records sorted by score DESC.
    Falls back to empty list on any error (non-fatal).
    """
    try:
        q: Dict[str, Any] = {
            "layer": parse_layer(layer),
            "source": {"$ne": "line_sent"},
        }
        if machine_id:
            q["machine_id"] = str(machine_id).upper()
        pool_limit = max(limit * 3, 9)
        docs = list(
            col(COL_AI_MEMORY)
            .find(
                q,
                {"_id": 0, "summary": 1, "anomaly_type": 1,
                 "possible_root_causes": 1, "confidence": 1, "created_at": 1},
            )
            .sort([("created_at", DESCENDING)])
            .limit(pool_limit)
        )
        if not docs:
            return []
        _type_hint = docs[0].get("anomaly_type", "general")
        _now = now_utc()
        def _score(r: Dict[str, Any]) -> float:
            conf = float(r.get("confidence") or 0.5)
            conf = max(0.0, min(1.0, conf))
            ts = r.get("created_at")
            if isinstance(ts, datetime):
                _ts = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
                age_h = max(0.0, (_now - _ts).total_seconds() / 3600.0)
            else:
                age_h = 999.0
            recency = 1.0 / (1.0 + age_h)
            type_match = 1.0 if r.get("anomaly_type") == _type_hint else 0.0
            return 0.2 * type_match + 0.5 * conf + 0.3 * recency
        docs.sort(key=_score, reverse=True)
        return docs[:limit]
    except Exception as e:
        print(f"[memory] get_ranked_memory failed (non-fatal): {e}")
        return []


def format_memory_context(records: List[Dict[str, Any]]) -> str:
    if not records:
        return ""
    lines = ["--- Recent memory (last similar analyses) ---"]
    for r in records:
        ts = r.get("created_at")
        ts_str = (
            ts.strftime("%Y-%m-%d %H:%M") if isinstance(ts, datetime) else str(ts or "")
        )
        lines.append(
            f"[{ts_str}] type={r.get('anomaly_type', '?')}" 
            f" summary={str(r.get('summary', ''))[:120]}"
            f" causes={r.get('possible_root_causes', [])}"
        )
    lines.append("---")
    return "\n".join(lines)


def format_ranked_memory_context(records: List[Dict[str, Any]]) -> str:
    """
    Phase B+ — prompt-ready formatting for ranked memory records.
    Produces numbered 'Relevant past cases' block for LLM context injection.
    Returns empty string if no records (prompt injection safely skipped).
    """
    if not records:
        return ""
    lines = ["Relevant past cases:"]
    for i, r in enumerate(records, 1):
        ts = r.get("created_at")
        ts_str = ts.strftime("%Y-%m-%d %H:%M") if isinstance(ts, datetime) else str(ts or "")
        conf = r.get("confidence")
        conf_str = f"{conf:.2f}" if isinstance(conf, (int, float)) else "?"
        lines.append(
            f"{i}. [{ts_str}] type={r.get('anomaly_type', '?')} conf={conf_str}"
            f" | {str(r.get('summary', ''))[:150]}"
        )
        causes = r.get("possible_root_causes") or []
        if causes:
            lines.append(f"   causes: {', '.join(str(c) for c in causes[:3])}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Phase C1 — Workflow identity layer (lightweight sidecar, non-blocking)

def find_open_workflow(
    layer: str,
    machine: Optional[str],
    anomaly_type: str,
    window_hours: int = 48,
) -> Optional[Dict[str, Any]]:
    """
    Return the most recent open workflow matching layer + machine + anomaly_type
    within the last window_hours. Returns None if not found or on any error.
    """
    try:
        since = now_utc() - timedelta(hours=window_hours)
        q: Dict[str, Any] = {
            "layer": parse_layer(layer),
            "anomaly_type": anomaly_type,
            "case_status": "open",
            "updated_at": {"$gte": since},
        }
        if machine:
            q["machine_id"] = str(machine).upper()
        return col(COL_AI_WORKFLOW).find_one(q, sort=[("updated_at", DESCENDING)])
    except Exception as e:
        print(f"[workflow] find_open_workflow failed (non-fatal): {e}")
        return None


def create_or_update_workflow(
    workflow_id: str,
    layer: str,
    machine: Optional[str],
    anomaly_type: str,
    summary: str,
    evidence_source: str,
    last_scrap_delta: Optional[int] = None,
    last_top_machine_share: Optional[float] = None,
    last_risk_level: Optional[str] = None,
    last_decision: Optional[str] = None,
    last_confidence: Optional[float] = None,
    case_status: str = "open",
) -> None:
    """
    Upsert an ai_workflow_events document by workflow_id.
    All writes are non-fatal.
    """
    try:
        _now = now_utc()
        col(COL_AI_WORKFLOW).update_one(
            {"workflow_id": workflow_id},
            {
                "$set": {
                    "layer": parse_layer(layer),
                    "machine_id": str(machine).upper() if machine else None,
                    "anomaly_type": anomaly_type,
                    "last_summary": summary[:500] if summary else "",
                    "evidence_source": evidence_source,
                    "case_status": case_status,
                    "updated_at": _now,
                    "last_scrap_delta": last_scrap_delta,
                    "last_top_machine_share": last_top_machine_share,
                    "last_risk_level": last_risk_level,
                    "last_decision": last_decision,
                    "last_confidence": last_confidence,
                },
                "$setOnInsert": {
                    "workflow_id": workflow_id,
                    "created_at": _now,
                },
            },
            upsert=True,
        )
    except Exception as e:
        print(f"[workflow] create_or_update_workflow failed (non-fatal): {e}")


def build_workflow_context(
    workflow_id: str,
    is_existing_case: bool,
    case_status: str,
    case_progression: str = "stable",
) -> Dict[str, Any]:
    return {
        "workflow_id": workflow_id,
        "is_existing_case": is_existing_case,
        "case_status": case_status,
        "case_progression": case_progression,
    }


def compute_case_progression(
    prev_doc: Optional[Dict[str, Any]],
    current_evidence: Dict[str, Any],
) -> str:
    """
    Rule-based case progression from evidence signals.
    Demo heuristics — not final fab thresholds.
    """
    if not prev_doc:
        return "stable"
    try:
        prev_scrap = prev_doc.get("last_scrap_delta")
        prev_share = prev_doc.get("last_top_machine_share")
        if prev_scrap is None and prev_share is None:
            return "stable"
        curr_scrap = safe_int(current_evidence.get("scrap_24h_delta"), 0)
        curr_share = float(current_evidence.get("top_machine_share") or 0.0)
        prev_scrap = safe_int(prev_scrap, 0)
        prev_share = float(prev_share or 0.0)
        worsening = (curr_scrap - prev_scrap >= 2) or (curr_share - prev_share >= 10.0)
        improving = (curr_scrap - prev_scrap <= -2) or (curr_share - prev_share <= -10.0)
        if worsening:
            return "worsening"
        if improving:
            return "improving"
        return "stable"
    except Exception:
        return "stable"


def should_auto_close(
    is_existing_case: bool,
    case_progression: str,
    risk_level: str,
) -> bool:
    """
    Phase C3 — demo heuristic only, not final fab rule.
    Auto-close is allowed ONLY for existing cases that are improving at LOW risk.
    """
    try:
        if not is_existing_case:
            return False
        return case_progression == "improving" and risk_level == "LOW"
    except Exception:
        return False


def close_workflow(workflow_id: str, reason: str) -> None:
    """
    Phase C3 — mark a workflow as resolved.
    Non-fatal. Does not raise.
    """
    try:
        col(COL_AI_WORKFLOW).update_one(
            {"workflow_id": workflow_id},
            {"$set": {
                "case_status": "resolved",
                "closed_at": now_utc(),
                "closed_reason": reason,
            }},
        )
    except Exception as e:
        print(f"[workflow] close_workflow failed (non-fatal): {e}")


def compute_trigger_gate(
    trigger: Dict[str, Any],
    case_status: str,
) -> str:
    """
    Phase C5 — explicit execution-safety gate for action triggers.
    Demo heuristic only — not final fab policy.
    Returns: "blocked" | "preview_eligible" | "advisory"
    Never raises.
    """
    try:
        trigger_type     = str(trigger.get("trigger_type") or "monitor_only")
        suggested_channel = str(trigger.get("suggested_channel") or "log_only")
        if case_status == "resolved" or trigger_type == "monitor_only":
            return "blocked"
        if suggested_channel == "line_bot":
            return "preview_eligible"
        return "advisory"
    except Exception:
        return "advisory"


# ---------------------------------------------------------------------------
# Phase D2b — anomaly tag extractor
def extract_anomaly_tag(reply: str) -> str:
    _VALID = {"scrap_high", "thk_drift", "machine_down",
              "particle", "scratch", "general"}
    try:
        import re
        m = re.search(r"ANOMALY_TYPE:\s*([a-z_]+)", reply or "", re.IGNORECASE)
        if m:
            val = m.group(1).strip().lower()
            return val if val in _VALID else "general"
    except Exception:
        pass
    return "general"


# Phase C — Decision Layer
# Rule-based only. No new LLM call. Never raises.
# decision:  monitor | investigate_machine | check_material |
#            check_cleanliness | escalate
# priority:  low | medium | high
# ---------------------------------------------------------------------------

def derive_decision(
    evd: Dict[str, Any],
    parsed: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Derive a decision recommendation from evidence + parsed LLM fields.
    evd    : output of build_evidence()
    parsed : output of parse_llm_structured_output() or safe-default dict
    Returns dict with keys: decision, priority, reason, recommended_next_step.
    """
    try:
        scrap    = safe_int(evd.get("scrap_24h_delta"), 0)
        share    = float(evd.get("top_machine_share") or 0.0)
        top_m    = str(evd.get("top_machine") or "")
        top_defs = evd.get("top_defects") or []
        top_def  = top_defs[0]["defect_type"] if top_defs else ""
        anomaly  = str(parsed.get("anomaly_type") or "general").lower()

        if scrap >= 5 or share >= 70:
            priority = "high"
        elif scrap >= 2 or share >= 40:
            priority = "medium"
        else:
            priority = "low"

        if priority == "high" and (anomaly == "machine_down" or share >= 70):
            decision  = "escalate"
            reason    = f"Machine {top_m} accounts for {share:.0f}% of scrap (anomaly={anomaly})."
            next_step = f"Immediately inspect {top_m}: hardware, consumables, and recent PMs."
        elif anomaly in ("machine_down", "scrap_high") and share >= 40:
            decision  = "investigate_machine"
            reason    = f"Top machine {top_m} dominates scrap ({share:.0f}%) with anomaly={anomaly}."
            next_step = f"Review {top_m} machine log, consumable history, and last PM date."
        elif top_def.lower() in ("particle", "contamination"):
            decision  = "check_cleanliness"
            reason    = f"Top defect is {top_def}, suggesting cleanliness or consumable issue."
            next_step = "Check clean room conditions, slurry/pad freshness, and wafer handling."
        elif top_def.lower() in ("scratch",):
            decision  = "check_material"
            reason    = f"Top defect is {top_def}, suggesting pad wear or carrier film issue."
            next_step = "Inspect pad wear, conditioning, carrier film, and chuck condition."
        elif anomaly == "thk_drift":
            decision  = "check_material"
            reason    = "THK drift detected; likely recipe or consumable drift."
            next_step = "Run FEM/RDA compensation check and review consumable change history."
        else:
            decision  = "monitor"
            reason    = f"No dominant anomaly pattern (scrap={scrap}, share={share:.0f}%)."
            next_step = "Continue monitoring; re-evaluate if scrap increases next window."

        return {
            "decision":              decision,
            "priority":              priority,
            "reason":                reason,
            "recommended_next_step": next_step,
        }
    except Exception as e:
        print(f"[decision] derive_decision failed (non-fatal): {e}")
        return {
            "decision":              "monitor",
            "priority":              "low",
            "reason":                "Decision derivation failed; defaulting to monitor.",
            "recommended_next_step": "Check system logs.",
        }


# ---------------------------------------------------------------------------
# Phase E1 — Action Trigger Layer
# Maps workflow decision + priority to an external action trigger payload.
# auto_execute is always False in this MVP.
# Never raises.
# ---------------------------------------------------------------------------

def derive_action_trigger(
    workflow: Dict[str, Any],
    evd: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Derive an external action trigger payload from workflow decision + evidence.
    workflow : output of derive_decision()
    evd      : shared evidence dict
    Returns dict with keys:
        trigger_type, trigger_target, trigger_reason,
        suggested_channel, auto_execute
    auto_execute is always False in Phase E1.
    """
    try:
        decision  = str(workflow.get("decision") or "monitor").lower()
        priority  = str(workflow.get("priority") or "low").lower()
        top_m     = str(evd.get("top_machine") or "")
        reason    = str(workflow.get("reason") or "")
        next_step = str(workflow.get("recommended_next_step") or "")

        # trigger_type: what kind of external action this warrants
        if decision == "escalate":
            trigger_type = "urgent_alert"
        elif decision == "investigate_machine":
            trigger_type = "machine_inspection"
        elif decision in ("check_cleanliness", "check_material"):
            trigger_type = "maintenance_check"
        else:
            trigger_type = "monitor_only"

        # trigger_target: what the action points at
        if top_m and decision != "monitor":
            trigger_target = top_m
        else:
            trigger_target = "fab_floor"

        # suggested_channel: where to route notification
        if priority == "high":
            suggested_channel = "line_bot"
        elif priority == "medium":
            suggested_channel = "dashboard"
        else:
            suggested_channel = "log_only"

        return {
            "trigger_type":     trigger_type,
            "trigger_target":   trigger_target,
            "trigger_reason":   reason,
            "suggested_channel": suggested_channel,
            "auto_execute":     LINE_E2_AUTO_EXECUTE,
        }
    except Exception as e:
        print(f"[trigger] derive_action_trigger failed (non-fatal): {e}")
        return {
            "trigger_type":     "monitor_only",
            "trigger_target":   "fab_floor",
            "trigger_reason":   "Trigger derivation failed; defaulting to monitor.",
            "suggested_channel": "log_only",
            "auto_execute":     False,
        }


# ---------------------------------------------------------------------------
# Phase E2 — LINE Bot execution path
# build_line_message_from_trigger : pure builder, never raises, no I/O
# execute_line_trigger            : guarded async sender; auto_execute=False
#                                   by default → preview only
# ---------------------------------------------------------------------------

def build_line_message_from_trigger(
    trigger: Dict[str, Any],
    evd: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build a LINE push message payload from an action_trigger + evidence snapshot.
    Returns dict with keys: messages (LINE API format), meta.
    Never raises.
    """
    try:
        trigger_type   = str(trigger.get("trigger_type") or "monitor_only")
        trigger_target = str(trigger.get("trigger_target") or "fab_floor")
        trigger_reason = str(trigger.get("trigger_reason") or "")
        layer          = str(evd.get("layer") or "")
        top_machine    = str(evd.get("top_machine") or trigger_target)
        top_defs       = evd.get("top_defects") or []
        top_def        = top_defs[0]["defect_type"] if top_defs else "—"
        scrap          = int(evd.get("scrap_24h_delta") or 0)
        share          = float(evd.get("top_machine_share") or 0.0)

        title = f"[FAB Copilot Alert] {layer} — {trigger_type.upper()}"
        body_lines = [
            f"Target    : {trigger_target}",
            f"Top Mach  : {top_machine}  ({share:.1f}% of scrap)",
            f"Top Defect: {top_def}",
            f"Scrap 24h : {scrap} wafers",
        ]
        if trigger_reason:
            body_lines.append(f"Reason    : {trigger_reason[:200]}")
        body = "\n".join(body_lines)
        return {
            "messages": [{"type": "text", "text": f"{title}\n\n{body}"}],
            "meta": {
                "trigger_type":   trigger_type,
                "trigger_target": trigger_target,
                "layer":          layer,
            },
        }
    except Exception as e:
        print(f"[e2] build_line_message_from_trigger failed (non-fatal): {e}")
        return {
            "messages": [{"type": "text", "text": "[FAB Copilot Alert] Trigger preview (build error)"}],
            "meta": {},
        }


async def execute_line_trigger(
    trigger: Dict[str, Any],
    evd: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Phase E2: Execute or preview a LINE push notification derived from action_trigger.
    - suggested_channel != line_bot  → status=skipped (non-fatal)
    - LINE_E2_AUTO_EXECUTE=false     → status=preview_ready (default safe path)
    - Token/user missing             → status=config_missing (non-fatal)
    - Send OK                        → status=sent
    - Send fail                      → status=send_failed / send_error (non-fatal)
    Never raises.
    """
    status_base: Dict[str, Any] = {
        "auto_execute":  LINE_E2_AUTO_EXECUTE,
        "channel":       str(trigger.get("suggested_channel") or "log_only"),
        "trigger_type":  str(trigger.get("trigger_type") or "monitor_only"),
    }

    if trigger.get("suggested_channel") != "line_bot":
        return {**status_base, "status": "skipped",
                "reason": "suggested_channel is not line_bot"}

    payload = build_line_message_from_trigger(trigger, evd)

    if not trigger.get("auto_execute"):
        return {
            **status_base,
            "status":          "preview_ready",
            "reason":          "auto_execute not enabled; preview only",
            "preview_payload": payload,
        }

    # --- guarded auto-execute path ---
    if not LINE_BOT_CHANNEL_ACCESS_TOKEN:
        return {
            **status_base,
            "status":          "config_missing",
            "reason":          "LINE_CHANNEL_ACCESS_TOKEN not configured",
            "preview_payload": payload,
        }
    if not LINE_PUSH_USER_ID:
        return {
            **status_base,
            "status":          "config_missing",
            "reason":          "LINE_PUSH_USER_ID not configured",
            "preview_payload": payload,
        }

    # Phase C — dedup guard: skip if alert already sent within 10 min for same machine/layer
    _machine_id = str(evd.get("top_machine") or "").upper() or None
    _layer_key  = str(evd.get("layer") or "").upper()
    try:
        _dedup_since = now_utc() - timedelta(minutes=10)
        _recent_alert = col(COL_AI_MEMORY).find_one(
            {
                "source":     "line_sent",
                "machine_id": _machine_id,
                "layer":      _layer_key,
                "created_at": {"$gte": _dedup_since},
            },
            {"_id": 1},
        )
        if _recent_alert:
            print(f"[LINE] skipped: duplicate within 10min machine_id={_machine_id} layer={_layer_key}")
            return {
                **status_base,
                "status": "skipped_duplicate",
                "reason": f"alert already sent within 10min for {_machine_id}/{_layer_key}",
            }
    except Exception as _dedup_e:
        print(f"[LINE] dedup check failed (non-fatal, proceeding): {_dedup_e}")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/push",
                headers={
                    "Authorization": f"Bearer {LINE_BOT_CHANNEL_ACCESS_TOKEN}",
                    "Content-Type":  "application/json",
                },
                json={"to": LINE_PUSH_USER_ID, **payload},
            )
        if resp.status_code == 200:
            print(f"[LINE] sent: machine_id={_machine_id} anomaly_type={trigger.get('trigger_type')}")
            try:
                _ts = now_utc()
                col(COL_AI_MEMORY).insert_one({
                    "ts": _ts, "created_at": _ts,
                    "machine_id": _machine_id, "layer": _layer_key,
                    "source": "line_sent",
                    "anomaly_type": str(trigger.get("trigger_type") or "general"),
                    "summary": "", "possible_root_causes": [],
                    "evidence": {}, "recommended_actions": [],
                    "confidence": None, "window": "n/a",
                })
            except Exception:
                pass
            return {**status_base, "status": "sent", "http_status": 200}
        print(f"[LINE] skipped: send_failed http={resp.status_code} machine_id={_machine_id}")
        return {
            **status_base,
            "status":      "send_failed",
            "http_status": resp.status_code,
            "reason":      resp.text[:200],
        }
    except Exception as e:
        print(f"[LINE] skipped: send_error machine_id={_machine_id} err={type(e).__name__}")
        return {**status_base, "status": "send_error",
                "reason": f"{type(e).__name__}: {e}"}


def ensure_aware_utc(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        s = str(v).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def safe_int(x: Any, default: int = 0) -> int:
    try:
        if x is None:
            return default
        return int(float(x))
    except Exception:
        return default

def parse_layer(layer: str) -> str:
    s = str(layer or "ILD").strip().upper()
    return s if s in _ALLOWED_LAYERS else "ILD"

def doc_ts(d: Dict[str, Any]) -> Optional[datetime]:
    for k in ("timestamp", "time", "ts", "_ts", "created_at", "updated_at"):
        if k in d:
            dt = ensure_aware_utc(d.get(k))
            if dt is not None:
                return dt
    return None

def doc_machine(d: Dict[str, Any]) -> str:
    for k in ("machine", "machine_id", "tool_id", "tool", "eqp", "equipment"):
        v = str(d.get(k, "")).strip()
        if v:
            return v.upper()
    return "UNKNOWN"

def doc_defect(d: Dict[str, Any]) -> str:
    for k in ("defect_type", "defect", "defect_code", "code"):
        v = str(d.get(k, "")).strip()
        if v:
            return v
    return "—"

def doc_thk(d: Dict[str, Any]) -> Optional[float]:
    for k in ("thk", "thickness", "thickness_nm", "cmp_thk"):
        if k in d:
            try:
                return float(d.get(k))
            except Exception:
                pass
    return None

def doc_confirmed(d: Dict[str, Any]) -> int:
    return safe_int(d.get("confirmed"), 0)

def doc_pending(d: Dict[str, Any]) -> int:
    return safe_int(d.get("pending"), 0)

def doc_events(d: Dict[str, Any]) -> int:
    return safe_int(d.get("events"), 0)

def doc_lot(d: Dict[str, Any]) -> str:
    for k in ("lot", "lot_id", "lotId"):
        v = str(d.get(k, "")).strip()
        if v:
            return v
    return "-"

def query_realtime_docs(layer: str, hours: int, limit: int) -> List[Dict[str, Any]]:
    layer = parse_layer(layer)
    hours = max(1, min(int(hours), 24 * 30))
    limit = max(100, min(int(limit), 200000))
    since = now_utc() - timedelta(hours=hours)
    c = col(COL_REALTIME_SCRAP)
    proj = {
        "_id": 1, "layer": 1, "timestamp": 1, "time": 1, "ts": 1, "created_at": 1,
        "machine": 1, "machine_id": 1, "tool_id": 1,
        "defect_type": 1, "defect": 1, "defect_code": 1, "code": 1,
        "thk": 1, "thickness": 1, "thickness_nm": 1, "cmp_thk": 1,
        "confirmed": 1, "pending": 1, "events": 1, "lot": 1, "lot_id": 1,
    }
    docs = list(c.find({"layer": layer}, proj).sort([("_id", DESCENDING)]).limit(limit))
    out: List[Dict[str, Any]] = []
    for d in docs:
        dt = doc_ts(d)
        if dt and dt >= since:
            out.append(d)
    out.sort(key=lambda x: doc_ts(x) or datetime(1970, 1, 1, tzinfo=timezone.utc))
    return out

def calc_counter_delta_by_machine(docs: List[Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
    per: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for d in docs:
        per[doc_machine(d)].append(d)
    out: Dict[str, Dict[str, int]] = {}
    for m, items in per.items():
        items.sort(key=lambda x: doc_ts(x) or datetime(1970, 1, 1, tzinfo=timezone.utc))
        c0, p0, e0 = doc_confirmed(items[0]), doc_pending(items[0]), doc_events(items[0])
        c1, p1, e1 = doc_confirmed(items[-1]), doc_pending(items[-1]), doc_events(items[-1])
        out[m] = {
            "confirmed_delta": max(0, c1 - c0),
            "pending_delta": max(0, p1 - p0),
            "events_delta": max(0, e1 - e0),
            "confirmed_last": c1,
            "pending_last": p1,
            "events_last": e1,
        }
    return out

def capacity_env_for_layer(layer: str) -> int:
    return safe_int(os.getenv(f"MES_CAPACITY_MONTH_{parse_layer(layer)}"), 0)

def totals_last_30d(layer: str) -> Tuple[int, int]:
    layer = parse_layer(layer)
    env_cap = capacity_env_for_layer(layer)
    d0 = (now_utc().date() - timedelta(days=30)).isoformat()
    try:
        c = col(COL_MES_TOTALS)
        latest_ws = c.find_one({
            "date": {"$gte": d0},
            "$or": [{"layer": layer}, {"layer": {"$exists": False}}],
            "wafer_total": {"$exists": True},
            "scrap_total": {"$exists": True},
        }, sort=[("date", -1)])
        if latest_ws:
            wafer_total = safe_int(latest_ws.get("wafer_total"), 0)
            scrap_total = safe_int(latest_ws.get("scrap_total"), 0)
            if wafer_total > 0:
                total = env_cap or wafer_total
                good = max(0, total - scrap_total)
                return total, good
    except Exception:
        pass
    try:
        c = col(COL_MES_TOTALS)
        doc = next(c.aggregate([
            {"$match": {"layer": layer, "date": {"$gte": d0}}},
            {"$group": {"_id": None, "total": {"$sum": "$total_moves"}, "good": {"$sum": "$good_moves"}}},
        ]), None)
        total = safe_int((doc or {}).get("total"), 0)
        good = safe_int((doc or {}).get("good"), 0)
        if total > 0:
            total = env_cap or total
            if env_cap and safe_int((doc or {}).get("total"), 0) > 0:
                ratio = good / max(1, safe_int((doc or {}).get("total"), 0))
                good = int(round(total * ratio))
            return total, good
    except Exception:
        pass
    if env_cap > 0:
        return env_cap, int(round(env_cap * 0.95))
    return 0, 0

def state_event_query(layer: str, start: datetime, end: datetime, machine: Optional[str] = None) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"layer": parse_layer(layer), "timestamp": {"$gte": start, "$lte": end}}
    if machine:
        q["machine"] = machine
    proj = {"layer": 1, "machine": 1, "status": 1, "state": 1, "timestamp": 1, "ts": 1}
    return list(col(COL_MACHINE_STATE_EVENTS).find(q, proj).sort([("machine", ASCENDING), ("timestamp", ASCENDING)]).limit(20000))

def machine_universe(layer: str) -> List[str]:
    layer = parse_layer(layer)
    names = set(KNOWN_MACHINES)
    try:
        for d in col(COL_MACHINE_STATE).find({"layer": layer}, {"machine": 1}):
            m = str(d.get("machine") or "").strip().upper()
            if m:
                names.add(m)
    except Exception:
        pass
    return sorted(names)

def compute_machines_utilization_from_state(layer: str, hours: int = 24) -> List[Dict[str, Any]]:
    layer = parse_layer(layer)
    hours = max(1, min(int(hours), 168))
    window_end = now_utc()
    window_start = window_end - timedelta(hours=hours)
    window_minutes = int((window_end - window_start).total_seconds() // 60)
    docs = state_event_query(layer, window_start, window_end)
    if not docs:
        return []

    by_machine: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for d in docs:
        m = str(d.get("machine") or "").strip().upper()
        if m:
            by_machine[m].append(d)

    rows: List[Dict[str, Any]] = []
    for m in machine_universe(layer):
        items = by_machine.get(m, [])
        prior_state = None
        try:
            prev = col(COL_MACHINE_STATE_EVENTS).find_one({"layer": layer, "machine": m, "timestamp": {"$lt": window_start}}, {"status": 1, "state": 1}, sort=[("timestamp", -1)])
            if prev:
                prior_state = str(prev.get("status") or prev.get("state") or "UNKNOWN").upper()
        except Exception:
            pass
        if not prior_state:
            try:
                cur = col(COL_MACHINE_STATE).find_one({"layer": layer, "machine": m}, {"status": 1, "state": 1})
                if cur:
                    prior_state = str(cur.get("status") or cur.get("state") or "UNKNOWN").upper()
            except Exception:
                pass
        cur_state = prior_state or "UNKNOWN"
        cur_ts = window_start
        run_s = down_s = idle_s = 0.0

        for e in items:
            ts = ensure_aware_utc(e.get("timestamp") or e.get("ts"))
            if not ts or ts < window_start:
                continue
            if ts > window_end:
                break
            seg = (ts - cur_ts).total_seconds()
            if seg > 0:
                if cur_state in ("RUN", "UP", "RUNNING", "PRODUCTION"):
                    run_s += seg
                elif cur_state in ("DOWN", "STOP", "ALARM", "ERROR"):
                    down_s += seg
                elif cur_state in ("IDLE", "STANDBY"):
                    idle_s += seg
            cur_state = str(e.get("status") or e.get("state") or "UNKNOWN").upper()
            cur_ts = ts

        tail = (window_end - cur_ts).total_seconds()
        if tail > 0:
            if cur_state in ("RUN", "UP", "RUNNING", "PRODUCTION"):
                run_s += tail
            elif cur_state in ("DOWN", "STOP", "ALARM", "ERROR"):
                down_s += tail
            elif cur_state in ("IDLE", "STANDBY"):
                idle_s += tail

        known_s = run_s + down_s + idle_s
        # only accept rows with meaningful coverage; otherwise they pollute with 0 total
        if known_s < 60:
            continue
        total_minutes = int(round(known_s / 60.0))
        util = round((run_s / known_s) * 100.0, 1) if known_s > 0 else None
        rows.append({
            "machine": m,
            "utilization": util,
            "up": int(round(run_s / 60.0)),
            "down": int(round(down_s / 60.0)),
            "idle": int(round(idle_s / 60.0)),
            "total": total_minutes,
        })
    rows.sort(key=lambda x: (-1 if x["utilization"] is None else -x["utilization"], x["machine"]))
    return rows

def compute_layer_utilization(layer: str, hours: int = 24) -> Optional[float]:
    rows = compute_machines_utilization_from_state(layer, hours=hours)
    good_rows = [r for r in rows if r.get("total", 0) > 0 and r.get("utilization") is not None]
    if good_rows:
        weighted = sum(float(r["utilization"]) * max(1, int(r["total"])) for r in good_rows)
        denom = sum(max(1, int(r["total"])) for r in good_rows)
        return round(weighted / denom, 1) if denom > 0 else None
    # fallback heuristic
    docs = query_realtime_docs(layer=layer, hours=hours, limit=50000)
    if not docs:
        return None
    by_m = Counter(doc_machine(d) for d in docs if doc_machine(d) != "UNKNOWN")
    if not by_m:
        return None
    window_min = float(hours) * 60.0
    utils = []
    for _, cnt in by_m.items():
        active = min(window_min, cnt * DEFAULT_EVENT_MINUTES_EST)
        utils.append(min(UTIL_CAP_PCT, (active / window_min) * 100.0))
    return round(sum(utils) / len(utils), 1) if utils else None

def build_evidence(layer: str) -> Dict[str, Any]:
    # TEMP: limit 50000 -> 1000 to reduce realtime_scrap scan cost
    docs_24 = query_realtime_docs(layer, hours=24, limit=1000)
    deltas = calc_counter_delta_by_machine(docs_24)
    scrap_24 = sum(v["confirmed_delta"] + v["pending_delta"] for v in deltas.values())
    c_def = Counter()
    for d in docs_24:
        k = doc_defect(d)
        if k != "—":
            c_def[k] += 1
    top_def = [{"defect_type": k, "count": int(v)} for k, v in c_def.most_common(8)]
    thks = [t for t in (doc_thk(d) for d in docs_24) if t is not None]
    thk_avg = round(sum(thks) / len(thks), 2) if thks else None
    thk_last = thks[-1] if thks else None
    per_machine_scrap = sorted(((m, v["confirmed_delta"] + v["pending_delta"]) for m, v in deltas.items()), key=lambda x: x[1], reverse=True)
    top_machine = per_machine_scrap[0][0] if per_machine_scrap else None
    top_machine_scrap = per_machine_scrap[0][1] if per_machine_scrap else 0
    top_machine_share = round((top_machine_scrap / scrap_24) * 100.0, 2) if scrap_24 > 0 else 0.0
    return {
        "layer": parse_layer(layer),
        "window_hours": 24,
        "docs_count": len(docs_24),
        "events_raw": len(docs_24),
        "scrap_24h_delta": int(scrap_24),
        "thk_avg": thk_avg,
        "thk_last": thk_last,
        "top_defects": top_def,
        "top_machine": top_machine,
        "top_machine_scrap": int(top_machine_scrap),
        "top_machine_share": float(top_machine_share),
    }

def rule_summary_text(evd: Dict[str, Any]) -> str:
    top_def = evd.get("top_defects") or []
    top_def_1 = top_def[0]["defect_type"] if top_def else None
    return (
        f"診斷：在{evd.get('layer')}層的24小時內，總共記錄了{evd.get('docs_count')}個事件；"
        f"主要缺陷類型包含 {', '.join([x['defect_type'] for x in top_def[:5]])}。"
        f"平均厚度為{evd.get('thk_avg')}μm，最近一次測量為{evd.get('thk_last')}μm。"
        f"主要的缺陷來源機台為{evd.get('top_machine')}，該機台的報廢率為{evd.get('top_machine_share')}%。"
        f"估算報廢約{evd.get('scrap_24h_delta')}片。"
        + (f" Top defect = {top_def_1}。" if top_def_1 else "")
    )

def derive_risk_level(evd: Dict[str, Any]) -> str:
    scrap = safe_int(evd.get("scrap_24h_delta"), 0)
    share = float(evd.get("top_machine_share") or 0.0)
    if scrap >= 5 or share >= 70:
        return "HIGH"
    if scrap >= 2 or share >= 40:
        return "MED"
    return "LOW"

def rule_lines(evd: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    top_defs = evd.get("top_defects") or []
    top_def = top_defs[0]["defect_type"] if top_defs else None
    share = float(evd.get("top_machine_share") or 0.0)
    thk_avg = evd.get("thk_avg")
    thk_last = evd.get("thk_last")
    if top_def:
        lines.append(f"Top defect = {top_def}。")
    if share >= 40:
        lines.append(f"缺陷集中於單一機台（{share:.1f}%）→ 優先檢查 top machine 硬體 / 清洗 / recipe。")
    else:
        lines.append("請先確認 Defect Type 是否集中於單一類型。")
        lines.append("若缺陷集中於少數機台 → 優先檢查該機台硬體 / 清洗。")
    if top_def == "Scratch":
        lines.append("若 top defect = Scratch → 先查 pad wear/conditioning、carrier film、chuck、robot handling。")
    elif top_def == "Particle":
        lines.append("若 top defect = Particle → 優先看耗材 / 硬體 / recipe / handling。")
    if thk_avg is not None and thk_last is not None:
        if abs(float(thk_last) - float(thk_avg)) >= 1.0:
            lines.append("THK 若連續偏薄/偏厚 → 建議 FEM / RDA 補償並觀察 2–3 天。")
        else:
            lines.append("THK 大致穩定 → 若 scrap 升高，多半優先看 defect/cleanliness/handling。")
    return lines

def rule_actions(evd: Dict[str, Any]) -> List[str]:
    top_defs = evd.get("top_defects") or []
    top_def = top_defs[0]["defect_type"] if top_defs else None
    actions: List[str] = []
    if top_def:
        actions.append(f"檢查 top defect：{top_def}，優先看對應耗材 / 硬體 / recipe / handling。")
    if float(evd.get("top_machine_share") or 0) >= 40 and evd.get("top_machine"):
        actions.append(f"鎖定 top machine：{evd.get('top_machine')}，先查機況、耗材與清洗歷程。")
    if safe_int(evd.get("scrap_24h_delta"), 0) <= 1:
        actions.append("目前 scrap 增量不高，先持續監控下一個觀察窗的 defect / machine 變化。")
    else:
        actions.append("請先確認是否為短期異常或趨勢惡化，再決定是否擴大處置範圍。")
    return actions[:4]

def worsening_text(evd: Dict[str, Any]) -> str:
    top_defs = evd.get("top_defects") or []
    top_def = top_defs[0]["defect_type"] if top_defs else "Top defect"
    return f"若 Scrap / THK / {top_def} 在下一個觀察窗持續放大，風險等級將上修，並需鎖定 top machine 做機況與耗材檢查。"

def resolve_provider_model(model: str) -> Tuple[str, str]:
    m = str(model or "auto").strip().lower()
    if m in ("openai", "gpt", "gpt4", "gpt-4o", "gpt-4o-mini"):
        return "openai", OPENAI_MODEL
    if m in ("gemini_flash", "gemini-flash", "flash"):
        return "openrouter", GEMINI_FLASH_MODEL
    if m in ("gemini_pro", "gemini-pro", "pro"):
        return "openrouter", GEMINI_PRO_MODEL
    return "auto", "auto"

class ChatReq(BaseModel):
    session_id: str = "default"
    message: str = ""
    layer: str = "ILD"
    model: str = "auto"

async def call_openai(prompt: str) -> str:
    if not OPENAI_API_KEY or OPENAI_API_KEY.startswith("sk-***"):
        raise RuntimeError("Missing OPENAI_API_KEY")
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a semiconductor manufacturing assistant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

async def call_openrouter(prompt: str, model: str) -> str:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("Missing OPENROUTER_API_KEY")
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a semiconductor manufacturing assistant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

@app.get("/health")
def health() -> Dict[str, Any]:
    mongo_ok = True
    err = ""
    try:
        get_client().admin.command("ping")
    except Exception as e:
        mongo_ok = False
        err = f"{type(e).__name__}: {e}"
    return {
        "ok": True,
        "service": "mes_api",
        "utc": now_utc().isoformat(),
        "mongo_ok": mongo_ok,
        "mongo_db": DB_NAME,
        "machine_state_events_coll": COL_MACHINE_STATE_EVENTS,
        "mongo_error": err,
    }

_KPI_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_KPI_CACHE_TTL_SEC = 30.0

@app.get("/overview/kpi")
def overview_kpi(layer: str = Query("ILD")) -> Dict[str, Any]:
    # [PROFILE] temporary timing log — remove after bottleneck found
    _t0 = now_utc().timestamp()
    layer = parse_layer(layer)
    _now = now_utc().timestamp()
    _hit = _KPI_CACHE.get(layer)
    if _hit and (_now - _hit[0]) < _KPI_CACHE_TTL_SEC:
        print(f"[perf] endpoint=/overview/kpi layer={layer} step=cache_hit total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
        return _hit[1]
    _t = now_utc().timestamp()
    cap_month, good_month = totals_last_30d(layer)
    print(f"[perf] endpoint=/overview/kpi layer={layer} step=totals_last_30d took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    yield_pct = round((good_month / cap_month) * 100.0, 2) if cap_month > 0 else 0.0
    # TEMP: 30d realtime scan removed — was the main bottleneck (~9s).
    # confirmed_30d / pending_30d now stubbed to 0; response schema unchanged.
    confirmed_30d = 0
    pending_30d = 0
    _t = now_utc().timestamp()
    docs_24 = query_realtime_docs(layer, hours=24, limit=5000)
    print(f"[perf] endpoint=/overview/kpi layer={layer} step=query_realtime_docs_24h took={(now_utc().timestamp()-_t):.3f}s docs={len(docs_24)}", flush=True)
    _t = now_utc().timestamp()
    deltas_24 = calc_counter_delta_by_machine(docs_24)
    print(f"[perf] endpoint=/overview/kpi layer={layer} step=calc_counter_delta_24h took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    scrap_total_24h = sum(v["confirmed_delta"] + v["pending_delta"] for v in deltas_24.values())
    daily_capacity = (cap_month / float(DEFAULT_MONTH_DAYS)) if cap_month > 0 else 0.0
    scrap_rate = round((scrap_total_24h / daily_capacity) * 100.0, 2) if daily_capacity > 0 else 0.0
    # TEMP: bypass compute_layer_utilization() — machine_state_events scan is blocking /overview/kpi
    util = None  # was: compute_layer_utilization(layer, hours=24)
    print(f"[perf] endpoint=/overview/kpi layer={layer} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    _resp = {
        "layer": layer,
        "capacity_month": int(cap_month),
        "confirmed_scrap": int(confirmed_30d),
        "pending_scrap": int(pending_30d),
        "scrap_total_24h": int(scrap_total_24h),
        "scrap_rate": float(scrap_rate),
        "yield": float(yield_pct),
        "utilization": util,
        "capacity": int(cap_month),
        "confirmed": int(confirmed_30d),
        "pending": int(pending_30d),
        "yield_rate": float(yield_pct),
    }
    _KPI_CACHE[layer] = (_now, _resp)
    return _resp

@app.get("/overview/defect/share")
def overview_defect_share(layer: str = Query("ILD"), hours: int = Query(DEFAULT_WINDOW_HOURS, ge=1, le=168), limit: int = Query(1000, ge=100, le=200000)) -> List[Dict[str, Any]]:
    _t0 = now_utc().timestamp()
    _layer = parse_layer(layer)
    _t = now_utc().timestamp()
    docs = query_realtime_docs(_layer, hours=hours, limit=limit)
    print(f"[perf] endpoint=/overview/defect/share layer={_layer} step=query_realtime_docs took={(now_utc().timestamp()-_t):.3f}s docs={len(docs)}", flush=True)
    c = Counter(doc_defect(d) for d in docs if doc_defect(d) != "—")
    _resp = [{"name": k, "value": int(v)} for k, v in c.most_common(12)]
    print(f"[perf] endpoint=/overview/defect/share layer={_layer} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    return _resp

@app.get("/overview/trend/thk")
def overview_trend_thk(layer: str = Query("ILD"), hours: int = Query(24, ge=1, le=168), limit: int = Query(1000, ge=100, le=200000)) -> Dict[str, Any]:
    _t0 = now_utc().timestamp()
    _layer = parse_layer(layer)
    _t = now_utc().timestamp()
    docs = query_realtime_docs(_layer, hours=hours, limit=limit)
    print(f"[perf] endpoint=/overview/trend/thk layer={_layer} step=query_realtime_docs took={(now_utc().timestamp()-_t):.3f}s docs={len(docs)}", flush=True)
    x, y = [], []
    for d in docs:
        dt = doc_ts(d)
        thk = doc_thk(d)
        if dt and thk is not None:
            x.append(dt.strftime("%m/%d %H:%M"))
            y.append(float(thk))
    if len(x) > 800:
        x, y = x[-800:], y[-800:]
    print(f"[perf] endpoint=/overview/trend/thk layer={_layer} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    return {"x": x, "y": y}

def scrap_table(layer: str, hours: int, limit_docs: int, max_rows: int) -> List[Dict[str, Any]]:
    rows = []
    for d in reversed(query_realtime_docs(layer, hours=hours, limit=limit_docs)):
        dt = doc_ts(d)
        if not dt:
            continue
        rows.append({"lot": doc_lot(d), "time": dt.strftime("%Y/%m/%d %H:%M:%S"), "machine": doc_machine(d), "qty": 1, "defect_type": doc_defect(d)})
        if len(rows) >= max_rows:
            break
    return rows

@app.get("/overview/scrap/week")
def overview_scrap_week(layer: str = Query("ILD")) -> List[Dict[str, Any]]:
    # Phase 0.6 — restore real aggregation (replaces Phase 0.5 [] stub).
    # Index-aware: relies on {layer:1, _id:-1} on realtime_scrap; max_rows caps payload.
    _t0 = now_utc().timestamp()
    _layer = parse_layer(layer)
    rows = scrap_table(_layer, hours=168, limit_docs=5000, max_rows=200)
    print(f"[perf] endpoint=/overview/scrap/week layer={_layer} step=scrap_table rows={len(rows)} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    return rows

@app.get("/overview/scrap/month")
def overview_scrap_month(layer: str = Query("ILD")) -> List[Dict[str, Any]]:
    # TEMP (Phase 0.6): still stubbed. Do NOT restore until /overview/scrap/week
    # latency is validated under live load with the {layer:1, _id:-1} index.
    # 720h × realtime_scrap is the heaviest scan in the system; reintroducing
    # it prematurely is the known regression path. Schema preserved (List[Dict]).
    _t0 = now_utc().timestamp()
    _layer = parse_layer(layer)
    _resp: List[Dict[str, Any]] = []
    print(f"[perf] endpoint=/overview/scrap/month layer={_layer} step=stub rows=0 total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    return _resp

@app.get("/overview/ai")
async def overview_ai(layer: str = Query("ILD"), model: str = Query("auto")) -> Dict[str, Any]:
    _t0 = now_utc().timestamp()
    layer = parse_layer(layer)
    provider, model_used = resolve_provider_model(model)
    _t = now_utc().timestamp()
    evd = build_evidence(layer)
    print(f"[perf] endpoint=/overview/ai layer={layer} step=build_evidence took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    rule_text = rule_summary_text(evd)

    # Phase B+ — ranked memory retrieval (extends Phase A simple recency fetch)
    _top_machine = evd.get("top_machine") or evd.get("machine")
    _t = now_utc().timestamp()
    memory_records = get_ranked_memory(layer=layer, machine_id=_top_machine, limit=3)
    print(f"[perf] endpoint=/overview/ai layer={layer} step=get_ranked_memory took={(now_utc().timestamp()-_t):.3f}s records={len(memory_records)}", flush=True)
    memory_context = format_ranked_memory_context(memory_records)

    prompt = (
        "You are a semiconductor process engineer AI assistant.\n"
        "Analyze the following fab evidence and return a JSON object ONLY.\n"
        "Do NOT include any text before or after the JSON.\n"
        "Do NOT use markdown fences.\n"
        "Return exactly this JSON structure with these exact keys:\n"
        "{\n"
        "  \"anomaly_type\": \"<one of: scrap_high | thk_drift | machine_down | particle | scratch | general>\",\n"
        "  \"summary\": \"<2-3 sentence engineering summary in Traditional Chinese>\",\n"
        "  \"possible_root_causes\": [\"<cause 1>\", \"<cause 2>\", \"<cause 3>\"],\n"
        "  \"engineering_evidence\": [\"<evidence 1>\", \"<evidence 2>\"],\n"
        "  \"recommended_actions\": [\"<action 1>\", \"<action 2>\", \"<action 3>\"],\n"
        "  \"confidence\": <float between 0.0 and 1.0>\n"
        "}\n\n"
        "IMPORTANT: Output the JSON object only. No explanation. No markdown fences. No text outside the braces.\n\n"
        f"evidence(JSON):\n{json.dumps(evd, ensure_ascii=False)}\n\n"
        f"rule_based_summary:\n{rule_text}\n"
        + (f"\n{memory_context}\n" if memory_context else "")
    )
    llm_ok = False
    llm_error = ""
    reply = rule_text
    _t = now_utc().timestamp()
    try:
        if provider == "openai":
            reply = await call_openai(prompt)
            llm_ok = True
        elif provider == "openrouter":
            reply = await call_openrouter(prompt, model_used)
            llm_ok = True
        else:
            if OPENAI_API_KEY and not OPENAI_API_KEY.startswith("sk-***"):
                reply = await call_openai(prompt)
                provider, model_used = "openai", OPENAI_MODEL
                llm_ok = True
            elif OPENROUTER_API_KEY:
                reply = await call_openrouter(prompt, GEMINI_FLASH_MODEL)
                provider, model_used = "openrouter", GEMINI_FLASH_MODEL
                llm_ok = True
            else:
                llm_error = "No LLM keys; fallback to rule-based"
    except Exception as e:
        llm_error = f"{type(e).__name__}: {e}"
    print(f"[perf] endpoint=/overview/ai layer={layer} step=llm_call provider={provider} llm_ok={llm_ok} took={(now_utc().timestamp()-_t):.3f}s", flush=True)

    # Phase B — parse structured fields, persist to memory
    _parsed = parse_llm_structured_output(reply) if llm_ok else {
        "summary": "", "possible_root_causes": [], "engineering_evidence": [],
        "recommended_actions": [], "confidence": None, "anomaly_type": "general",
    }
    if llm_ok:
        save_memory_event(
            layer=layer,
            machine_id=_top_machine,
            anomaly_type=_parsed["anomaly_type"],
            summary=_parsed["summary"] or str(reply)[:500],
            possible_root_causes=_parsed["possible_root_causes"],
            evidence=evd,
            recommended_actions=_parsed["recommended_actions"],
            confidence=_parsed["confidence"],
            source=provider,
            window="24h",
        )

    # Phase C — derive decision (rule-based, runs even when llm_ok=False)
    _decision = derive_decision(evd, _parsed)

    print(f"[perf] endpoint=/overview/ai layer={layer} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)
    return {
        "layer": layer,
        "model": model,
        "provider_used": provider,
        "model_used": model_used,
        "llm_ok": llm_ok,
        "llm_error": llm_error,
        "rule_based": rule_text,
        "reply": reply,
        "evidence": evd,
        "decision": _decision,
        "memory_used": len(memory_records) > 0,
    }

@app.get("/overview/ai/action")
async def overview_ai_action(layer: str = Query("ILD"), model: str = Query("auto"), message: str = Query(""), session_id: str = Query("default")) -> Dict[str, Any]:
    _t0 = now_utc().timestamp()
    layer = parse_layer(layer)
    provider, model_used = resolve_provider_model(model)
    _t = now_utc().timestamp()
    evd = build_evidence(layer)  # local snapshot for prompt only
    print(f"[perf] endpoint=/overview/ai/action layer={layer} step=build_evidence took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    _prompt_risk = derive_risk_level(evd)
    _prompt_r_lines = rule_lines(evd)
    # Phase C4 — inject ranked memory context into action prompt (matches /overview/ai)
    _prompt_top_machine = evd.get("top_machine") or evd.get("machine")
    _t = now_utc().timestamp()
    _prompt_memory_records = get_ranked_memory(layer=layer, machine_id=_prompt_top_machine, limit=3)
    print(f"[perf] endpoint=/overview/ai/action layer={layer} step=get_ranked_memory took={(now_utc().timestamp()-_t):.3f}s records={len(_prompt_memory_records)}", flush=True)
    _prompt_memory_context = format_ranked_memory_context(_prompt_memory_records)
    reply = ""
    llm_ok = False
    llm_error = ""
    prompt = (
        "你是 FAB Copilot。請用工程師條列式回答，且優先給出可執行的 next action。\n"
        "Before your answer, output exactly one line:\n"
        "ANOMALY_TYPE: <one of: scrap_high | thk_drift | machine_down | particle | scratch | general>\n"
        "Then continue with your normal engineer-style action response.\n\n"
        f"User message: {message}\n\n"
        f"Evidence(JSON): {json.dumps(evd, ensure_ascii=False)}\n\n"
        + (f"{_prompt_memory_context}\n\n" if _prompt_memory_context else "")
        + f"Risk={_prompt_risk}\nRule lines={json.dumps(_prompt_r_lines, ensure_ascii=False)}\n"
    )
    _t = now_utc().timestamp()
    try:
        if provider == "openai":
            reply = await call_openai(prompt)
            llm_ok = True
        elif provider == "openrouter":
            reply = await call_openrouter(prompt, model_used)
            llm_ok = True
        else:
            if OPENAI_API_KEY and not OPENAI_API_KEY.startswith("sk-***"):
                reply = await call_openai(prompt)
                provider, model_used = "openai", OPENAI_MODEL
                llm_ok = True
            elif OPENROUTER_API_KEY:
                reply = await call_openrouter(prompt, GEMINI_FLASH_MODEL)
                provider, model_used = "openrouter", GEMINI_FLASH_MODEL
                llm_ok = True
            else:
                reply = "LLM 無回應，改用本地 Rule-based 建議：請檢查 Top 缺陷與 FEM/THK 趨勢。"
                llm_error = "No LLM keys; fallback to rule-based"
    except Exception as e:
        reply = "LLM 無回應，改用本地 Rule-based 建議：請檢查 Top 缺陷與 FEM/THK 趨勢。"
        llm_error = f"{type(e).__name__}: {e}"
    print(f"[perf] endpoint=/overview/ai/action layer={layer} step=llm_call provider={provider} llm_ok={llm_ok} took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    # Phase D3 — shared evidence alignment
    _t = now_utc().timestamp()
    _shared_evd = evd
    _evd_source = "live"
    try:
        _mem = col(COL_AI_MEMORY).find_one(
            {"layer": layer},
            {"evidence": 1, "machine_id": 1, "anomaly_type": 1, "created_at": 1},
            sort=[("created_at", DESCENDING)],
        )
        if _mem and isinstance(_mem.get("evidence"), dict) and _mem["evidence"]:
            _shared_evd = _mem["evidence"]
            _evd_source = "memory"
        # Phase A debug — alignment validation (remove after confirmed)
        print(f"[d3:mem] _id={_mem.get('_id') if _mem else None} "
              f"machine_id={_mem.get('machine_id') if _mem else None} "
              f"anomaly_type={_mem.get('anomaly_type') if _mem else None} "
              f"created_at={_mem.get('created_at') if _mem else None}")
        print(f"[d3:evd] source={_evd_source} top_machine={_shared_evd.get('top_machine')}")
    except Exception as _e:
        print(f"[d3] memory evidence lookup failed (non-fatal): {_e}")
    print(f"[perf] endpoint=/overview/ai/action layer={layer} step=shared_evidence_lookup source={_evd_source} took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    _t = now_utc().timestamp()
    risk = derive_risk_level(_shared_evd)
    actions = rule_actions(_shared_evd)
    worsening = worsening_text(_shared_evd)
    r_lines = rule_lines(_shared_evd)
    import re as _re
    _clean_reply = _re.sub(
        r"^ANOMALY_TYPE:\s*[a-z_]+[\r\n]+", "", reply, count=1, flags=_re.IGNORECASE
    ).lstrip("\r\n")
    _anomaly_tag = extract_anomaly_tag(reply) if llm_ok else "general"
    _action_parsed = {
        "summary": "", "possible_root_causes": [], "engineering_evidence": [],
        "recommended_actions": [], "confidence": None,
        "anomaly_type": _anomaly_tag,
    }
    _workflow = derive_decision(_shared_evd, _action_parsed)

    # Phase C1 — workflow identity layer (non-blocking sidecar)
    _wf_machine = _shared_evd.get("top_machine") or _shared_evd.get("machine")
    _wf_anomaly = _anomaly_tag or "general"
    _existing_wf = find_open_workflow(layer=layer, machine=_wf_machine, anomaly_type=_wf_anomaly)
    if _existing_wf:
        _workflow_id = str(_existing_wf.get("workflow_id", str(uuid4())))
        _is_existing = True
    else:
        _workflow_id = str(uuid4())
        _is_existing = False
    _case_progression = compute_case_progression(_existing_wf, _shared_evd)
    _current_risk = derive_risk_level(_shared_evd)
    # Phase C3 — closeout: guard ensures new cases are never auto-closed
    if should_auto_close(_is_existing, _case_progression, _current_risk):
        close_workflow(_workflow_id, "auto_rule: improving + LOW risk")
        _case_status = "resolved"
    else:
        _case_status = "open"
    create_or_update_workflow(
        workflow_id=_workflow_id,
        layer=layer,
        machine=_wf_machine,
        anomaly_type=_wf_anomaly,
        summary=_workflow.get("reason", ""),
        evidence_source=_evd_source,
        last_scrap_delta=safe_int(_shared_evd.get("scrap_24h_delta"), None),
        last_top_machine_share=float(_shared_evd.get("top_machine_share") or 0.0),
        last_risk_level=_current_risk,
        last_decision=_workflow.get("decision"),
        last_confidence=_workflow.get("confidence"),
        case_status=_case_status,
    )
    _workflow_context = build_workflow_context(
        workflow_id=_workflow_id,
        is_existing_case=_is_existing,
        case_status=_case_status,
        case_progression=_case_progression,
    )

    # Phase E1 — derive external action trigger from workflow
    _trigger = derive_action_trigger(_workflow, _shared_evd)

    # Phase C5 — gate: inject trigger_gate; suppress preview when blocked
    _trigger["trigger_gate"] = compute_trigger_gate(_trigger, _case_status)
    _line_preview = (
        build_line_message_from_trigger(_trigger, _shared_evd)
        if _trigger.get("suggested_channel") == "line_bot"
        and _trigger["trigger_gate"] != "blocked"
        else None
    )
    _line_status = await execute_line_trigger(_trigger, _shared_evd)
    print(f"[perf] endpoint=/overview/ai/action layer={layer} step=workflow_and_trigger took={(now_utc().timestamp()-_t):.3f}s", flush=True)
    print(f"[perf] endpoint=/overview/ai/action layer={layer} total={(now_utc().timestamp()-_t0):.3f}s", flush=True)

    return {
        "reply": _clean_reply if llm_ok else reply,
        "layer": layer,
        "provider_used": provider,
        "model_used": model_used,
        "llm_ok": llm_ok,
        "llm_error": llm_error,
        "session_id": session_id,
        "risk_level": risk,
        "actions": actions,
        "worsening": worsening,
        "rule_lines": r_lines,
        "workflow": _workflow,
        "action_trigger": _trigger,
        "line_trigger_preview": _line_preview,
        "line_trigger_status":  _line_status,
        "evidence_source": _evd_source,
        "workflow_context": _workflow_context,
    }

@app.post("/chatbot")
async def chatbot(req: ChatReq):
    layer = parse_layer(req.layer)
    return await overview_ai_action(layer=layer, model=req.model, message=(req.message or "").strip(), session_id=req.session_id)

@app.get("/machines/state")
def machines_state(layer: str = Query("ILD"), hours: int = Query(24, ge=1, le=168)) -> Dict[str, Any]:
    layer = parse_layer(layer)
    machines: List[Dict[str, Any]] = []
    try:
        docs = list(col(COL_MACHINE_STATE).aggregate([
            {"$match": {"layer": layer}},
            {"$addFields": {"_ts": {"$ifNull": ["$timestamp", "$ts"]}}},
            {"$sort": {"_ts": -1}},
            {"$group": {
                "_id": "$machine",
                "machine": {"$first": "$machine"},
                "status": {"$first": {"$ifNull": ["$status", "$state"]}},
                "confirmed": {"$first": "$confirmed"},
                "pending": {"$first": "$pending"},
                "events": {"$first": "$events"},
                "timestamp": {"$first": {"$ifNull": ["$timestamp", "$ts"]}},
            }},
            {"$sort": {"machine": 1}},
        ]))
        for d in docs:
            machines.append({
                "machine": d.get("machine") or d.get("_id"),
                "status": d.get("status") or "UNKNOWN",
                "confirmed": safe_int(d.get("confirmed"), 0),
                "pending": safe_int(d.get("pending"), 0),
                "events": safe_int(d.get("events"), 0),
                "timestamp": d.get("timestamp"),
            })
    except Exception:
        machines = []
    existing = {m["machine"] for m in machines if m.get("machine")}
    for m in machine_universe(layer):
        if m not in existing:
            machines.append({"machine": m, "status": "UNKNOWN", "confirmed": 0, "pending": 0, "events": 0, "timestamp": None})
    machines.sort(key=lambda x: str(x.get("machine", "")))
    return {"layer": layer, "machines": machines}

@app.get("/machines/utilization")
def machines_utilization(layer: str = Query("ILD"), hours: int = Query(24)):
    rows = compute_machines_utilization_from_state(layer, hours=hours)
    if rows:
        return rows
    docs = query_realtime_docs(layer=parse_layer(layer), hours=int(hours or 24), limit=1000)
    if not docs:
        return []
    window_min = max(1.0, float(int(hours or 24)) * 60.0)
    by_m = Counter(doc_machine(d) for d in docs if doc_machine(d) != "UNKNOWN")
    out = []
    for m, cnt in by_m.items():
        active_min = min(window_min, cnt * DEFAULT_EVENT_MINUTES_EST)
        out.append({
            "machine": m,
            "utilization": round(min(UTIL_CAP_PCT, (active_min / window_min) * 100.0), 1),
            "up": int(active_min),
            "down": 0,
            "idle": int(max(0.0, window_min - active_min)),
            "total": int(window_min),
        })
    out.sort(key=lambda x: (-x["utilization"], x["machine"]))
    return out

@app.get("/machine/{machine_id}")
def machine_detail(machine_id: str, layer: str = Query("ILD"), hours: int = Query(168, ge=1, le=720), limit: int = Query(200, ge=10, le=2000)) -> List[Dict[str, Any]]:
    docs = query_realtime_docs(parse_layer(layer), hours=hours, limit=200000)
    out = []
    mkey = str(machine_id).strip().upper()
    for d in docs:
        if doc_machine(d) != mkey:
            continue
        dt = doc_ts(d)
        out.append({
            "timestamp": (dt.isoformat() if dt else str(d.get("timestamp", ""))),
            "machine": mkey,
            "layer": parse_layer(layer),
            "confirmed": doc_confirmed(d),
            "pending": doc_pending(d),
            "thk": doc_thk(d),
            "defect_type": doc_defect(d),
            "events": doc_events(d),
        })
        if len(out) >= limit:
            break
    return out

@app.get("/mes/latest_status")
def mes_latest_status(layer: str = Query("PSG"), limit: int = Query(1, ge=1, le=100)) -> Dict[str, Any]:
    docs = query_realtime_docs(parse_layer(layer), hours=720, limit=50000)
    if not docs:
        return {"machine": None, "layer": parse_layer(layer), "scrap_count": None, "thk": None}
    last = docs[-1]
    return {
        "machine": doc_machine(last),
        "layer": parse_layer(layer),
        "scrap_count": doc_confirmed(last) + doc_pending(last),
        "thk": doc_thk(last),
    }

@app.get("/mes/top5_defects")
def mes_top5_defects(layer: str = Query("PSG"), hours: int = Query(24, ge=1, le=168)) -> List[Dict[str, Any]]:
    docs = query_realtime_docs(parse_layer(layer), hours=hours, limit=50000)
    c = Counter(doc_defect(d) for d in docs if doc_defect(d) != "—")
    return [{"defect_type": k, "count": int(v)} for k, v in c.most_common(5)]

@app.get("/mes/thickness_trend")
def mes_thickness_trend(layer: str = Query("PSG"), hours: int = Query(24, ge=1, le=168)) -> List[Dict[str, Any]]:
    docs = query_realtime_docs(parse_layer(layer), hours=hours, limit=50000)
    return [{"timestamp": (doc_ts(d).isoformat() if doc_ts(d) else ""), "thk": doc_thk(d)} for d in docs]


# Phase 0.8 — AOI -> MES decision sidecar. Pure additive router; no existing
# route, schema, or contract is changed. Mounted at end-of-file so all helpers
# this module exposes are already defined when aoi_decision lazy-imports them.
try:
    from aoi_decision import router as _aoi_router
    app.include_router(_aoi_router)
except Exception as _e:
    print(f"[startup] aoi_decision router mount failed (non-fatal): {_e}", flush=True)