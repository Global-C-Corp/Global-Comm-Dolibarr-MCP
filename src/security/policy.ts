import type { Environment } from './config.js';
import type { Principal } from './identity.js';

export type RiskLevel = 0 | 1 | 2 | 3;
export interface ToolPolicy {
  riskLevel: RiskLevel;
  mutation: boolean;
  confirmationRequired: boolean;
  enabledInProduction: boolean;
  scope: string;
}

const read = (scope: string): ToolPolicy => ({ riskLevel: 0, mutation: false, confirmationRequired: false, enabledInProduction: false, scope });

export const TOOL_POLICIES: Readonly<Record<string, ToolPolicy>> = Object.freeze({
  list_thirdparties: read('dolibarr:thirdparties:read'), get_thirdparty: read('dolibarr:thirdparties:read'),
  get_thirdparty_invoices: read('dolibarr:finance:read'), get_thirdparty_proposals: read('dolibarr:commercial:read'),
  get_thirdparty_orders: read('dolibarr:commercial:read'), get_thirdparty_contacts: read('dolibarr:contacts:read'),
  list_contacts: read('dolibarr:contacts:read'), list_projects: read('dolibarr:projects:read'),
  get_project: read('dolibarr:projects:read'), list_tasks: read('dolibarr:projects:read'),
  list_proposals: read('dolibarr:commercial:read'), get_proposal: read('dolibarr:commercial:read'),
  list_orders: read('dolibarr:commercial:read'), get_order: read('dolibarr:commercial:read'),
  list_supplier_orders: read('dolibarr:commercial:read'), get_supplier_order: read('dolibarr:commercial:read'),
  list_invoices: read('dolibarr:finance:read'), get_invoice: read('dolibarr:finance:read'),
  list_supplier_invoices: read('dolibarr:finance:read'), get_supplier_invoice: read('dolibarr:finance:read'),
});

export function evaluatePolicy(policy: ToolPolicy | undefined, principal: Principal | undefined, environment: Environment): boolean {
  if (!policy || !principal?.subject || !principal.clientId || !principal.scopes.includes(policy.scope)) return false;
  // All mutations and all Level 3 operations remain disabled regardless of token claims.
  if (policy.mutation || policy.riskLevel !== 0 || policy.confirmationRequired) return false;
  return environment !== 'production' || policy.enabledInProduction;
}

export function isAllowed(name: string, principal: Principal | undefined, environment: Environment): boolean {
  return evaluatePolicy(TOOL_POLICIES[name], principal, environment);
}

// Future Level 2 approvals must be consumed from a trusted server-side store.
// Client arguments, chat messages and a model's confirmation cannot authorize a write.
export interface ConfirmationStore {
  consume(actionDigest: string, subject: string, approver: string): Promise<boolean>;
}
