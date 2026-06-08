#!/usr/bin/env python3
"""Seed synthetic Overview demo data into MongoDB.

Reads overview_demo_fixture.json (transport format) and inserts records into the
existing collections the Overview dashboard reads: `mes_totals` and
`realtime_scrap`. Transport fields are translated into the real fields the
/overview/* endpoints expect:

    mes_totals[].date_offset_days  ->  date   (YYYY-MM-DD string)
    realtime_scrap[].minutes_ago   ->  timestamp (real UTC datetime)

This script ONLY writes synthetic demo data. Every inserted document carries
demo marker fields (demo_run_id, synthetic) so a demo run can be cleanly
re-applied without touching any other data.

Connection conventions match modules/mes_api.py:
    MONGO_URI : env MONGO_URI            (default "mongodb://localhost:27017/")
    DB_NAME   : env DB_NAME or MONGO_DB  (default "mes_copilot")
    collections: env COL_MES_TOTALS / COL_REALTIME_SCRAP (defaults below)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pymongo import MongoClient

# --- markers identifying records inserted by this seeder ---
DEMO_RUN_ID = "overview-demo-v1"
DEMO_MARKERS = {"demo_run_id": DEMO_RUN_ID, "synthetic": True}

# --- connection conventions (mirror modules/mes_api.py) ---
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME") or os.getenv("MONGO_DB") or "mes_copilot"
COL_MES_TOTALS = os.getenv("COL_MES_TOTALS", "mes_totals")
COL_REALTIME_SCRAP = os.getenv("COL_REALTIME_SCRAP", "realtime_scrap")

FIXTURE_PATH = Path(__file__).resolve().parent / "overview_demo_fixture.json"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def load_fixture(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    meta = data.get("_meta", {})
    if meta.get("data_kind") != "synthetic-demo":
        raise SystemExit(
            f"refusing to seed: {path} is not marked data_kind='synthetic-demo'"
        )
    if not isinstance(data.get("mes_totals"), list) or not isinstance(
        data.get("realtime_scrap"), list
    ):
        raise SystemExit("refusing to seed: fixture missing mes_totals/realtime_scrap lists")
    return data


def build_mes_totals(rows: list, ref: datetime) -> list:
    out = []
    for r in rows:
        offset = int(r["date_offset_days"])
        date_str = (ref.date() + timedelta(days=offset)).isoformat()
        out.append(
            {
                "date": date_str,
                "layer": r["layer"],
                "wafer_total": int(r["wafer_total"]),
                "scrap_total": int(r["scrap_total"]),
                **DEMO_MARKERS,
            }
        )
    return out


def build_realtime_scrap(rows: list, ref: datetime) -> list:
    out = []
    for r in rows:
        ts = ref - timedelta(minutes=int(r["minutes_ago"]))
        out.append(
            {
                "timestamp": ts,
                "layer": r["layer"],
                "machine": r["machine"],
                "lot": r["lot"],
                "defect_type": r["defect_type"],
                "thk": float(r["thk"]),
                "confirmed": int(r["confirmed"]),
                "pending": int(r["pending"]),
                "events": int(r["events"]),
                **DEMO_MARKERS,
            }
        )
    return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Seed synthetic Overview demo data into MongoDB (synthetic-only)."
    )
    p.add_argument(
        "--confirm-synthetic",
        action="store_true",
        help="REQUIRED. Acknowledge this inserts synthetic demo data into MongoDB.",
    )
    p.add_argument(
        "--replace-demo-run",
        action="store_true",
        help=f"Delete prior records matching demo markers ({DEMO_MARKERS}) before insert. "
        "Only demo-marked records are removed; no other data is touched.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and report documents but do not connect or write to MongoDB.",
    )
    p.add_argument("--fixture", default=str(FIXTURE_PATH), help="Path to fixture JSON.")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.confirm_synthetic:
        print(
            "refusing to run without --confirm-synthetic\n"
            "this seeder inserts SYNTHETIC demo data into MongoDB; pass --confirm-synthetic to proceed.",
            file=sys.stderr,
        )
        return 2

    fixture = load_fixture(Path(args.fixture))
    ref = now_utc()
    totals_docs = build_mes_totals(fixture["mes_totals"], ref)
    scrap_docs = build_realtime_scrap(fixture["realtime_scrap"], ref)

    print(f"fixture          : {args.fixture}")
    print(f"reference time   : {ref.isoformat()}")
    print(f"mes_totals docs  : {len(totals_docs)} -> collection '{COL_MES_TOTALS}'")
    print(f"realtime docs    : {len(scrap_docs)} -> collection '{COL_REALTIME_SCRAP}'")
    print(f"demo markers     : {DEMO_MARKERS}")

    if args.dry_run:
        print("dry-run: no connection, no writes performed.")
        return 0

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4000)
    db = client[DB_NAME]
    print(f"mongo            : {MONGO_URI} db='{DB_NAME}'")

    if args.replace_demo_run:
        d1 = db[COL_MES_TOTALS].delete_many(DEMO_MARKERS).deleted_count
        d2 = db[COL_REALTIME_SCRAP].delete_many(DEMO_MARKERS).deleted_count
        print(f"replace-demo-run : removed {d1} mes_totals + {d2} realtime_scrap demo records")

    r1 = db[COL_MES_TOTALS].insert_many(totals_docs)
    r2 = db[COL_REALTIME_SCRAP].insert_many(scrap_docs)
    print(f"inserted         : {len(r1.inserted_ids)} mes_totals + {len(r2.inserted_ids)} realtime_scrap")
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
