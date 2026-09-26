# Phase 2 — Security foundation

This branch builds on `phase1/baseline`. It is a source-level and local-test milestone, **not** a production release. No Dolibarr 24.x staging instance, live OAuth provider, ChatGPT client or Claude client was contacted.

## Implemented

- Configuration fails closed: `MCP_ENV` must be explicitly `development` or `staging`; the known production hostname is blocked. ERP URL, audit path and transport-specific identity settings are required. URLs for ERP, MCP, issuer and JWKS require HTTPS.
- HTTP verifies JWT signatures against the configured JWKS, exact issuer and audience, supported signature algorithm, expiry, subject, client identity and scopes. The MCP protected resource metadata endpoint advertises the issuer. No shared static bearer token grants access.
- Every exposed tool has centralized risk metadata and an explicit read scope. `tools/list` filters by caller; `tools/call` enforces the same decision. Unknown tools and every mutation, commitment or Level 3 action remain denied regardless of JWT claims. There is no live approval channel; client supplied confirmations never authorize a write.
- Every attempted tool call writes a private JSONL audit record with request ID, subject, client, tool, risk, outcome and duration. The file is opened without following a symbolic link. Raw arguments, ERP data, headers, tokens and API keys are omitted. Audit failure prevents a call from proceeding.
- HTTP enforces exact allowed origins and hosts, a 64 KiB JSON body limit, 100 active sessions, session ownership, idle cleanup and a localhost listener. The outgoing Dolibarr client rejects redirects and caps responses. Errors returned to MCP clients do not expose upstream response bodies or configured URLs.
- The stdio transport obtains its asserted local identity and scopes from the process environment; it does not pretend to identify separate humans on a shared computer.

## Verified locally

`npm ci`, `npm run typecheck`, `npm run lint` and `npm test` pass with local fixtures. Tests cover direct write denial, scoped tool discovery, bad input, configuration refusal, JWT issuer/audience/signature/claim checks, audit permissions and redaction, HTTP unauthorized access, origin and body limits, and session ownership. No production request or live ERP request was made.

## Still required before a usable remote integration

- A trusted identity provider with an HTTPS JWKS endpoint issuing **access tokens** whose issuer, audience, `sub`, `client_id`, `exp` and `scope`/`scp` match this verifier. Opaque tokens, a different claim layout or additional provider constraints need an explicit integration and tests. The authorization server must publish its own discovery metadata and support the intended MCP clients. The current pinned SDK remains on its earlier protocol track; verify client compatibility before deployment.
- A separate Dolibarr 24.x staging environment, modules/API explorer, a restricted service account, safe fixtures and a permission matrix. The API handlers retained from upstream have not been verified against that instance.
- A persistent, access-controlled audit destination and operational retention policy. This local file sink is adequate for development, but is not a production audit architecture.
- Per-object authorization and minimized read DTOs in Phase 3. Current upstream GET handlers can return full objects, so sensitive scopes must not be granted to unreviewed users.
- For future writes: durable idempotency, a trusted human approval store that binds actor/action/version/expiry, preconditions and staging tests. The `ConfirmationStore` type is an interface only; it is not an approval implementation. All write risks remain disabled.
- For Phase 7 remote access: a trusted HTTPS reverse proxy, client compatibility tests, session/rate limits at the edge and a deployment review. The current HTTP process listens only on loopback.

**Blocker for production:** no user/role mapping, staging verification, live OAuth integration, durable audit or approval channel exists yet. Do not place production ERP credentials in this configuration or enable write handlers.
