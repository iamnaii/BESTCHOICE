import { randomUUID } from 'node:crypto';

/**
 * Inter-company JE link utility (Phase A.1b).
 *
 * Pairs SHOP + FINANCE journal entries by embedding a shared UUID in the
 * description: `[IC-<uuid>] <description>`. Lets us query paired entries
 * without coupling JournalEntry to a parent table (InterCompanyTransaction
 * is per-sale, not per-payment, so it doesn't fit per-installment commission).
 */

const IC_PREFIX = /^\[IC-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i;

export function generateInterCompanyId(): string {
  return randomUUID();
}

export function formatInterCompanyDescription(intercompanyId: string, description: string): string {
  return `[IC-${intercompanyId}] ${description}`;
}

export function parseInterCompanyId(description: string): string | null {
  const match = description.match(IC_PREFIX);
  return match ? match[1] : null;
}
