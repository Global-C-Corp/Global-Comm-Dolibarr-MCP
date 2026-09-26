#!/usr/bin/env node
/**
 * src/index.ts — Point d'entrée STDIO (Claude Desktop, Cursor local, Windsurf local)
 * 
 * Importe createServer() depuis server.ts et connecte en mode stdio.
 * Comportement identique à l'original — aucun changement pour les utilisateurs Claude Desktop.
 * 
 * Digital Factory Senegal — https://digitalfactory.sn
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { DolibarrAPI } from './api.js';
import { loadConfig } from './security/config.js';
import { FileAuditSink } from './security/audit.js';
import dotenv from "dotenv";

dotenv.config();

const config = loadConfig(process.env, 'stdio');
const audit = new FileAuditSink(config.auditFile);
const principal = {
  subject: config.stdio!.subject,
  clientId: 'local-stdio',
  scopes: config.stdio!.scopes,
};
const server = createServer({
  api: new DolibarrAPI(config.dolibarrUrl, config.dolibarrApiKey),
  resolvePrincipal: () => principal,
  audit,
  environment: config.environment,
});
const transport = new StdioServerTransport();
await server.connect(transport);
