# scrap_realtime_consumer.py (Ultra: stable write + env compatibility + UTC datetime + visible UPSERT logs)
import os
import json
from datetime import datetime, timezone
from typing import Any, Dict

from dotenv import load_dotenv
import pymongo
import paho.mqtt.client as mqtt


ROOT_ENV = os.path.join(os.path.dirname(__file__), ".", ".env")
load_dotenv(ROOT_ENV)

# ✅ Accept both naming styles: MONGODB_* (new) and MONGO_* (existing in your .env)
MONGO_URI = (os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "").strip()
DB_NAME = (os.getenv("MONGODB_DB") or os.getenv("MONGO_DB") or os.getenv("DB_NAME") or "mes_copilot").strip()
COLL_NAME = (os.getenv("MONGODB_COLL") or os.getenv("MONGO_COLL") or "realtime_scrap").strip()

# ✅ Accept both naming styles for MQTT: MQTT_HOST/MQTT_BROKER, MQTT_TOPIC
MQTT_HOST = (os.getenv("MQTT_HOST") or os.getenv("MQTT_BROKER") or "127.0.0.1").strip()
MQTT_PORT = int((os.getenv("MQTT_PORT") or "1883").strip())
MQTT_TOPIC = (os.getenv("MQTT_TOPIC") or "fab/scrap").strip()

mongo_client = None
coll = None

if MONGO_URI:
    mongo_client = pymongo.MongoClient(MONGO_URI)
    db = mongo_client[DB_NAME]
    coll = db[COLL_NAME]
    print(f"🗄️ MongoDB connected → Atlas::{DB_NAME}.{COLL_NAME}")

    try:
        # Minimal indexes (performance + sanity)
        coll.create_index([("layer", 1), ("timestamp", -1)], name="idx_layer_ts")
        coll.create_index([("lot", 1)], name="idx_lot")
        coll.create_index([("status", 1)], name="idx_status")
        coll.create_index([("defect_type", 1)], name="idx_defect_type")
    except Exception as e:
        print(f"⚠️ create_index failed: {e}")
else:
    print("⚠️ MONGO_URI/MONGODB_URI empty. Consumer will run but will NOT write to Mongo.")


def to_utc_dt(ts: Any) -> datetime:
    """Accept ISO str or datetime; return aware UTC datetime; fallback now()."""
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)

    if isinstance(ts, str):
        s = ts.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass

    return datetime.now(timezone.utc)


def normalize_doc(payload: Dict[str, Any]) -> Dict[str, Any]:
    layer = (payload.get("layer") or "UNKNOWN").strip()
    machine = (payload.get("machine") or "NA").strip()
    lot = (payload.get("lot") or "NA").strip()
    defect_type = (payload.get("defect_type") or "Unknown").strip()

    confirmed = int(payload.get("confirmed", 0) or 0)
    pending = int(payload.get("pending", 0) or 0)

    # ✅ SSOT: status always lowercase
    status = payload.get("status", None)
    if status is None:
        status = "confirmed" if confirmed > 0 else ("pending" if pending > 0 else "unknown")
    status_norm = str(status).strip().lower()

    thk = payload.get("thk", None)
    try:
        thk = float(thk) if thk is not None else None
    except Exception:
        thk = None

    ts = to_utc_dt(payload.get("timestamp"))

    return {
        "layer": layer,
        "machine": machine,
        "lot": lot,
        "defect_type": defect_type,
        "confirmed": max(confirmed, 0),
        "pending": max(pending, 0),
        "status": status_norm,
        "thk": thk,
        "timestamp": ts,        # ✅ store as datetime (UTC aware)
        "src": "mqtt_realtime",
    }


def on_connect(client, userdata, flags, rc):
    print(f"🔌 MQTT Connected rc={rc}")
    client.subscribe(MQTT_TOPIC)
    print(f"📡 Subscribed → {MQTT_TOPIC}")


def on_message(client, userdata, msg):
    raw = msg.payload.decode("utf-8", errors="ignore")
    print(f"📥 MQTT msg @ {msg.topic}: {raw}")

    try:
        payload = json.loads(raw)
    except Exception as e:
        print(f"⚠️ JSON parse error: {e}")
        return

    doc = normalize_doc(payload)

    if coll is None:
        print("⚠️ Mongo coll not ready, skip write.")
        return

    # ✅ UPSERT (prevents duplicates when publisher restarts)
    key = {"lot": doc["lot"], "layer": doc["layer"], "timestamp": doc["timestamp"]}
    try:
        r = coll.update_one(key, {"$set": doc}, upsert=True)
        if r.upserted_id is not None:
            print(
                f"✅ UPSERTED _id={r.upserted_id} layer={doc['layer']} lot={doc['lot']} "
                f"ts={doc['timestamp'].isoformat()} status={doc['status']}"
            )
        else:
            print(
                f"✅ UPDATED matched={r.matched_count} modified={r.modified_count} layer={doc['layer']} lot={doc['lot']} "
                f"ts={doc['timestamp'].isoformat()} status={doc['status']}"
            )
    except Exception as e:
        print(f"❌ Mongo write error: {e}")


if __name__ == "__main__":
    print("🚀 scrap_realtime_consumer.py – Ultra stable start")
    print(f"ENV: {ROOT_ENV} (exists={os.path.exists(ROOT_ENV)})")
    print(f"Mongo: db={DB_NAME} coll={COLL_NAME} uri_present={bool(MONGO_URI)}")
    print(f"MQTT: host={MQTT_HOST} port={MQTT_PORT} topic={MQTT_TOPIC}")

    client = mqtt.Client()  # DeprecationWarning 不影響功能
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, 60)
    client.loop_forever()
