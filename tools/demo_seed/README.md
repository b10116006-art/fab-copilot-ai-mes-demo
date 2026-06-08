# Overview Demo Seed

## Purpose
Synthetic demo data for local Overview dashboard screenshots. No real fab, customer, person, lot, token, or secret data.

## Files
- overview_demo_fixture.json: synthetic transport fixture.
- seed_overview_demo.py: loader that converts relative dates/times into Mongo-ready documents.
- README.md: usage notes.

## Safety
- Requires --confirm-synthetic.
- Default run is insert-only.
- --replace-demo-run removes only records with demo_run_id="overview-demo-v1" and synthetic=true.
- Does not modify dashboard UI, API routes, backend code, Mongo collection names, db_init.py, or root README.md.

## Commands
Dry run:
py -3.11 tools/demo_seed/seed_overview_demo.py --dry-run --confirm-synthetic

Seed:
py -3.11 tools/demo_seed/seed_overview_demo.py --confirm-synthetic

Replace demo run:
py -3.11 tools/demo_seed/seed_overview_demo.py --confirm-synthetic --replace-demo-run

## Environment
Uses the same Mongo conventions as modules/mes_api.py:
- MONGO_URI
- DB_NAME or MONGO_DB
- COL_MES_TOTALS
- COL_REALTIME_SCRAP

## Demo story
- Layer: ILD
- Top machine: CMP-03
- Top defect: Particle
- Risk level: HIGH
