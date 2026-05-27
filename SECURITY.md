# Security Policy

## Supported versions

This repository is the public **v0 candidate** of FAB Copilot — a buildable no-auth dashboard demo. There is no formal release line; the `main` branch is the only supported reference.

## Reporting a vulnerability

If you believe you have found a security issue in the code in this repository, please report it **privately** so it can be addressed before any public disclosure.

**Preferred channel:** open a private security advisory via the repository's **Security → Advisories → New draft security advisory** tab on GitHub.

**Alternative channel:** contact the repository owner through the address listed on the maintainer's GitHub profile.

Please include:
- A clear description of the issue and the affected file or route.
- Steps to reproduce.
- The commit hash you tested against.
- Any suggested mitigation, if you have one.

## Scope

**In scope:**
- Source code in this repository (Python backend, React frontend, configuration files).
- Documented build, run, and configuration paths.

**Out of scope:**
- Third-party services referenced via environment variables (MongoDB, MQTT broker, LLM providers, messaging platforms).
- Any private deployment of this code. Deployments must add their own authentication, network controls, and secret management.
- Reports based solely on missing features that are documented as deferred — see the root `README.md` → *Deferred, not abandoned*.

## Response

This is a portfolio / demo project maintained on a best-effort basis. There is **no SLA and no bug bounty**. A reasonable acknowledgement target is **7 calendar days** from a complete private report.
