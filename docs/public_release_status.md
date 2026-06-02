# Public Release Status

Current state of the FAB Copilot public snapshot repository.

## Public release baseline

- **Public URL:** https://github.com/b10116006-art/fab-copilot-ai-mes-demo
- **`main` commit at public flip:** `70aba95`
- **Release type:** public-v0 clean snapshot

## Verification status (at public flip)

| Check | Result |
|---|---|
| External anonymous access | ✅ pass |
| Build Verification on `main` | ✅ success |
| `main` branch protected | ✅ true |
| Required status check context | `verify` |
| Force pushes on `main` | ❌ disabled |
| Branch deletion on `main` | ❌ disabled |
| Open PR list at release check | empty |

The latest Build Verification status is available under the repository's [Actions](https://github.com/b10116006-art/fab-copilot-ai-mes-demo/actions) tab.

## Public v0 scope

What this public snapshot is:

- **FastAPI + MongoDB manufacturing decision-support backend** — MES KPI aggregation, machine-state / utilization queries, AI summary and AI action endpoints. Included as system design; backend runs against your own MongoDB-backed demo data environment.
- **React + Vite public dashboard** — Overview (KPI + charts), Machines (state matrix + utilization), Machine Detail, AI Decision, and Copilot views. The frontend production build is verified green from a clean checkout.
- **AOI sidecar contract** — documented draft at [`docs/aoi_sidecar_spec.md`](aoi_sidecar_spec.md) (proposed `POST /aoi/decision` request/response schemas). Contract only; no runtime endpoint included in this snapshot.
- **No-auth public-safe snapshot** — no login flow, no API authorization, no external messaging or email routing enabled at runtime.

## Deferred but not abandoned

The following capabilities are intentionally **disabled** in this public v0 snapshot, for security, branding, and scope control. They are **not abandoned** and will be reintroduced through dedicated, public-safe, env-only, feature-flagged future phases:

- **Auth / Login**
- **Bearer API authentication**
- **Messaging alerts, including future LINE integration**
- **Google / OAuth login**
- **RAG grounding for AI decision rationales**
- **AOI runtime integration**

Reintroduction principles when any of these are later enabled in public-safe phases:

- environment-only secrets (never committed)
- `.env.example` placeholders (no real tokens)
- no third-party trademark assets
- feature flags / preview mode — disabled by default

## Out of scope for public v0

This snapshot **does not** claim or include:

- **Production deployment.** No SLA, no hosted demo, no operational support — buildable demo only.
- **Real factory integration.** All data flows are designed against synthetic / demo MES events from a MongoDB-backed demo data environment.
- **Implemented AOI runtime endpoint.** Only the contract spec is present; the optional AOI router is not included and there is no image inference, model, or upstream image pipeline.
- **Secrets / private environment values.** All configuration is read from environment variables; nothing is hardcoded and nothing is committed.

## Next roadmap candidates

Open candidates for future small, public-safe PRs — current backlog of nice-to-haves, not committed plans:

- **README CI status badge** — 1-line README change to surface the `Build Verification` status on the landing page.
- **Screenshot / demo media** — one dashboard screenshot to give external readers a visual feel.
- **Public-safe `CHANGELOG.md`** — Keep-a-Changelog-style per-release history, freshly written from the public repo's own merged-PR history.
- **AOI sidecar sample payload / fixture** — a small JSON example accompanying the spec so the contract is more concrete.
- **Phase B++ RAG grounding** — reintroduce retrieval-grounded prompts for `/overview/ai/action` once it can be done env-only and feature-flagged off.
- **Structured Causal Graph / causal driver analysis** — extend the decision layer with causal driver inference for engineering investigations.

---

*Last updated at the public v0 release (`main` @ `70aba95`).*
