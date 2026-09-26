/**
 * src/server.ts — MCP Dolibarr v5.0 — COMPLET 100%
 * Digital Factory Senegal — https://digitalfactory.sn
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { DolibarrAPI } from "./api.js";
import { APP_NAME, APP_VERSION } from "./version.js";
import { randomUUID } from 'node:crypto';
import { TOOL_POLICIES, isAllowed } from './security/policy.js';
import { auditEvent, type AuditSink } from './security/audit.js';
import type { Environment } from './security/config.js';
import type { Principal } from './security/identity.js';

import { thirdpartyTools, handleThirdpartyTool } from "./tools/thirdparties.js";
import { invoiceTools, handleInvoiceTool } from "./tools/invoices.js";
import { proposalTools, handleProposalTool } from "./tools/proposals.js";
import { orderTools, supplierOrderTools, handleOrderTool } from "./tools/orders.js";
import { productTools, handleProductTool } from "./tools/products.js";
import { accountingTools, handleAccountingTool } from "./tools/accounting.js";
import { crmTools, projectTools, hrTools, contractTools, handleCrmTool, handleProjectTool, handleHrTool, handleContractTool } from "./tools/crm_projects_hr.js";
import { setupTools, handleSetupTool } from "./tools/setup.js";
import { supplierInvoiceTools, handleSupplierInvoiceTool } from "./tools/supplier_invoices.js";
import { interventionTools, handleInterventionTool } from "./tools/interventions.js";
import { ticketTools, handleTicketTool } from "./tools/tickets.js";
import { shipmentTools, receptionTools, handleShipmentTool } from "./tools/shipments.js";
import { categoryTools, handleCategoryTool } from "./tools/categories.js";
import { memberTools, handleMemberTool } from "./tools/members.js";
import { bomTools, manufacturingTools, handleBomTool, handleManufacturingTool } from "./tools/manufacturing.js";
import { leaveTools, salaryTools, handleLeaveTool, handleSalaryTool } from "./tools/hr_advanced.js";
import { documentTools, handleDocumentTool } from "./tools/documents.js";
import { warehouseTools, batchTools, handleWarehouseTool } from "./tools/warehouses.js";
import { paymentTools, handlePaymentTool } from "./tools/payments.js";
import { mailingTools, resourceTools, handleMailingTool, handleResourceTool } from "./tools/mailings.js";
import { donationTools, loanTools, handleDonationTool, handleLoanTool } from "./tools/donations_loans.js";
import { expenseReportTools, handleExpenseReportTool } from "./tools/expense_reports.js";
import { accountingAdvancedTools, handleAccountingAdvancedTool } from "./tools/accounting_advanced.js";
import { accountingConfigTools, handleAccountingConfigTool } from "./tools/accounting_config.js";
import { pricingTools, handlePricingTool } from "./tools/pricing.js";
import { notificationTools, handleNotificationTool } from "./tools/notifications.js";

dotenv.config();

const UPSTREAM_TOOLS = [
  ...thirdpartyTools, ...invoiceTools, ...proposalTools,
  ...orderTools, ...supplierOrderTools, ...productTools,
  ...accountingTools, ...crmTools, ...projectTools,
  ...hrTools, ...contractTools, ...setupTools,
  ...supplierInvoiceTools, ...interventionTools, ...ticketTools,
  ...shipmentTools, ...receptionTools, ...categoryTools,
  ...memberTools, ...bomTools, ...manufacturingTools,
  ...leaveTools, ...salaryTools,
  ...documentTools, ...warehouseTools, ...batchTools,
  ...paymentTools, ...mailingTools, ...resourceTools,
  ...donationTools, ...loanTools,
  ...expenseReportTools,
  ...accountingAdvancedTools,
  ...accountingConfigTools,
  ...pricingTools,
  ...notificationTools,
];

const BLOCKED_FILTERS = new Set(['sqlfilters', 'sortfield']);
const ALL_TOOLS = UPSTREAM_TOOLS.filter(tool => Object.hasOwn(TOOL_POLICIES, tool.name)).map(tool => ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    properties: Object.fromEntries(
      Object.entries(tool.inputSchema.properties || {}).filter(([name]) => !BLOCKED_FILTERS.has(name))
    ),
  },
}));
const READ_TOOLS_BY_NAME = new Map(ALL_TOOLS.map(tool => [tool.name, tool]));

if (ALL_TOOLS.length !== Object.keys(TOOL_POLICIES).length ||
    new Set(ALL_TOOLS.map(tool => tool.name)).size !== ALL_TOOLS.length) {
  throw new Error('MCP tool registry contains missing or duplicate policy names');
}

class InputError extends Error {}
async function routeTool(name: string, args: Record<string, unknown>, api: DolibarrAPI): Promise<string> {
  const tool = READ_TOOLS_BY_NAME.get(name);
  if (!tool) {
    throw new InputError('Tool unavailable in read-only baseline');
  }
  const properties = tool.inputSchema.properties || {};
  if (Object.keys(args).length > 20) throw new InputError('Too many arguments');
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key] as { type?: string; enum?: unknown[] } | undefined;
    if (!schema || BLOCKED_FILTERS.has(key)) throw new InputError(`Unsupported baseline argument: ${key}`);
    if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new InputError(`Expected a number for ${key}`);
    }
    if (schema.type === 'string' && typeof value !== 'string') {
      throw new InputError(`Expected a string for ${key}`);
    }
    if (schema.type === 'string' && (value as string).length > 256) throw new InputError(`Value too long for ${key}`);
    if (key === 'thirdparty_ids' && !/^[1-9]\d*(,[1-9]\d*)*$/.test(value as string)) {
      throw new InputError('Invalid thirdparty_ids');
    }
    if (schema.enum && !schema.enum.includes(value)) throw new InputError(`Invalid value for ${key}`);
    if (schema.type === 'number' && (key === 'id' || key.endsWith('_id') || key === 'limit' || key === 'page') &&
        (!Number.isSafeInteger(value) || (key === 'page' ? (value as number) < 0 : (value as number) < 1))) {
      throw new InputError(`Invalid integer for ${key}`);
    }
    if (key === 'limit' && (value as number) > 100) throw new InputError('Limit exceeds 100');
    if (key === 'page' && (value as number) > 1000) throw new InputError('Page exceeds 1000');
  }
  for (const required of tool.inputSchema.required || []) {
    if (args[required] === undefined) throw new InputError(`Missing required argument: ${required}`);
  }
  const sets = [
    { tools: thirdpartyTools, h: handleThirdpartyTool },
    { tools: invoiceTools, h: handleInvoiceTool },
    { tools: proposalTools, h: handleProposalTool },
    { tools: [...orderTools, ...supplierOrderTools], h: handleOrderTool },
    { tools: productTools, h: handleProductTool },
    { tools: accountingTools, h: handleAccountingTool },
    { tools: crmTools, h: handleCrmTool },
    { tools: projectTools, h: handleProjectTool },
    { tools: hrTools, h: handleHrTool },
    { tools: contractTools, h: handleContractTool },
    { tools: setupTools, h: handleSetupTool },
    { tools: supplierInvoiceTools, h: handleSupplierInvoiceTool },
    { tools: interventionTools, h: handleInterventionTool },
    { tools: ticketTools, h: handleTicketTool },
    { tools: [...shipmentTools, ...receptionTools], h: handleShipmentTool },
    { tools: categoryTools, h: handleCategoryTool },
    { tools: memberTools, h: handleMemberTool },
    { tools: bomTools, h: handleBomTool },
    { tools: manufacturingTools, h: handleManufacturingTool },
    { tools: leaveTools, h: handleLeaveTool },
    { tools: salaryTools, h: handleSalaryTool },
    { tools: documentTools, h: handleDocumentTool },
    { tools: [...warehouseTools, ...batchTools], h: handleWarehouseTool },
    { tools: paymentTools, h: handlePaymentTool },
    { tools: mailingTools, h: handleMailingTool },
    { tools: resourceTools, h: handleResourceTool },
    { tools: donationTools, h: handleDonationTool },
    { tools: loanTools, h: handleLoanTool },
    { tools: expenseReportTools, h: handleExpenseReportTool },
    { tools: accountingAdvancedTools, h: handleAccountingAdvancedTool },
    { tools: accountingConfigTools, h: handleAccountingConfigTool },
    { tools: pricingTools, h: handlePricingTool },
    { tools: notificationTools, h: handleNotificationTool },
  ];
  for (const { tools, h } of sets) {
    if (tools.map(t => t.name).includes(name)) return h(name, args, api);
  }
  throw new Error(`Outil inconnu : ${name}`);
}

export interface ServerOptions {
  api: DolibarrAPI;
  resolvePrincipal: () => Principal | undefined;
  audit: AuditSink;
  environment: Environment;
}

export function createServer({ api, resolvePrincipal, audit, environment }: ServerOptions): Server {
  const server = new Server({ name: APP_NAME, version: APP_VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.filter(tool => isAllowed(tool.name, resolvePrincipal(), environment)),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const principal = resolvePrincipal();
    const started = Date.now();
    const requestId = randomUUID();
    const safeName = /^[a-z0-9_]{1,64}$/.test(name) ? name : 'invalid_tool_name';
    const risk = TOOL_POLICIES[name]?.riskLevel ?? 3;
    try {
      if (!isAllowed(name, principal, environment)) {
        audit.write(auditEvent(principal, safeName, risk, 'denied', started, requestId));
        return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };
      }
      audit.write(auditEvent(principal, safeName, risk, 'started', started, requestId));
      const result = await routeTool(name, (args as Record<string, unknown>) || {}, api);
      audit.write(auditEvent(principal, safeName, risk, 'succeeded', started, requestId));
      return { content: [{ type: "text" as const, text: result }] };
    } catch (error) {
      try { audit.write(auditEvent(principal, safeName, risk, 'failed', started, requestId)); }
      catch { console.error('[MCP] Audit unavailable'); }
      const message = error instanceof InputError ? error.message : 'Operation unavailable';
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  });
  return server;
}
