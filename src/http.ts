#!/usr/bin/env node
/** Local HTTP resource server. External TLS and identity provider are not deployed in Phase 2. */
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DolibarrAPI } from './api.js';
import { createServer } from './server.js';
import { APP_NAME, APP_VERSION } from './version.js';
import { FileAuditSink } from './security/audit.js';
import { loadConfig, type AppConfig } from './security/config.js';
import { createJwtVerifier, type Principal } from './security/identity.js';
import dotenv from 'dotenv';

type Session = { transport: StreamableHTTPServerTransport; server: Server; subject: string; clientId: string; lastSeen: number };

export function createHttpApp(config: AppConfig, verifier?: OAuthTokenVerifier) {
  const http = config.http;
  if (!http) throw new Error('HTTP configuration required');
  const audit = new FileAuditSink(config.auditFile);
  const api = new DolibarrAPI(config.dolibarrUrl, config.dolibarrApiKey);
  const principalContext = new AsyncLocalStorage<Principal>();
  const sessions = new Map<string, Session>();
  const app = express();
  app.disable('x-powered-by');
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(http.publicUrl);
  const bearer = requireBearerAuth({ verifier: verifier ?? createJwtVerifier(http), resourceMetadataUrl: metadataUrl });

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!http.allowedHosts.has(req.headers.host ?? '')) { res.status(400).json({ error: 'Invalid host' }); return; }
    const origin = req.headers.origin;
    if (origin && !http.allowedOrigins.has(origin)) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });

  app.get(new URL(metadataUrl).pathname, (_req, res) => {
    res.json({ resource: http.publicUrl.toString(), authorization_servers: [http.issuerId],
      scopes_supported: ['dolibarr:thirdparties:read', 'dolibarr:contacts:read', 'dolibarr:projects:read',
        'dolibarr:commercial:read', 'dolibarr:finance:read'] });
  });
  app.options('/mcp', (req, res) => {
    if (!req.headers.origin) { res.status(403).end(); return; }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, Last-Event-ID');
    res.status(204).end();
  });

  app.use('/mcp', bearer);
  app.post('/mcp', (req, res, next) => {
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON required' }); return; }
    next();
  });
  app.use('/mcp', express.json({ limit: '64kb', strict: true }));

  function getPrincipal(req: Request): Principal | undefined {
    const subject = req.auth?.extra?.subject;
    if (!req.auth || typeof subject !== 'string' || !subject) return undefined;
    return { subject, clientId: req.auth.clientId, scopes: req.auth.scopes };
  }
  function findSession(req: Request, principal: Principal): Session | undefined {
    const id = req.headers['mcp-session-id'];
    if (typeof id !== 'string') return undefined;
    const session = sessions.get(id);
    if (!session || session.subject !== principal.subject || session.clientId !== principal.clientId) return undefined;
    session.lastSeen = Date.now();
    return session;
  }

  app.post('/mcp', async (req: Request, res: Response) => {
    const principal = getPrincipal(req);
    if (!principal) { res.status(401).end(); return; }
    try {
      let session = findSession(req, principal);
      if (!session && !req.headers['mcp-session-id'] && isInitializeRequest(req.body)) {
        if (sessions.size >= 100) { res.status(503).json({ error: 'Too many sessions' }); return; }
        const id = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => id,
          onsessioninitialized: sessionId => { if (session) sessions.set(sessionId, session); },
        });
        const server = createServer({ api, resolvePrincipal: () => principalContext.getStore(), audit, environment: config.environment });
        session = { transport, server, subject: principal.subject, clientId: principal.clientId, lastSeen: Date.now() };
        transport.onclose = () => { sessions.delete(id); };
        await server.connect(transport);
      } else if (!session) {
        res.status(404).json({ error: 'Session unavailable' }); return;
      }
      await principalContext.run(principal, () => session.transport.handleRequest(req, res, req.body));
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const principal = getPrincipal(req);
    const session = principal && findSession(req, principal);
    if (!principal || !session) { res.status(404).json({ error: 'Session unavailable' }); return; }
    try { await principalContext.run(principal, () => session.transport.handleRequest(req, res)); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'Internal error' }); }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const principal = getPrincipal(req);
    const session = principal && findSession(req, principal);
    if (!principal || !session) { res.status(404).json({ error: 'Session unavailable' }); return; }
    try { await session.transport.close(); await session.server.close(); res.status(204).end(); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: APP_NAME, version: APP_VERSION }));
  app.use((error: Error, _req: Request, res: Response, _next: () => void) => {
    void _next;
    res.status('type' in error && error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request' });
  });

  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.lastSeen > 30 * 60 * 1000) {
        sessions.delete(id);
        void session.transport.close().then(() => session.server.close()).catch(() => { console.error('[MCP] Session cleanup failed'); });
      }
    }
  }, 60 * 1000);
  cleanup.unref();
  return { app, close: async () => {
    clearInterval(cleanup);
    for (const session of sessions.values()) { await session.transport.close(); await session.server.close(); }
    sessions.clear();
    audit.close();
  } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  dotenv.config();
  const config = loadConfig(process.env, 'http');
  const { app, close } = createHttpApp(config);
  const listener = app.listen(config.http!.port, '127.0.0.1', () => {
    console.error(`[MCP] Local HTTP listener on 127.0.0.1:${config.http!.port}`);
  });
  listener.requestTimeout = 15_000;
  listener.headersTimeout = 10_000;
  listener.keepAliveTimeout = 5_000;
  listener.maxRequestsPerSocket = 100;
  process.on('SIGTERM', () => { void close().then(() => listener.close()); });
}
