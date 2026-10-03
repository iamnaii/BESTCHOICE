import { Prisma } from '@prisma/client';

export function receiptDecimal(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const result = new Prisma.Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}
