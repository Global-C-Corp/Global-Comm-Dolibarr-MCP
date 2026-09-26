import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { loadConfig } from '../build/security/config.js';
import { createJwtVerifier } from '../build/security/identity.js';
import { evaluatePolicy, isAllowed } from '../build/security/policy.js';
import { FileAuditSink } from '../build/security/audit.js';
import { createHttpApp } from '../build/http.js';
import { DolibarrAPI } from '../build/api.js';
import { createServer } from '../build/server.js';

const baseConfig = {
  MCP_ENV: 'development', DOLIBARR_URL: 'https://example.invalid/api/index.php',
  DOLIBARR_API_KEY: 'dummy-test-only', MCP_AUDIT_FILE: '/tmp/test-audit.log',
  MCP_PUBLIC_URL: 'https://mcp.example.invalid/mcp', MCP_OAUTH_ISSUER: 'https://issuer.example.invalid/',
  MCP_OAUTH_JWKS_URI: 'https://issuer.example.invalid/jwks', MCP_OAUTH_AUDIENCE: 'https://mcp.example.invalid/mcp',
  PORT: '3000', MCP_ALLOWED_ORIGINS: 'https://client.example.invalid',
};

test('configuration refuses production and missing identity or invalid origins', () => {
  assert.throws(() => loadConfig({ ...baseConfig, MCP_ENV: 'production' }, 'http'), /production is not enabled/);
  assert.throws(() => loadConfig({ ...baseConfig, DOLIBARR_URL: 'https://administration.globalcomm.ma' }, 'http'), /Production Dolibarr/);
  assert.throws(() => loadConfig({ ...baseConfig, MCP_OAUTH_ISSUER: '' }, 'http'), /MCP_OAUTH_ISSUER/);
  assert.throws(() => loadConfig({ ...baseConfig, MCP_ALLOWED_ORIGINS: '*' }, 'http'), /Invalid URL/);
  assert.throws(() => loadConfig({ ...baseConfig, MCP_ALLOWED_ORIGINS: 'http://client.example.invalid' }, 'http'), /HTTPS/);
  assert.throws(() => loadConfig({ ...baseConfig, MCP_PUBLIC_URL: 'https://user:secret@mcp.example.invalid/mcp' }, 'http'), /credentials/);
  assert.throws(() => loadConfig({ ...baseConfig, MCP_STDIO_SUBJECT: '', MCP_STDIO_SCOPES: '' }, 'stdio'), /MCP_STDIO_SCOPES/);
});

test('central policy denies anonymous, missing scope, production and every mutation risk', () => {
  const principal = { subject: 'alice', clientId: 'app', scopes: ['dolibarr:thirdparties:read'] };
  assert.equal(isAllowed('list_thirdparties', principal, 'staging'), true);
  assert.equal(isAllowed('list_invoices', principal, 'staging'), false);
  assert.equal(isAllowed('list_thirdparties', undefined, 'staging'), false);
  assert.equal(isAllowed('list_thirdparties', principal, 'production'), false);
  assert.equal(isAllowed('add_bank_transaction', principal, 'staging'), false);
  for (const riskLevel of [1, 2, 3]) {
    assert.equal(evaluatePolicy({ riskLevel, mutation: true, confirmationRequired: riskLevel > 1,
      enabledInProduction: true, scope: 'dolibarr:thirdparties:read' }, principal, 'staging'), false);
  }
});

test('JWT verification checks signature, issuer, audience, expiry and identity claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  const config = loadConfig(baseConfig, 'http');
  const verifier = createJwtVerifier(config.http, keys);
  const signed = (claims, audience = baseConfig.MCP_OAUTH_AUDIENCE, expiry = '5m') => new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(baseConfig.MCP_OAUTH_ISSUER)
    .setSubject('alice').setAudience(audience).setExpirationTime(expiry).sign(privateKey);
  const token = await signed({ client_id: 'trusted-app', scope: 'dolibarr:thirdparties:read' });
  const info = await verifier.verifyAccessToken(token);
  assert.equal(info.extra.subject, 'alice');
  assert.deepEqual(info.scopes, ['dolibarr:thirdparties:read']);
  await assert.rejects(verifier.verifyAccessToken(await signed({ client_id: 'trusted-app', scope: 'x' }, 'other-audience')), InvalidTokenError);
  await assert.rejects(verifier.verifyAccessToken(await signed({ scope: 'x' })), InvalidTokenError);
  await assert.rejects(verifier.verifyAccessToken(await signed({ client_id: 'trusted-app', scope: 'x' }, baseConfig.MCP_OAUTH_AUDIENCE, Math.floor(Date.now() / 1000) - 60)), InvalidTokenError);
  await assert.rejects(verifier.verifyAccessToken(token.slice(0, -2) + 'xx'), InvalidTokenError);
});

