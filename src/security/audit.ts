import { closeSync, constants, fchmodSync, openSync, writeSync } from 'node:fs';
import type { Principal } from './identity.js';

export interface AuditEvent {
  timestamp: string;
  requestId: string;
  subject: string;
  clientId: string;
  tool: string;
  riskLevel: number;
  outcome: 'started' | 'succeeded' | 'denied' | 'failed';
  durationMs: number;
}
export interface AuditSink { write(event: AuditEvent): void }

export class FileAuditSink implements AuditSink {
  private readonly fd: number;
  constructor(path: string) {
    this.fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    fchmodSync(this.fd, 0o600);
  }
  write(event: AuditEvent): void {
    // Keep tool arguments, returned data, credentials, and request headers out of the audit log.
    writeSync(this.fd, JSON.stringify(event) + '\n');
  }
  close(): void { closeSync(this.fd); }
}

export function auditEvent(principal: Principal | undefined, tool: string, riskLevel: number, outcome: AuditEvent['outcome'], started: number, requestId: string): AuditEvent {
  return {
    timestamp: new Date().toISOString(), requestId, subject: principal?.subject ?? 'anonymous',
    clientId: principal?.clientId ?? 'unknown', tool, riskLevel, outcome,
    durationMs: Date.now() - started,
  };
}
