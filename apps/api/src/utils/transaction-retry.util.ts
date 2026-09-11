import { Prisma } from '@prisma/client';

/** Retry the entire transaction, including all eligibility reads and credit claims. */
export function isRetryablePrismaWriteError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002' || error.code === 'P2034') return true;
  // Advisory/row locks use raw SQL, whose PostgreSQL serialization/deadlock
  // errors are wrapped as P2010 instead of Prisma's ordinary P2034.
  return error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code));
}
