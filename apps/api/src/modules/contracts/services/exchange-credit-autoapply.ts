import { Prisma, PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

export type CreditAutoApplyResult =
  | { applied: true; installments: number; creditUsed: number; creditRemaining: number; actorId: string }
  | { applied: false; reason: 'NOT_EXCHANGE' | 'NO_CREDIT' | 'NO_PAYMENTS_SERVICE' | 'NO_ACTOR' | 'FAILED'; message?: string };

export interface CreditApplier {
  applyCreditBalance(contractId: string, recordedById: string): Promise<{
    allocatedPayments: unknown[];
    creditUsed: number;
    creditRemaining: number;
  }>;
}

const SENTRY_TAGS = { module: 'contracts', action: 'defect-exchange-credit-autoapply-failed', flow: 'defect-exchange' };

/**
 * 15ข (spec §6): หลังเปิดใช้สัญญาที่มาจากการเปลี่ยนเครื่องตำหนิ (`parentContractId`) และมีเครดิตที่ย้ายมา
 * (`creditBalance > 0`) → ใช้เครดิตชำระงวดทันที (เส้นทาง `applyCreditBalance` เดิม: ใบเสร็จ/ใบกำกับภาษี
 * ช่องทาง CREDIT_BALANCE + 2A ตามกติกา + LINE ตามกติกาใบงวด). เรียก**หลัง** tx ของ activate commit —
 * ล้มไม่ย้อนการเปิดใช้ (เครดิตค้าง ใช้ปุ่ม "ใช้ยอดเครดิต" มือ) · ไม่ throw.
 */
export async function applyExchangeCreditAfterActivation(
  deps: { prisma: Pick<PrismaClient, 'user'>; payments: CreditApplier | null | undefined },
  contract: {
    id: string;
    contractNumber: string;
    parentContractId: string | null;
    creditBalance: Prisma.Decimal | string | number | null;
  },
  actorId?: string | null,
): Promise<CreditAutoApplyResult> {
  if (!contract.parentContractId) return { applied: false, reason: 'NOT_EXCHANGE' };
  const credit = new Prisma.Decimal((contract.creditBalance ?? 0).toString());
  if (!credit.gt(0)) return { applied: false, reason: 'NO_CREDIT' };
  const extra = { contractId: contract.id, contractNumber: contract.contractNumber, creditBalance: credit.toFixed(2) };
  if (!deps.payments) {
    Sentry.captureMessage('[defect-exchange] activate without PaymentsService — credit left on contract', {
      level: 'warning', tags: SENTRY_TAGS, extra,
    });
    return { applied: false, reason: 'NO_PAYMENTS_SERVICE' };
  }
  let actor = actorId ?? null;
  if (!actor) {
    const system = await deps.prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    actor = system?.id ?? null;
  }
  if (!actor) {
    Sentry.captureMessage('[defect-exchange] no actor for credit auto-apply — credit left on contract', {
      level: 'warning', tags: SENTRY_TAGS, extra,
    });
    return { applied: false, reason: 'NO_ACTOR' };
  }
  try {
    const out = await deps.payments.applyCreditBalance(contract.id, actor);
    return {
      applied: true,
      installments: out.allocatedPayments.length,
      creditUsed: out.creditUsed,
      creditRemaining: out.creditRemaining,
      actorId: actor,
    };
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: SENTRY_TAGS, extra: { ...extra, actorId: actor } });
    return { applied: false, reason: 'FAILED', message: err instanceof Error ? err.message : String(err) };
  }
}
