import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AppConfig } from './config.js';

export interface Principal {
  subject: string;
  clientId: string;
  scopes: string[];
}

export function createJwtVerifier(http: NonNullable<AppConfig['http']>, keys: JWTVerifyGetKey = createRemoteJWKSet(http.jwksUrl)): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: http.issuerId,
          audience: http.audience,
          algorithms: ['RS256', 'ES256'],
        });
        const clientId = payload.client_id;
        const scope = payload.scope;
        const scopes = typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : payload.scp;
        if (!payload.sub || typeof clientId !== 'string' || !clientId || !Array.isArray(scopes) ||
            !scopes.every(s => typeof s === 'string') || typeof payload.exp !== 'number') {
          throw new Error('Missing identity claims');
        }
        return { token, clientId, scopes: scopes as string[], expiresAt: payload.exp, extra: { subject: payload.sub } };
      } catch {
        throw new InvalidTokenError('Invalid access token');
      }
    },
  };
}
