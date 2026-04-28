/**
 * Backfill P2P lifecycle data from legacy CallLog fields → PromiseSlot rows.
 *
 * Phase 1: Create PromiseSlot rows from legacy settlementDate/Amount +
 *          secondSettlementDate/Amount on CallLog rows that have result=PROMISED
 *          but no slots yet. Also sets cycleStartedAt + cycleDeadline.
 *          Per-CallLog work runs in a single transaction so a crash mid-row
 *          can't leave half-migrated state (M7/N7 fix).
 *
 * Phase 2: Backfill keptAt on historical PROMISED call logs whose slots have
 *          all passed and whose contract received sufficient cumulative
 *          payment. Marks each kept PromiseSlot's keptAt + paidAmount in the
 *          same transaction as CallLog.keptAt + Contract.keptPromiseCount
 *          (M7/N8 fix). Reads settlementAmount from PromiseSlot (post-Phase 1)
 *          rather than the legacy CallLog column, so it works on data that
 *          was migrated by Phase 1 even if legacy columns were nulled (N4 fix).
 *
 * Run locally:  npx tsx apps/api/scripts/backfill-promise-slots.ts
 * Run on prod:  via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface LegacySlot {
  callLogId: string;
  slotIndex: number;
  settlementDate: Date;
  settlementAmount: Prisma.Decimal;
  brokenAt?: Date;
}

async function main() {
  console.log('=== P2P backfill: legacy CallLog → PromiseSlot ===');

  // ─── Phase 1 ─────────────────────────────────────────────
  const legacy = await prisma.callLog.findMany({
    where: {
      result: 'PROMISED',
      deletedAt: null,
      slots: { none: {} },
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

  console.log(`Phase 1: found ${legacy.length} legacy promises to migrate`);

  let phase1Migrated = 0;
  let phase1Skipped = 0;
  for (const cl of legacy) {
    const slots: LegacySlot[] = [];
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
        slotIndex: slots.length === 0 ? 1 : 2,
        settlementDate: cl.secondSettlementDate,
        settlementAmount: cl.secondSettlementAmount,
      });
    }

    if (slots.length === 0) {
      phase1Skipped++;
      continue;
    }

    const maxDate = slots.reduce(
      (max, s) => (s.settlementDate.getTime() > max.getTime() ? s.settlementDate : max),
      slots[0].settlementDate,
    );

    await prisma.$transaction([
      prisma.promiseSlot.createMany({ data: slots }),
      prisma.callLog.update({
        where: { id: cl.id },
        data: {
          cycleStartedAt: cl.createdAt,
          cycleDeadline: maxDate,
        },
      }),
    ]);
    phase1Migrated++;
  }

  console.log(`Phase 1 complete — migrated ${phase1Migrated}, skipped ${phase1Skipped}`);

  // ─── Phase 2 ─────────────────────────────────────────────
  const candidates = await prisma.callLog.findMany({
    where: {
      result: 'PROMISED',
      deletedAt: null,
      brokenAt: null,
      keptAt: null,
      supersededAt: null,
      canceledAt: null,
      slots: { some: {} },
    },
    select: {
      id: true,
      contractId: true,
      cycleStartedAt: true,
      createdAt: true,
      slots: {
        orderBy: { slotIndex: 'asc' },
        select: {
          id: true,
          slotIndex: true,
          settlementDate: true,
          settlementAmount: true,
          keptAt: true,
          brokenAt: true,
        },
      },
    },
  });

  console.log(`Phase 2: checking ${candidates.length} promises for kept-status`);

  const now = new Date();
  let backfilledKept = 0;
  for (const p of candidates) {
    if (p.slots.length === 0) continue;
    if (p.slots.some((s) => s.keptAt || s.brokenAt)) continue;

    const lastSlot = p.slots[p.slots.length - 1];
    if (lastSlot.settlementDate.getTime() >= now.getTime()) continue;

    const cycleStart = p.cycleStartedAt ?? p.createdAt;
    const windowEnd = new Date(lastSlot.settlementDate.getTime() + 86400 * 1000);
    const cumulativeTarget = p.slots.reduce(
      (total, s) => total.add(s.settlementAmount),
      new Prisma.Decimal(0),
    );

    const sum = await prisma.payment.aggregate({
      where: {
        contractId: p.contractId,
        deletedAt: null,
        OR: [
          { paidAt: { not: null, gte: cycleStart, lte: windowEnd } },
          { paidDate: { not: null, gte: cycleStart, lte: windowEnd } },
        ],
      },
      _sum: { amountPaid: true },
    });
    const paid = sum._sum.amountPaid ?? new Prisma.Decimal(0);
    if (paid.lt(cumulativeTarget)) continue;

    await prisma.$transaction([
      ...p.slots.map((s) =>
        prisma.promiseSlot.update({
          where: { id: s.id },
          data: { keptAt: windowEnd, paidAmount: s.settlementAmount },
        }),
      ),
      prisma.callLog.update({
        where: { id: p.id },
        data: { keptAt: windowEnd },
      }),
      prisma.contract.update({
        where: { id: p.contractId },
        data: { keptPromiseCount: { increment: 1 } },
      }),
    ]);
    backfilledKept++;
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
