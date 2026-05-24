# app_v2_secure.py
# LINE Bot (secure signature) — supports BOTH modes:
# A) direct Mongo query (legacy)
# B) call FastAPI /chatbot (recommended SSOT, same as dashboard)
#
# Use env:
#   LINEBOT_MODE=hybrid|api|direct   (default: hybrid)
#   FASTAPI_BASE_URL=http://127.0.0.1:5000   (optional; default uses VITE_API_BASE_URL or http://127.0.0.1:5000)
#
# NOTE: This file is Flask-based and only handles LINE webhook.
#       Heavy chart/PDF generation should be done by separate scripts (keep webhook fast).

import os
import re
import json
import time
import base64
import hmac
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import requests
from flask import Flask, request, abort
from dotenv import load_dotenv
from pymongo import MongoClient, DESCENDING

# ===== Load SSOT .env (repo root) =====
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_ENV = os.path.join(HERE, ".env")
if os.path.exists(ROOT_ENV):
    load_dotenv(ROOT_ENV, override=True)

# ===== ENV =====
LINE_CHANNEL_SECRET = (os.getenv("LINE_CHANNEL_SECRET") or "").strip()
LINE_CHANNEL_ACCESS_TOKEN = (os.getenv("LINE_CHANNEL_ACCESS_TOKEN") or "").strip()

MONGO_URI = (os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "").strip()
MONGO_DB = (os.getenv("MONGO_DB") or os.getenv("MONGODB_DB") or "").strip()
MONGO_COLL = (os.getenv("MONGO_COLL") or os.getenv("MONGODB_COLL") or "realtime_scrap").strip()

FLASK_PORT = int(os.getenv("FLASK_PORT", "5001"))

LINEBOT_MODE = (os.getenv("LINEBOT_MODE") or "hybrid").strip().lower()

FASTAPI_BASE_URL = (
    os.getenv("FASTAPI_BASE_URL")
    or os.getenv("VITE_API_BASE_URL")
    or os.getenv("VITE_API_BASE")
    or f"http://127.0.0.1:{os.getenv('FASTAPI_PORT','5000')}"
).strip().rstrip("/")

if not LINE_CHANNEL_SECRET or not LINE_CHANNEL_ACCESS_TOKEN:
    raise RuntimeError("Missing LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN in .env")

if not all([MONGO_URI, MONGO_DB, MONGO_COLL]):
    raise RuntimeError("Missing MONGO_URI / MONGO_DB / MONGO_COLL in .env")

# ===== Mongo =====
mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]
scrap_col = mongo_db[MONGO_COLL]

# ===== Flask =====
app = Flask(__name__)

