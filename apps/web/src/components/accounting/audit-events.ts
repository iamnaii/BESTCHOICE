import type { IcabAuditEvent } from './types';

/**
 * Raw audit-log row as returned by the per-document audit endpoints
 * (`GET /other-income/:id/audit`, `GET /expense-documents/:id/audit`,
 * `POST /assets/:id/audit`). Only the fields the timeline needs are typed;
 * `newValue` is an opaque JSON blob the reverse/void mutations stamp.
 */
export interface RawAuditEntry {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string } | null;
  newValue?: unknown;
}

/**
 * Map server-side AuditLog rows to the `IcabAuditEvent` shape consumed by the
 * shared InternalControlActionBar timeline. Shared across all three accounting
 * modules so the reason-extraction precedence stays identical.
 *
 * The server `action` strings (CREATED / POSTED / VOIDED / REVERSED / ...) are
 * preserved verbatim — the timeline's label registry handles the canonical set
 * and falls back gracefully for unknown values.
 *
 * `reason` precedence: structured `reverseReasonLabel` (+ `reverseNote`) →
 * free-form `reverseNote` → enum `reverseReason`. The asset module historically
 * stamps `reversalReason`, so that key is honoured too.
 */
export function mapAuditEvents(entries: RawAuditEntry[]): IcabAuditEvent[] {
  return entries.map((e) => {
    const nv =
      e.newValue && typeof e.newValue === 'object'
        ? (e.newValue as Record<string, unknown>)
        : null;
    const str = (key: string): string | undefined => {
      const v = nv?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const label = str('reverseReasonLabel');
    const note = str('reverseNote');
    const enumFallback = str('reverseReason') ?? str('reversalReason');
    const reason =
      label && note && label !== note ? `${label} — ${note}` : (label ?? note ?? enumFallback);
    return {
      event: e.action,
      userId: e.user?.id ?? 'unknown',
      userName: e.user?.name ?? 'ระบบ',
      timestamp: e.createdAt,
      reason,
    };
  });
}
