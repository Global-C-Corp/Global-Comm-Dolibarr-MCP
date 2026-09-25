# Global Comm Dolibarr MCP

This repository is Global Communication Corporate's maintained adaptation of [`digitalfactorysn/mcp-dolibarr`](https://github.com/digitalfactorysn/mcp-dolibarr). See [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE) for source attribution.

**Current status: Phase 1 read-only baseline, not approved for production connection.** Only 20 inspected read tools are registered; all upstream write handlers remain in the source but are rejected by the MCP dispatcher. Unvalidated `sqlfilters` and `sortfield` are also excluded from the MCP interface. HTTP requires `MCP_API_TOKEN`; this static token is a temporary baseline gate, not per-user authorization or the final ChatGPT connection design. Do not supply a production Dolibarr API key or deploy this branch against `administration.globalcomm.ma`.

## Local verification (no ERP connection)

Requires Node.js 22.13 or newer (Node.js 24 is used by the container).

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

Tests use dummy configuration and mock Dolibarr requests. `npm test` builds TypeScript first. The test process does not contact a Dolibarr instance.

## Architecture and scope

ChatGPT/Claude clients will speak MCP to this server; a restricted service account will later speak HTTPS REST to Dolibarr. No direct SQL or generic REST escape tool is included. The `src/server.ts` allowlist is a temporary Phase 1 constraint. Phase 2 will introduce caller identity, central policy metadata, permissions, exact-action approvals, idempotency and audit before any write tool is enabled.

The upstream source is intentionally retained for inspection; merely seeing a handler in `src/tools` does not mean it is available through MCP. Only names in the current `tools/list` response can be called, and the dispatcher also rejects anything outside the allowlist. Local stdio and HTTP transports share this registry.

## Documents

- [Phase 1 baseline](docs/PHASE1_BASELINE.md): changes, verified checks and open gates.
- [Phase 0 gap analysis](docs/GAP_ANALYSIS.md) and [upstream tool inventory](docs/UPSTREAM_TOOL_INVENTORY.md): snapshot of upstream at `360cb7c`.
- [Initial architecture](docs/ARCHITECTURE.md), [security assessment](docs/SECURITY.md) and [MCP upgrade plan](docs/MCP_UPGRADE_PLAN.md).

**Deployment is blocked** until the target Dolibarr 24.x API/permissions, staging environment, remote client authentication and Phase 2 safeguards have been verified. The upstream deployment workflow and scripts have been removed from this branch.
