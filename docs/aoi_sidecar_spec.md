# AOI Sidecar Contract Spec

> **Status:** Draft / Planned integration spec. **Not implemented yet** — no active runtime endpoint exists in this repository.

---

## 1. Purpose

- Define how AOI (Automated Optical Inspection) defect evidence will be passed into the MES decision layer.
- Establish a clear boundary between **AOI vision inference** and **MES action decision** so each side can evolve independently.

---

## 2. Endpoint (planned)

- **Method / path:** `POST /aoi/decision`
- This endpoint is a **proposed sidecar contract**. It is **not yet active** in the MES production runtime and has no implementation in this repository.

---

## 3. Request schema (proposed)

| Field | Type | Description |
|---|---|---|
| `image_id` | string | AOI capture identifier |
| `lot_id` | string | Manufacturing lot identifier |
| `wafer_id` | string | Wafer identifier within the lot |
| `machine_id` (or `tool_id`) | string | Source tool / inspection station |
| `layer` | string | Process layer (e.g., `ILD`, `PSG`, `STI`) |
| `timestamp` | ISO-8601 string | AOI capture / inference time |
| `defect_class` | string | Predicted defect category |
| `confidence` | float (0..1) | Model confidence |
| `bbox` | object `{x, y, w, h}` | Defect bounding box, in image pixels |
| `ng_flag` | bool | AOI's no-good binary decision |
| `evidence_uri` | string (optional) | Pointer to image / cropped patch artifact |

---

## 4. Response schema (proposed)

| Field | Type | Description |
|---|---|---|
| `decision_id` | string | Unique decision identifier (server-issued) |
| `risk_level` | enum: `low` / `medium` / `high` | MES risk grading |
| `recommended_action` | enum: `monitor` / `hold` / `rework` / `scrap` | Suggested next step |
| `explanation` | string | Human-readable rationale |
| `linked_mes_action_payload` | object | Pre-shaped payload for downstream MES action surfaces |
| `trace_id` | string | Cross-system correlation id |

---

## 5. Integration with existing MES

- The sidecar's response is intended as **input** to the MES decision layer, surfaced through endpoints such as `/overview/ai/action`.
- AOI evidence is meant to **enrich decision context** (defect class + confidence + bbox + image pointer). It must **not** directly trigger destructive or irreversible actions.
- Final action authority remains with the MES decision layer (and any required human-in-the-loop gating). The sidecar is advisory, not authoritative.

---

## 6. Sync vs async trade-off

- **Sync (initial / demo):** simpler infrastructure, single round-trip, easy to wire into the existing FastAPI surface. Acceptable for small-scale demos and the current portfolio-grade scope.
- **Async (target / production):** queue or event-driven pattern (MQTT / Kafka / Redis stream). Decouples AOI cadence from MES decision latency, scales to higher throughput, and supports replay / backfill.
- **Recommendation:** start sync to validate the schema; evolve to async behind the same contract when integration grows.

---

## 7. Safety / overclaim guard

- This document specifies a **contract**, not an implementation. No production AOI deployment is claimed.
- No company-specific or private fab credentials are referenced; all identifiers in the schema are placeholders.
- Process-layer mentions (`ILD`, `PSG`, `STI`) refer to generic semiconductor-process examples used by this demo project, not any specific foundry's data.

---

## 8. Future work

- **Phase B++** (or later): integrate AOI evidence with RAG grounding so decision rationales can cite prior similar cases and runbooks.
- Persist AOI evidence (`image_id` ↔ `decision_id` ↔ `trace_id`) for audit, replay, and retrieval.
- End-to-end demo notebook: AOI inference → sidecar `POST /aoi/decision` → MES decision surface → audit trail.