# ===== LINE utils =====
def verify_signature(body: bytes, signature: str) -> bool:
    if not signature:
        return False
    mac = hmac.new(LINE_CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def reply_text(reply_token: str, text: str) -> None:
    headers = {
        "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {"replyToken": reply_token, "messages": [{"type": "text", "text": text}]}
    requests.post("https://api.line.me/v2/bot/message/reply", headers=headers, json=payload, timeout=10)


# ===== Helpers =====
def _norm_layer(s: str) -> str:
    t = (s or "").upper()
    if t in ("ILD", "PSG", "STI"):
        return t
    return "ILD"


def _detect_layer(user_text: str) -> str:
    t = (user_text or "").upper()
    for L in ("ILD", "PSG", "STI"):
        if L in t:
            return L
    return "ILD"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_int(v: Any, d: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return d


# ===== Mode B: call FastAPI /chatbot =====
def call_fastapi_chatbot(user_text: str, layer: str) -> Optional[str]:
    try:
        url = f"{FASTAPI_BASE_URL}/chatbot"
        payload = {"text": user_text, "layer": layer}
        r = requests.post(url, json=payload, timeout=20)
        if not r.ok:
            return None
        data = r.json()
        # support: {"reply": "..."} or {"text": "..."}
        return data.get("reply") or data.get("text") or None
    except Exception:
        return None


# ===== Mode A: direct query Mongo (legacy) =====
def direct_reply(user_text: str, layer: str) -> str:
    t = (user_text or "").strip()

    # Quick command: latest status
    if "最新" in t or "即時" in t or t.lower() in ("status", "now"):
        doc = scrap_col.find_one({"layer": layer}, sort=[("timestamp", DESCENDING)])
        if not doc:
            return f"[{layer}] 目前尚無即時製程資料"
        ts = doc.get("timestamp")
        return (
            f"[{layer}] 最新即時狀態\n"
            f"Time: {ts}\n"
            f"Machine: {doc.get('machine') or doc.get('tool_id') or '—'}\n"
            f"Lot: {doc.get('lot') or '—'}\n"
            f"Defect: {doc.get('defect_type') or '—'}\n"
            f"Confirmed: {_safe_int(doc.get('confirmed'),0)}\n"
            f"Pending: {_safe_int(doc.get('pending'),0)}\n"
            f"THK: {doc.get('thk') or '—'}"
        )

    # Top3 defects in last 30 days (simple aggregation)
    if ("本月" in t and "defect" in t.lower()) or ("本月" in t and "缺陷" in t):
        since = _utc_now() - timedelta(days=30)
        pipeline = [
            {"$match": {"layer": layer, "timestamp": {"$gte": since}}},
            {"$group": {"_id": "$defect_type", "cnt": {"$sum": {"$add": ["$confirmed", "$pending"]}}}},
            {"$sort": {"cnt": -1}},
            {"$limit": 3},
        ]
        rows = list(scrap_col.aggregate(pipeline))
        if not rows:
            return f"[{layer}] 本月尚無 defect 統計資料"
        msg = [f"[{layer}] 本月 Top3 Defect Type"]
        for i, r in enumerate(rows, 1):
            msg.append(f"{i}. {r.get('_id') or 'UNKNOWN'} : {_safe_int(r.get('cnt'),0)} 片")
        return "\n".join(msg)

    # default: show help
    return (
        "可詢問：\n"
        "1) 最新即時狀態（輸入：最新 / 即時）\n"
        "2) 本月 Top3 Defect（輸入：本月 defect）\n"
        "（也可直接用自然語言，hybrid 模式會先走 AI / FastAPI）"
    )


def handle_query(user_text: str) -> str:
    layer = _detect_layer(user_text)

    # Mode selection
    if LINEBOT_MODE in ("api", "fastapi"):
        ans = call_fastapi_chatbot(user_text, layer)
        return ans or "[API] 無法取得回覆（請確認 FastAPI 正在運行 /chatbot）"

    if LINEBOT_MODE in ("direct", "mongo"):
        return direct_reply(user_text, layer)

    # hybrid: try API first, fallback to direct
    ans = call_fastapi_chatbot(user_text, layer)
    if ans:
        return ans
    return direct_reply(user_text, layer)


# ===== Webhook =====
@app.route("/callback", methods=["POST"])
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    raw_body = request.get_data()

    if not verify_signature(raw_body, signature):
        abort(400, "Invalid signature")

    data = request.get_json(silent=True) or {}
    events = data.get("events", [])

    if not events:
        return "OK", 200

    for ev in events:
        if ev.get("type") != "message":
            continue
        msg = ev.get("message") or {}
        if msg.get("type") != "text":
            continue
        user_text = msg.get("text") or ""
        reply = handle_query(user_text)
        reply_text(ev.get("replyToken"), reply)

    return "OK"


if __name__ == "__main__":
    print(f"[LINEBOT] mode={LINEBOT_MODE} fastapi={FASTAPI_BASE_URL} mongo={MONGO_DB}.{MONGO_COLL}")
    print(f"[LINEBOT] webhook on 0.0.0.0:{FLASK_PORT}")
    app.run(host="0.0.0.0", port=FLASK_PORT)
