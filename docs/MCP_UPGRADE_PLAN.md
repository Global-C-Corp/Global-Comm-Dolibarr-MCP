# MCP protocol and TypeScript SDK upgrade plan — Phase 0

**Baseline:** audited upstream `master` commit `360cb7c66e470a1c844f22320573c2ced2f01c4d`, 2026-09-25. No SDK migration has been performed.

## Verified comparison

| Item | Upstream | Current primary source | Decision |
|---|---|---|---|
| Protocol | `src/http.ts:6` claims compatibility with `2025-11-25`; code requires initialize and stores sessions. | [MCP specification releases](https://github.com/modelcontextprotocol/modelcontextprotocol/releases) mark `2026-07-28` stable. | Test compatibility rather than relying on comments. |
| SDK package | `package.json` declares `@modelcontextprotocol/sdk ^1.29.0`; lock has 1.29.0; temporary baseline install resolved 1.30.1. | [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) documents **v2** as the stable line for the 2026-07-28 spec and v1 bug/security updates for at least six months after v2 release. | Plan deliberate v1→v2 move after CI baseline and client tests. |
| Server API | `src/server.ts` uses `Server`, `ListToolsRequestSchema` and `CallToolRequestSchema`. | [Official v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md) uses split core/server/client packages. | Keep current transport while building tests, then change registry/API in a separate reviewed change. |
| Remote HTTP | `src/http.ts` makes `StreamableHTTPServerTransport` per session, with `Mcp-Session-Id`. | [Official v2 HTTP guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md) shows `createMcpHandler`, a per-request factory and auth context. | Design stateless/server identity behavior with tested legacy support where needed. |
| 2026 protocol adoption | Not implemented or asserted by tests. | [Official protocol transition guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md) treats v1→v2 package upgrade separately from 2026 protocol support. | Make these separate milestones, not one untested dependency bump. |

## Safe upgrade sequence

1. Fix lock consistency and get `npm ci`, typecheck, reproducible `tools/list` and mocked `tools/call` tests green on the current SDK. Record supported stdio and Streamable HTTP behavior with a client matrix.
2. Define policy registry independently of SDK-specific registration so risk, auth, preview and idempotency do not disappear during migration.
3. Migrate v1 SDK imports to the v2 split packages using the official migration guide in a separate branch; inspect codemod edits and breaking changes. Verify low-level handler behavior, input schemas and HTTP middleware semantics instead of assuming a mechanical rewrite is correct.
4. Test 2025 clients on the migrated server, then adopt the 2026-07-28 protocol flow with explicit version negotiation and the officially supported HTTP handler. Determine whether Claude and ChatGPT clients in the target environment support the selected legacy/modern modes before retiring either.
5. Validate authorization context end to end. The [OpenAI MCP authentication guide](https://developers.openai.com/plugins/build/auth) documents OAuth authorization code with PKCE and verification of issuer, audience, expiry and scopes for ChatGPT plugin connections; the upstream's optional shared `MCP_API_TOKEN` is not a verified integration design for this use case. Choose an authorization provider or an appropriately supported gateway before remote rollout.
6. Add protocol compatibility and security tests in CI: denied unauthenticated requests, caller identity propagation, no cross-caller sessions, tool metadata/uniqueness, approval replay rejection, malformed requests, bounded responses and secret redaction.

**Do not upgrade just to reach a newer version number.** The first blocking gate is the existing `npm ci` failure and absence of tests. ChatGPT/Claude production compatibility is still UNVERIFIED until exercised with staging credentials and current clients.
