import { isAbsolute } from 'node:path';

export type Environment = 'development' | 'staging' | 'production';

export interface AppConfig {
  environment: Environment;
  dolibarrUrl: string;
  dolibarrApiKey: string;
  auditFile: string;
  stdio?: { subject: string; scopes: string[] };
  http?: {
    port: number;
    publicUrl: URL;
    issuer: URL;
    issuerId: string;
    jwksUrl: URL;
    audience: string;
    allowedOrigins: Set<string>;
    allowedHosts: Set<string>;
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${key}`);
  return value;
}

function httpsUrl(value: string, key: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid URL in ${key}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error(`${key} must be an HTTPS URL without credentials, query or fragment`);
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv, transport: 'http' | 'stdio'): AppConfig {
  const environment = required(env, 'MCP_ENV');
  if (environment !== 'development' && environment !== 'staging') {
    throw new Error('MCP_ENV must be development or staging; production is not enabled');
  }
  const dolibarrUrl = httpsUrl(required(env, 'DOLIBARR_URL'), 'DOLIBARR_URL');
  if (dolibarrUrl.hostname === 'administration.globalcomm.ma') {
    throw new Error('Production Dolibarr is blocked in Phase 2');
  }
  const auditFile = required(env, 'MCP_AUDIT_FILE');
  if (!isAbsolute(auditFile)) throw new Error('MCP_AUDIT_FILE must be an absolute path');
  const config: AppConfig = {
    environment,
    dolibarrUrl: dolibarrUrl.toString(),
    dolibarrApiKey: required(env, 'DOLIBARR_API_KEY'),
    auditFile,
  };

  if (transport === 'stdio') {
    const scopes = required(env, 'MCP_STDIO_SCOPES').split(/\s+/);
    config.stdio = { subject: required(env, 'MCP_STDIO_SUBJECT'), scopes };
  } else {
    const publicUrl = httpsUrl(required(env, 'MCP_PUBLIC_URL'), 'MCP_PUBLIC_URL');
    if (publicUrl.pathname !== '/mcp') throw new Error('MCP_PUBLIC_URL must end with /mcp');
    const issuerId = required(env, 'MCP_OAUTH_ISSUER');
    const issuer = httpsUrl(issuerId, 'MCP_OAUTH_ISSUER');
    const jwksUrl = httpsUrl(required(env, 'MCP_OAUTH_JWKS_URI'), 'MCP_OAUTH_JWKS_URI');
    const audience = required(env, 'MCP_OAUTH_AUDIENCE');
    const port = Number(env.PORT ?? '3000');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    const origins = (env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const allowedOrigins = new Set(origins.map(origin => {
      const url = httpsUrl(origin, 'MCP_ALLOWED_ORIGINS');
      if (url.href !== url.origin + '/') throw new Error('CORS origins must not contain paths');
      return url.origin;
    }));
    const allowedHosts = new Set([publicUrl.host, ...(env.MCP_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean)]);
    if ([...allowedHosts].some(host => !/^[a-zA-Z0-9.:-]+$/.test(host))) throw new Error('Invalid MCP_ALLOWED_HOSTS');
    config.http = { port, publicUrl, issuer, issuerId, jwksUrl, audience, allowedOrigins, allowedHosts };
  }
  return config;
}
