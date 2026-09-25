# Initial security assessment — Global Comm Dolibarr MCP

**Phase 0 only; assessed upstream commit:** `360cb7c66e470a1c844f22320573c2ced2f01c4d`. This document describes source-level evidence and safe requirements; it does **not** certify the target ERP, network, or deployed server.

## Trust model and identified attack surface

| Boundary | Upstream evidence | Initial control required |
|---|---|---|
| Internet → remote MCP | `src/http.ts:48-57` allows requests without a token when `MCP_API_TOKEN` is unset; `:33-46` uses wildcard CORS. | Mandatory authenticated remote access; identity, allowed origins/hosts, HTTPS, request rate/size/time bounds. |
| MCP caller → tool | `src/server.ts:39-56,94-114` advertises and routes all 186 declarations, with no tool policy, identity scopes or approval gate. | Fail-closed registry, one unique name per tool, authorization checks on every invocation and per-object scope. |
| Tool → Dolibarr | `src/api.ts:7-24` sends one server-held `DOLAPIKEY`; handlers often spread arbitrary args into payloads. | Dedicated `gc_ai` rights, fixed ERP origin, typed requests, endpoint allowlist, status preconditions and audit. |
| ERP output → model | `src/server.ts:111` returns handler strings; GET tools can expose full records, configuration, documents and payroll. | Minimized DTOs, result limits, sensitive-field removal and data-access audit. |
| Error/log → caller/operator | `src/api.ts:26-46` interpolates upstream messages; `src/server.ts:112-114` returns them; `/health` includes URL. | Sanitized typed errors, redacted logs and minimal health response. |

## Verified high-risk examples

1. **Administrative write without server approval:** in a fully local in-memory MCP test, `set_setup_value` invoked mocked `POST /setup/conf` and returned `isError=false`; no actual Dolibarr request was made. Source: `src/tools/setup.ts:133-137`, `src/server.ts:107-114`. This verifies dispatch behavior, not rights on the target ERP.
2. **Payment/bank/ledger operations available to the router:** `add_payment_to_invoice`, `pay_supplier_invoice`, `add_bank_transaction`, `reconcile_bank_line`, `create_misc_journal_entry`; source paths in `UPSTREAM_TOOL_INVENTORY.md`. Whether each exact endpoint succeeds in Dolibarr 24.x is UNVERIFIED.
3. **Deletion and configuration:** `delete_document`, `delete_invoice_line`, `set_setup_value` and `update_company_info` are defined and routed. “Draft only” in a description is not an enforced status check.
4. **Method-based classification fails:** `generate_document_pdf` calls `GET /documents/builddoc` (`src/tools/documents.ts:28-31`), which may generate output. Investigate effects before allowing it as read-only.
5. **Data integrity:** several creation handlers default an author ID to `1`, and `src/tools/accounting_config.ts:58-60` asserts an upstream-specific configuration without checking it. Block both behaviors before Global Comm use.

## Proposed enforcement rules

- **No deployment with optional HTTP auth.** Fail startup in production if caller authentication/authorization config is missing. Validate token/signature/issuer/audience as appropriate to the supported client flow; keep a caller identity and permissions, rather than a single shared undifferentiated secret.
- **Level 0 reads** require authorization; sensitive financial/document/HR reads are audited and minimized. **Level 1 drafts** additionally require verified draft-only preconditions, validation, idempotency and audit. **Level 2 commitments** require a separate human actor's exact-action approval. **Level 3** is not registered/enabled in the initial production tool list.
- A confirmation stores an action digest and expiry; it is single-use and bound to the initiating actor, exact target record state, content and idempotency key. A model's restatement of intent is not an approval credential. In the initial release, defer Level 2 entirely if there is no secure approval channel.
- Bind the outgoing client to a validated HTTPS origin (`administration.globalcomm.ma`, including verified base path), disallow arbitrary outgoing URLs and cross-origin redirects, cap timeouts and responses. Keep `DOLAPIKEY` server-side, out of logs, responses, MCP schemas and Git.
- Parse IDs as bounded positive integers, money with decimal-safe types, dates as valid dates, allowed enum values and contact fields with strict sizes. Reject extra fields and raw `sqlfilters` passed from an LLM/client. Whitelist `modulepart` and document identifiers, associate documents with an authorized business object.
- Audit actor, request ID, tool, policy decision, object, source version, redacted action fingerprint and outcome. Store durable idempotency/reconciliation records before any write; never retry an uncertain payment/validation automatically.
- Return specific, sanitized errors for unauthorized, denied, invalid, missing, conflict, timeout and upstream failures. Do not convert any upstream error into fabricated accounting records or a misleading “success.”

## Safe verification gates

| Gate | Test without production writes |
|---|---|
| Reproducibility | `npm ci`, typecheck/build, lint, tests and unique tool-name assertion in CI. Current `npm ci` fails. |
| Default denial | Missing/invalid auth rejected; Level 3 absent and denied even by direct `tools/call`; undefined tool denied. |
| Approval | Level 2 denied without human action; wrong actor, modified payload, expired/replayed decision denied. |
| Input | Oversize body/result, `sqlfilters`, path traversal and unexpected fields denied; sensitive data redacted. |
| REST contract | Mock exact method/path/payload/error mapping; staging only for writes. Never infer endpoint correctness from build success. |
| Audit/idempotency | Duplicate draft request creates one result; timeouts yield “outcome unknown” with reconciliation, not another write. |
| Client compatibility | Test authenticated ChatGPT remote and Claude stdio/remote with a staging read-only user. |

## Handling unknowns

The Global Comm Dolibarr modules, permissions, API explorer, reverse proxy, existing user roles and staging environment were not inspected. `docs/DOLIBARR_PERMISSIONS.md` and `docs/DOLIBARR_API_MATRIX.md` must mark unverified entries explicitly when created. No production secrets are needed for the current phase. Do not use SupAdmin or execute exploratory writes on production.
