import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

// Use the same source projection at render, persistence, attachment and notification.
export const DOCUMENT_SOURCE_INCLUDE = {
  customer: true,
  product: true,
  branch: true,
  salesperson: true,
  payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
  signatures: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
  pdpaConsent: true,
} satisfies Prisma.ContractInclude;

export function documentSourceRevision(source: unknown): string {
  // Canonical keys also make Date/Decimal serialization consistent across reads.
  const json = JSON.stringify(source);
  const normalized = JSON.stringify(JSON.parse(json), (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return createHash('sha256').update(normalized).digest('hex');
}
