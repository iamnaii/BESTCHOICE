import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CreditHistoryActor {
  id: string;
  role: string;
}

/** Imported statements keep the same visibility as their source chat room. */
export function creditHistoryAccess(actor?: CreditHistoryActor): Prisma.CreditCheckWhereInput {
  if (!actor) return {}; // Internal contract checks already have their own access boundary.
  const legacy: Prisma.CreditCheckWhereInput = { roomAnalysis: { is: null } };
  if (!['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'].includes(actor.role)) return legacy;
  return {
    OR: [
      legacy,
      {
        roomAnalysis: {
          is: {
            deletedAt: null,
            room: {
              is: {
                deletedAt: null,
                ...(actor.role === 'SALES'
                  ? { OR: [{ assignedToId: null }, { assignedToId: actor.id }] }
                  : {}),
              },
            },
          },
        },
      },
    ],
  };
}

/** Contract workflows may use the approval internally, but must not disclose the source OCR. */
export async function visibleContractCredit<
  T extends { creditCheck: { id: string; aiAnalysis?: unknown } | null },
>(db: PrismaService, contract: T, actor?: CreditHistoryActor): Promise<T> {
  if (
    !actor ||
    (contract.creditCheck?.aiAnalysis as Record<string, unknown> | null)?.source !==
      'chat-statement'
  )
    return contract;
  const visible = await db.creditCheck.findFirst({
    where: { id: contract.creditCheck!.id, ...creditHistoryAccess(actor) },
    select: { id: true },
  });
  return visible ? contract : { ...contract, creditCheck: null };
}
