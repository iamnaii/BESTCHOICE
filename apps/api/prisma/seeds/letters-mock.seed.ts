/* eslint-disable no-console */
/**
 * Mock seed for /letters page testing.
 *
 * Creates ~15 ContractLetter rows spread across all 5 statuses so a developer
 * can exercise every tab + bulk action + dispatch flow + cancel + revert.
 *
 * Usage:
 *   cd apps/api && npm run seed:letters-mock
 *
 * Safe to re-run — uses upsert keyed by letterNumber. Existing rows update.
 *
 * Requires: at least 8 Contracts + 1 User (OWNER/FM/BM/ACCOUNTANT) in DB.
 * Run `npm run prisma:seed` first if the database is empty.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LETTER_NUMBER_PREFIX = 'ST-MOCK';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('❌ Cannot run mock seed in production.');
  }

  console.log('=== Letters mock seed ===');

  // Clean slate — delete any prior ST-MOCK-* letters so re-running with a
  // different contract pool doesn't hit the (contract_id, letter_type)
  // unique constraint. Other (real) letters are untouched.
  const deleted = await prisma.contractLetter.deleteMany({
    where: { letterNumber: { startsWith: LETTER_NUMBER_PREFIX } },
  });
  if (deleted.count > 0) {
    console.log(`Cleared ${deleted.count} prior ST-MOCK letters`);
  }

  // Find any active user to attribute dispatches to
  const dispatcher = await prisma.user.findFirst({
    where: { role: { in: ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT'] } },
    select: { id: true, email: true, name: true },
  });
  if (!dispatcher) {
    throw new Error('❌ No eligible dispatcher user found. Run `npm run prisma:seed` first.');
  }
  console.log(`Dispatcher: ${dispatcher.name} (${dispatcher.email})`);

  // Find contracts to attach letters to. Schema has @@unique([contractId, letterType])
  // so each contract supports at most 2 letters (one per type).
  //
  // For realistic letter content the contract needs at least one payment
  // with amountDue > amountPaid (otherwise outstanding = 0 in the rendered
  // letter). We MUTATE selected contracts to ensure their earliest unpaid
  // payment looks overdue: dueDate ~50 days ago + status OVERDUE + lateFee=200.
  // Falls back to any contract with payments if dev DB has nothing overdue.
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      contractNumber: true,
      monthlyPayment: true,
      totalMonths: true,
      paymentDueDay: true,
      customer: { select: { name: true } },
      payments: {
        where: { deletedAt: null },
        select: {
          id: true,
          installmentNo: true,
          dueDate: true,
          amountDue: true,
          amountPaid: true,
          lateFee: true,
          status: true,
        },
        orderBy: { installmentNo: 'asc' },
      },
    },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  if (contracts.length < 8) {
    throw new Error(
      `❌ Need at least 8 contracts (found ${contracts.length}). ` +
        `Run \`npm run prisma:seed\` first.`,
    );
  }
  console.log(`Found ${contracts.length} contracts`);

  // Generate payment schedule for contracts that don't have one yet.
  // Test data sometimes has Contract rows without Payment children, which
  // would produce 0.00 baht outstanding in the rendered letter.
  const fiftyDaysAgo = new Date(Date.now() - 50 * 86400000);
  let generated = 0;
  for (const c of contracts) {
    if (c.payments.length > 0) continue;
    const months = c.totalMonths || 12;
    const monthly = Number(c.monthlyPayment) || 1500;
    const dueDay = c.paymentDueDay ?? 30;
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth() - 1, dueDay);
    const data = Array.from({ length: months }, (_, i) => ({
      contractId: c.id,
      installmentNo: i + 1,
      dueDate: new Date(startMonth.getFullYear(), startMonth.getMonth() + i, dueDay),
      amountDue: monthly,
      status: 'PENDING' as const,
    }));
    await prisma.payment.createMany({ data, skipDuplicates: true });
    generated++;
  }
  if (generated > 0) {
    console.log(`Generated payment schedules for ${generated} contracts`);
  }

  // Re-fetch contracts to pick up the freshly created payments
  const enriched = await prisma.contract.findMany({
    where: { id: { in: contracts.map((c) => c.id) } },
    select: {
      id: true,
      contractNumber: true,
      customer: { select: { name: true } },
      payments: {
        where: { deletedAt: null },
        select: {
          id: true,
          installmentNo: true,
          dueDate: true,
          amountDue: true,
          amountPaid: true,
          lateFee: true,
          status: true,
        },
        orderBy: { installmentNo: 'asc' },
      },
    },
  });

  // Mutate the earliest unpaid payment of each contract to look overdue
  // (dueDate 50d ago + status OVERDUE + lateFee 200 + amountPaid 0).
  let mutated = 0;
  for (const c of enriched) {
    const target =
      c.payments.find(
        (p) =>
          ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status) &&
          Number(p.amountDue) > Number(p.amountPaid ?? 0),
      ) ?? c.payments[0];
    if (!target) continue;

    const needsUpdate =
      new Date(target.dueDate).getTime() > Date.now() ||
      target.status !== 'OVERDUE' ||
      !target.lateFee ||
      Number(target.lateFee) === 0 ||
      Number(target.amountPaid ?? 0) > 0;

    if (needsUpdate) {
      await prisma.payment.update({
        where: { id: target.id },
        data: {
          status: 'OVERDUE',
          dueDate: fiftyDaysAgo,
          lateFee: 200,
          amountPaid: 0,
        },
      });
      mutated++;
    }
  }
  if (mutated > 0) {
    console.log(`Marked ${mutated} payments as OVERDUE (50d ago, lateFee 200)`);
  }

  // Replace original `contracts` with the enriched + mutated version for
  // the rest of the script (letter creation loop below uses `contracts[i]`).
  contracts.splice(0, contracts.length, ...enriched as any);

  // Distribution plan: 5 PENDING_DISPATCH, 3 PDF_GENERATED, 5 DISPATCHED,
  // 1 DELIVERED, 1 UNDELIVERABLE, 1 CANCELLED = 16 letters total.
  // Mix letter types within each status.
  type LetterPlan = {
    seq: number;
    status: 'PENDING_DISPATCH' | 'PDF_GENERATED' | 'DISPATCHED' | 'DELIVERED' | 'UNDELIVERABLE' | 'CANCELLED';
    letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
    contractIdx: number;
    trackingNumber?: string;
    cancelReason?: string;
    daysAgo?: number;
  };

  const plans: LetterPlan[] = [
    // PENDING_DISPATCH — fresh, just generated by cron, no PDF yet
    { seq: 1, status: 'PENDING_DISPATCH', letterType: 'RETURN_DEVICE_45D', contractIdx: 0, daysAgo: 0 },
    { seq: 2, status: 'PENDING_DISPATCH', letterType: 'RETURN_DEVICE_45D', contractIdx: 1, daysAgo: 0 },
    { seq: 3, status: 'PENDING_DISPATCH', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 2, daysAgo: 1 },
    { seq: 4, status: 'PENDING_DISPATCH', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 3, daysAgo: 1 },
    { seq: 5, status: 'PENDING_DISPATCH', letterType: 'RETURN_DEVICE_45D', contractIdx: 4, daysAgo: 2 },

    // PDF_GENERATED — pdf made, waiting to dispatch
    { seq: 6, status: 'PDF_GENERATED', letterType: 'RETURN_DEVICE_45D', contractIdx: 5, daysAgo: 3 },
    { seq: 7, status: 'PDF_GENERATED', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 6, daysAgo: 3 },
    { seq: 8, status: 'PDF_GENERATED', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 7, daysAgo: 4 },

    // DISPATCHED — sent via Thailand Post, awaiting confirmation
    { seq: 9, status: 'DISPATCHED', letterType: 'RETURN_DEVICE_45D', contractIdx: 0, trackingNumber: 'EM123456789TH', daysAgo: 7 },
    { seq: 10, status: 'DISPATCHED', letterType: 'RETURN_DEVICE_45D', contractIdx: 1, trackingNumber: 'EM123456790TH', daysAgo: 7 },
    { seq: 11, status: 'DISPATCHED', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 4, trackingNumber: 'EM987654321TH', daysAgo: 10 },
    { seq: 12, status: 'DISPATCHED', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 5, trackingNumber: 'EM987654322TH', daysAgo: 10 },
    { seq: 13, status: 'DISPATCHED', letterType: 'RETURN_DEVICE_45D', contractIdx: 6, trackingNumber: 'RH111222333TH', daysAgo: 14 },

    // UNDELIVERABLE — returned by post office (wrong address etc.)
    { seq: 14, status: 'UNDELIVERABLE', letterType: 'RETURN_DEVICE_45D', contractIdx: 2, trackingNumber: 'EM555444333TH', daysAgo: 21 },

    // CANCELLED — manually cancelled by OWNER (e.g., customer paid before send)
    { seq: 15, status: 'CANCELLED', letterType: 'CONTRACT_TERMINATION_60D', contractIdx: 3, cancelReason: 'ลูกค้าชำระเต็มจำนวนก่อนส่ง', daysAgo: 5 },
  ];

  // Make sure contractIdx*letterType combos don't collide with @@unique([contractId, letterType])
  // Quick dedup by composite key
  const seenCombos = new Set<string>();
  const validPlans = plans.filter((p) => {
    const key = `${p.contractIdx}-${p.letterType}`;
    if (seenCombos.has(key)) return false;
    seenCombos.add(key);
    return true;
  });

  if (validPlans.length !== plans.length) {
    console.warn(`⚠️  Skipped ${plans.length - validPlans.length} plans due to (contract,type) unique constraint`);
  }

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  let created = 0;
  let updated = 0;
  for (const plan of validPlans) {
    const contract = contracts[plan.contractIdx];
    if (!contract) continue;

    const letterNumber = `${LETTER_NUMBER_PREFIX}-${String(plan.seq).padStart(5, '0')}`;
    const triggeredAt = daysAgo(plan.daysAgo ?? 0);
    const pdfGeneratedAt = plan.status === 'PENDING_DISPATCH' ? null : triggeredAt;
    const dispatchedAt = ['DISPATCHED', 'UNDELIVERABLE', 'DELIVERED'].includes(plan.status)
      ? daysAgo(Math.max(0, (plan.daysAgo ?? 0) - 1))
      : null;
    const cancelledAt = plan.status === 'CANCELLED' ? daysAgo(Math.max(0, (plan.daysAgo ?? 0) - 1)) : null;

    const existing = await prisma.contractLetter.findUnique({
      where: { letterNumber },
    });

    const data = {
      contractId: contract.id,
      letterType: plan.letterType,
      letterNumber,
      status: plan.status,
      triggeredAt,
      pdfUrl: null,
      pdfGeneratedAt,
      dispatchedAt,
      dispatchedById: dispatchedAt ? dispatcher.id : null,
      trackingNumber: plan.trackingNumber ?? null,
      evidencePhotoUrl: null,
      deliveredAt: null,
      cancelledAt,
      cancelReason: plan.cancelReason ?? null,
    };

    if (existing) {
      await prisma.contractLetter.update({
        where: { letterNumber },
        data,
      });
      updated++;
    } else {
      try {
        await prisma.contractLetter.create({ data });
        created++;
      } catch (err: any) {
        // Skip if the (contractId, letterType) unique constraint is hit
        // (existing real letter on this contract — leave it alone)
        if (err.code === 'P2002') {
          console.warn(
            `  Skipped #${letterNumber}: contract ${contract.contractNumber} already has a ${plan.letterType} letter`,
          );
        } else {
          throw err;
        }
      }
    }
  }

  console.log(`\n✅ Done: ${created} created, ${updated} updated`);
  console.log(`\nNext: open http://localhost:5173/letters (login as OWNER)`);
  console.log(`To wipe mock data only: DELETE FROM contract_letters WHERE letter_number LIKE '${LETTER_NUMBER_PREFIX}-%';`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
