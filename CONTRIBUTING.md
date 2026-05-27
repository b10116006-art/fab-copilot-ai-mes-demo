# Contributing to FAB Copilot

Thanks for your interest. This is a portfolio / demo project that welcomes small, focused contributions — bug fixes, documentation clarifications, and tightly-scoped improvements.

## Before you open a PR

- **No secrets, ever.** Do not commit API keys, tokens, connection strings, or `.env` files. All configuration in this repo is read from environment variables; please keep it that way.
- **Keep changes minimal-diff.** Prefer additive changes that do not rename routes, endpoints, payload keys, Mongo collection names, file names, or component names — these are part of the project's stability contract.
- **The build must stay green.** The frontend production build (`npm ci && npm run build` inside `frontend/`) must continue to succeed.
- **Match the existing engineering discipline.** This repo separates *included code* from *verified behavior*, and *implemented* from *deferred* — please preserve that line in any doc or code changes.

## Build & run

**Frontend (verified):**

```bash
cd frontend
npm ci
npm run build      # production build → dist/
npm run dev        # local dev server on http://localhost:5173
```

Configure the backend URL in `frontend/.env` (defaults to `http://127.0.0.1:5000`):

```
VITE_API_BASE_URL=http://127.0.0.1:5000
```

**Backend (requires your own MongoDB + MQTT; not verified end-to-end in this snapshot):**

- `pip install -r requirements.txt`
- Provide MongoDB, MQTT, and (optionally) LLM-provider values via environment variables. **No secrets are committed.**
- Serve `modules/mes_api.py` with an ASGI server such as uvicorn on port 5000.
- A container path is also provided via `docker-compose.yml` / `Dockerfile`. The compose file uses placeholder defaults (for example `MONGO_ROOT_PASSWORD=changeme`); **override these for any real deployment**.

## Deferred features

Login / auth, API authorization, messaging alerts, email alert routing, and OAuth login are intentionally **disabled** in this public v0 snapshot. See the root `README.md` → *Deferred, not abandoned*. Please discuss the scope first before opening PRs that re-enable any of them.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Please do **not** file security issues as public GitHub issues.

## License

By contributing, you agree your contribution will be released under the MIT License (see [`LICENSE`](LICENSE)).
