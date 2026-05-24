# FAB Copilot — Frontend (no-auth v0)

React + Vite dashboard for the FAB Copilot public snapshot. This is the **no-auth, dashboard-only** frontend: Overview (KPI + charts), Machines (state matrix + utilization), Machine Detail, AI Decision, and Copilot views.

## Build

```bash
npm ci
npm run build
```

The production build is green and emits to `dist/`. For local development, use `npm run dev`.

## Configuration

The frontend reads its backend base URL from an environment variable (set in `frontend/.env`):

```
VITE_API_BASE_URL=http://127.0.0.1:5000
```

If unset, it falls back to `http://127.0.0.1:5000`.

## Notes

- This v0 frontend has **no login / auth flow** by design.
- Deferred integrations (login/auth, messaging alerts, email alert routing, OAuth login, API authorization) are disabled in this v0 — see the root `README.md` → *Deferred, not abandoned*.
