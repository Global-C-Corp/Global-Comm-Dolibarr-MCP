# Phase 1 — Fork and baseline

This document records the published [Phase 1 branch](https://github.com/Global-C-Corp/Global-Comm-Dolibarr-MCP/tree/phase1/baseline) derived from upstream commit `360cb7c66e470a1c844f22320573c2ced2f01c4d`. The published source tree at `a4bd93b` exactly matches the locally verified source tree at `cb605cf`. The hosted repository is a new repository whose initial commit is its Git parent; the upstream commit is documented as the source rather than present as a Git ancestor. The separate local Git bundle retains the shallow upstream snapshot and development commit. The older Phase 0 documents in this directory describe the audited upstream snapshot, not the present tool registry.

## Delivered changes

- Preserve Digital Factory Senegal attribution and record the upstream revision in `UPSTREAM.md`. Include an MIT license file.
- Use `package.json` version `0.1.0` as the source of truth for MCP server metadata and HTTP health. Rename the application `global-comm-dolibarr-mcp` and keep the package private.
- Add a read-only Phase 1 registry of 20 inspected GET-backed tools. The dispatcher rejects unlisted tool calls even if a client sends them directly. It rejects unadvertised arguments, `sqlfilters`, `sortfield`, and malformed primitive input types before API access. The source of upstream write handlers is retained for later review; it cannot be reached through this MCP dispatcher.
- Require an HTTP bearer token before listening. Remove the configured Dolibarr URL from the unauthenticated health response. This temporary static token is **not** per-user authentication or authorization.
- Replace the upstream automatic VPS deployment workflow with read-only CI on Node.js 22 and 24. Remove the old deployment scripts, Compose, proxy, systemd, and migration instructions pointing to the upstream server. Align the Docker build with `npm ci` and port 3000; do not deploy it.
- Add ESLint and isolated MCP tests using a placeholder URL, an in-memory transport, and mocked adapter calls.

## Verification

On 2026-09-25, locally executed `npm ci`, `npm run typecheck`, `npm run lint`, and `npm test`: **PASS** (five tests). Tests verify the advertised registry and version, deny a direct write call before the Dolibarr adapter, deny raw filters and a path-like ID before reads, preserve one expected GET call, and reject HTTP startup without a token. No real Dolibarr request was made. Check the [GitHub Actions matrix](https://github.com/Global-C-Corp/Global-Comm-Dolibarr-MCP/actions/workflows/ci.yml) for its separate status.

Secret scan: tracked files contain placeholder values and variable names, no known production credentials. No direct database calls or generic REST request tool were found in the exposed baseline. This is a source review and local test result, not a production security certification.

## Open gates

- **GitHub branch published:** `origin` points to `Global-C-Corp/Global-Comm-Dolibarr-MCP` in the local workspace and `upstream` points to `digitalfactorysn/mcp-dolibarr`. A fresh clone needs to add its own `upstream` remote. Confirm the GitHub CI matrix before merging.
- **BLOCKED — target API:** no safe Dolibarr 24.x staging endpoint or permission matrix has been provided. The endpoint behavior and service account scopes remain unverified.
- **BLOCKED — production:** Phase 2 caller identity, centralized authorization, approvals, audit, and stronger HTTP defaults are not implemented. No production connection, key, or deployment is authorized by this baseline.

Next authorized implementation stage, once requested: Phase 2 security foundation. Consult `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and the upgrade plan for the design proposals; validate them against the actual target and current MCP specification before treating them as implementation facts.
