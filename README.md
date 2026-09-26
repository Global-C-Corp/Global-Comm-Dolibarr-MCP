# Global Comm Dolibarr MCP

Global Communication Corporate's adaptation of [`digitalfactorysn/mcp-dolibarr`](https://github.com/digitalfactorysn/mcp-dolibarr). See [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE) for attribution.

**Phase 2 security foundation; staging development only.** The 20 inspected read tools are governed by explicit scope policies. The upstream write handlers remain in source for review, but no mutation tool is registered or callable. Production Dolibarr is rejected by configuration. No real identity provider or Dolibarr 24 staging installation has been connected or verified.

## Local verification

Requires Node.js 22.13 or newer. Tests use dummy values, an in-memory MCP transport, local HTTP, and mocked Dolibarr calls; they do not contact an ERP.

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

## Configuration

See [.env.example](.env.example) and the [Phase 2 security foundation](docs/PHASE2_SECURITY_FOUNDATION.md). Explicitly set `MCP_ENV=development` or `staging`, an HTTPS staging `DOLIBARR_URL`, a restricted user key via a secret mechanism, and an absolute private `MCP_AUDIT_FILE`. The stdio process additionally needs `MCP_STDIO_SUBJECT` and `MCP_STDIO_SCOPES`; this local identity is asserted by the process owner.

HTTP additionally requires an HTTPS public `/mcp` URL, authorization issuer, JWKS URL and exact audience. Only signed RS256/ES256 JWT access tokens with `sub`, `client_id`, `scope` or `scp`, and `exp` are accepted. The listener binds to `127.0.0.1`; external TLS, an identity provider, a durable audit backend and client interoperability are still pending. CORS has no wildcard and is disabled for browser origins unless explicitly configured.

Scopes are `dolibarr:thirdparties:read`, `dolibarr:contacts:read`, `dolibarr:projects:read`, `dolibarr:commercial:read` and `dolibarr:finance:read`. Only tools matching the caller's scopes appear in `tools/list`, and the same policy is checked on every direct `tools/call`.

## Documentation

- [Phase 2 controls and open gates](docs/PHASE2_SECURITY_FOUNDATION.md)
- [Phase 1 baseline](docs/PHASE1_BASELINE.md)
- [Phase 0 gap analysis](docs/GAP_ANALYSIS.md), [upstream inventory](docs/UPSTREAM_TOOL_INVENTORY.md), [initial architecture](docs/ARCHITECTURE.md), [initial security assessment](docs/SECURITY.md) and [upgrade plan](docs/MCP_UPGRADE_PLAN.md)

**No production connection or deployment is approved by this branch.**