test('audit file is private and records only the sanitized event', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gc-audit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'audit.jsonl');
  const sink = new FileAuditSink(path);
  sink.write({ timestamp: '2026-09-26T00:00:00Z', requestId: 'test-id', subject: 'alice', clientId: 'app',
    tool: 'list_thirdparties', riskLevel: 0, outcome: 'succeeded', durationMs: 1 });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const content = await readFile(path, 'utf8');
  assert.match(content, /list_thirdparties/);
  assert.doesNotMatch(content, /DOLAPIKEY|dummy-test-only/);
  sink.close();
  const link = join(dir, 'link.jsonl');
  await symlink(path, link);
  assert.throws(() => new FileAuditSink(link));
});

test('audit outage stops ERP access and upstream errors cannot disclose secrets', async t => {
  const originalGet = DolibarrAPI.prototype.get;
  let calls = 0;
  DolibarrAPI.prototype.get = async () => { calls++; throw new Error('SECRET_RESPONSE_BODY'); };
  t.after(() => { DolibarrAPI.prototype.get = originalGet; });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const principal = { subject: 'alice', clientId: 'app', scopes: ['dolibarr:thirdparties:read'] };
  let auditBroken = true;
  const server = createServer({ api: new DolibarrAPI('https://example.invalid', 'dummy-test-only'),
    resolvePrincipal: () => principal, environment: 'staging',
    audit: { write() { if (auditBroken) throw new Error('Audit unavailable'); } } });
  const client = new Client({ name: 'security-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const blocked = await client.callTool({ name: 'list_thirdparties', arguments: {} });
  assert.equal(blocked.isError, true);
  assert.equal(calls, 0);
  auditBroken = false;
  const failed = await client.callTool({ name: 'list_thirdparties', arguments: {} });
  assert.equal(failed.isError, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(failed.content[0].text, /SECRET_RESPONSE_BODY|dummy-test-only/);
});

test('HTTP rejects unauthenticated, foreign origins, mismatched sessions, and hides ERP config', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gc-http-'));
  const config = loadConfig({ ...baseConfig, MCP_AUDIT_FILE: join(dir, 'audit.jsonl') }, 'http');
  const verifier = { async verifyAccessToken(token) {
    if (token === 'alice') return { token, clientId: 'one-app', scopes: ['dolibarr:thirdparties:read'], expiresAt: Date.now() / 1000 + 3600, extra: { subject: 'alice' } };
    if (token === 'alice-narrow') return { token, clientId: 'one-app', scopes: [], expiresAt: Date.now() / 1000 + 3600, extra: { subject: 'alice' } };
    if (token === 'bob') return { token, clientId: 'other-app', scopes: ['dolibarr:finance:read'], expiresAt: Date.now() / 1000 + 3600, extra: { subject: 'bob' } };
    throw new InvalidTokenError('Invalid access token');
  } };
  const { app, close } = createHttpApp(config, verifier);
  const listener = app.listen(0, '127.0.0.1');
  let client;
  t.after(async () => { if (client) await client.close(); await close(); await new Promise(resolve => listener.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  await once(listener, 'listening');
  const address = listener.address();
  const url = `http://127.0.0.1:${address.port}`;
  config.http.allowedHosts.add(`127.0.0.1:${address.port}`);

  const unauthorized = await globalThis.fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /resource_metadata=/);
  const badOrigin = await globalThis.fetch(`${url}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.invalid' } });
  assert.equal(badOrigin.status, 403);
  const allowed = await globalThis.fetch(`${url}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://client.example.invalid' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://client.example.invalid');
  const health = await (await globalThis.fetch(`${url}/health`)).text();
  assert.doesNotMatch(health, /example\.invalid\/api|dummy-test-only|MCP_OAUTH_/);
  const metadata = await (await globalThis.fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(metadata.authorization_servers, [baseConfig.MCP_OAUTH_ISSUER]);
  const oversized = await globalThis.fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer alice', 'content-type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(70000) }) });
  assert.equal(oversized.status, 413);

  const originalGet = DolibarrAPI.prototype.get;
  DolibarrAPI.prototype.get = async () => [{ id: 7, name: 'Fixture only' }];
  t.after(() => { DolibarrAPI.prototype.get = originalGet; });
  const headers = { Authorization: 'Bearer alice' };
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } });
  client = new Client({ name: 'security-test', version: '1.0.0' });
  await client.connect(transport);
  const advertised = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(advertised.includes('list_thirdparties'));
  assert.ok(!advertised.includes('list_invoices'));
  const accepted = await client.callTool({ name: 'list_thirdparties', arguments: {} });
  assert.match(accepted.content[0].text, /Fixture only/);
  headers.Authorization = 'Bearer alice-narrow';
  assert.deepEqual((await client.listTools()).tools, []);
  headers.Authorization = 'Bearer alice';
  const denied = await client.callTool({ name: 'list_invoices', arguments: {} });
  assert.equal(denied.isError, true);
  const hijack = await globalThis.fetch(`${url}/mcp`, { method: 'DELETE', headers: { Authorization: 'Bearer bob', 'mcp-session-id': transport.sessionId } });
  assert.equal(hijack.status, 404);
  const log = await readFile(config.auditFile, 'utf8');
  assert.match(log, /"outcome":"denied"/);
  assert.match(log, /"outcome":"succeeded"/);
  assert.doesNotMatch(log, /Bearer alice|Bearer bob|dummy-test-only/);
});
