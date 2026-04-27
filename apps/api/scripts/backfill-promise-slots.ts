/**
 * Backfill P2P lifecycle data from legacy CallLog fields → PromiseSlot rows.
 *
 * Phase 1: Create PromiseSlot rows from legacy settlementDate/Amount + secondSettlementDate/Amount
 *          on CallLog rows that have result=PROMISED but no slots yet.
 *          Also sets cycleStartedAt + cycleDeadline on migrated CallLogs.
 *
 * Phase 2: Backfill keptAt on historical PROMISED call logs whose settlement date has passed
 *          and whose contract received sufficient payment. Also increments Contract.keptPromiseCount.
 *
 * Run locally:  npx tsx apps/api/scripts/backfill-promise-slots.ts
 * Run on prod:  via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== P2P backfill: legacy CallLog → PromiseSlot ===');

  // Phase 1: PromiseSlot rows from legacy settlementDate/Amount + secondSettlementDate/Amount
  const legacy = await prisma.callLog.findMany({
    where: {
      result: 'PROMISED',
      deletedAt: null,
      slots: { none: {} }, // not yet migrated
      settlementDate: { not: null },
    },
    select: {
      id: true,
      contractId: true,
      settlementDate: true,
      settlementAmount: true,
      secondSettlementDate: true,
      secondSettlementAmount: true,
      brokenAt: true,
      createdAt: true,
    },
  });

  console.log(`Found ${legacy.length} legacy promises to migrate`);

  for (const cl of legacy) {
    const slots: any[] = [];
    if (cl.settlementDate && cl.settlementAmount) {
      slots.push({
        callLogId: cl.id,
        slotIndex: 1,
        settlementDate: cl.settlementDate,
        settlementAmount: cl.settlementAmount,
        ...(cl.brokenAt ? { brokenAt: cl.brokenAt } : {}),
      });
    }
    if (cl.secondSettlementDate && cl.secondSettlementAmount) {
      slots.push({
        callLogId: cl.id,
        slotIndex: 2,
        settlementDate: cl.secondSettlementDate,
        settlementAmount: cl.secondSettlementAmount,
      });
    }

    if (slots.length === 0) continue;

    await prisma.promiseSlot.createMany({ data: slots });

    // cycleStartedAt = createdAt; cycleDeadline = max settlementDate (legacy fallback)
    const maxDate = slots.reduce(
      (max: Date, s: any) =>
        s.settlementDate.getTime() > max.getTime() ? s.settlementDate : max,
      slots[0].settlementDate,
    );
    await prisma.callLog.update({
      where: { id: cl.id },
      data: {
        cycleStartedAt: cl.createdAt,
        cycleDeadline: maxDate,
      },
    });
  }

  console.log(`Phase 1 complete — migrated ${legacy.length} promises`);

  // Phase 2: backfill keptAt + Contract.keptPromiseCount for historical promises
  const candidatePromises = await prisma.callLog.findMany({
    where: {
      result: 'PROMISED',
      brokenAt: null,
      keptAt: null,
      supersededAt: null,
      canceledAt: null,
      settlementDate: { not: null, lt: new Date() },
    },
    select: { id: true, contractId: true, settlementDate: true, settlementAmount: true },
  });

  console.log(`Phase 2: checking ${candidatePromises.length} promises for kept-status`);

  let backfilledKept = 0;
  for (const p of candidatePromises) {
    if (!p.settlementDate || !p.settlementAmount) continue;
    const windowEnd = new Date(p.settlementDate.getTime() + 86400 * 1000);
    // C1 fix: count both paidAt (PaySolutions webhook) and paidDate (manual recordPayment).
    const sum = await prisma.payment.aggregate({
      where: {
        contractId: p.contractId,
        deletedAt: null,
        OR: [
          { paidAt: { not: null, lte: windowEnd } },
          { paidDate: { not: null, lte: windowEnd } },
        ],
      },
      _sum: { amountPaid: true },
    });
    const paid = sum._sum.amountPaid?.toNumber() ?? 0;
    const target = (p.settlementAmount as any).toNumber();
    if (paid >= target) {
      await prisma.callLog.update({
        where: { id: p.id },
        data: { keptAt: windowEnd },
      });
      await prisma.contract.update({
        where: { id: p.contractId },
        data: { keptPromiseCount: { increment: 1 } },
      });
      backfilledKept++;
    }
  }

  console.log(`Phase 2 complete — backfilled ${backfilledKept} kept promises`);
  console.log('=== Backfill done ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
