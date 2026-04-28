/**
 * Backfill Receipt rows for Payments that have amountPaid > 0 but no Receipt linked.
 *
 * Why: a SQL bug in generateReceiptNumber (querying "Receipt" instead of receipts)
 * caused every receipt creation since the @@map rename to silently fail. As a
 * result, contracts with paid installments have no e-Receipts in the system.
 * This script creates them retroactively.
 *
 * Behavior:
 *  - Receipt amount = payment.amountPaid (cumulative — best approximation since
 *    we lost the per-event delta history).
 *  - Receipt date = payment.paidDate if PAID, else payment.updatedAt
 *  - Receipt number sequence is generated per (year, month) of the receipt date
 *    using the FIXED snake_case query. Numbers will interleave with future
 *    receipts but stay unique.
 *  - Skips payments that already have a Receipt linked (paymentId match) OR
 *    whose contract is soft-deleted.
 *
 * Run locally:   npx tsx apps/api/scripts/backfill-receipts.ts
 * Run on prod:   via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function generateReceiptNumber(date: Date, tx: Prisma.TransactionClient): Promise<string> {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const prefix = `RC-${year}-${month}-`;

  const result = await tx.$queryRaw<Array<{ receiptNumber: string }>>`
    SELECT receipt_number AS "receiptNumber" FROM receipts
    WHERE receipt_number LIKE ${prefix + '%'}
    ORDER BY receipt_number DESC
    LIMIT 1
    FOR UPDATE
  `;

  let seq = 1;
  if (result.length > 0) {
    seq = parseInt(result[0].receiptNumber.replace(prefix, '')) + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

async function main() {
  // 1. Find payments with money paid; cross-reference to find ones missing a receipt.
  const allPaid = await prisma.payment.findMany({
    where: {
      amountPaid: { gt: 0 },
      deletedAt: null,
      contract: { deletedAt: null },
    },
    include: {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          financedAmount: true,
          totalMonths: true,
          customer: { select: { name: true } },
          payments: {
            where: { status: 'PAID', deletedAt: null },
            select: { amountPaid: true },
          },
        },
      },
    },
    orderBy: [{ contractId: 'asc' }, { installmentNo: 'asc' }],
  });

  const existingReceiptPaymentIds = await prisma.receipt.findMany({
    where: { deletedAt: null, isVoided: false, paymentId: { not: null } },
    select: { paymentId: true },
  });
  const haveReceipt = new Set(existingReceiptPaymentIds.map((r) => r.paymentId));

  const payments = allPaid.filter((p) => !haveReceipt.has(p.id));

  console.log(`Found ${payments.length} payments with no receipt — backfilling...`);
  if (payments.length === 0) return;

  // 2. Resolve a fallback issuer (system user) — use first OWNER if payment.recordedById is null.
  const systemOwner = await prisma.user.findFirst({
    where: { role: 'OWNER', deletedAt: null },
    select: { id: true },
  });
  if (!systemOwner) throw new Error('No OWNER user found to use as receipt issuer.');

  // 3. Resolve current company for receiverName.
  const company = await prisma.companyInfo.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { nameTh: true },
  });
  const receiverName = company?.nameTh || 'บริษัท เบสท์ช้อยส์โฟน จำกัด';

  let created = 0;
  let failed = 0;

  for (const p of payments) {
    const receiptDate = p.paidDate ?? p.updatedAt;
    const issuedById = p.recordedById ?? systemOwner.id;
    const totalPaid = p.contract.payments.reduce((s, x) => s + Number(x.amountPaid), 0);
    const remainingBalance = Math.max(0, Number(p.contract.financedAmount) - totalPaid);
    const remainingMonths = Math.max(0, p.contract.totalMonths - p.contract.payments.length);

    try {
      await prisma.$transaction(async (tx) => {
        const receiptNumber = await generateReceiptNumber(receiptDate, tx);
        const receiptContent = JSON.stringify({
          receiptNumber,
          contractId: p.contractId,
          amount: Number(p.amountPaid),
          installmentNo: p.installmentNo,
          paidDate: receiptDate.toISOString(),
        });
        const fileHash = crypto.createHash('sha256').update(receiptContent).digest('hex');

        await tx.receipt.create({
          data: {
            receiptNumber,
            contractId: p.contractId,
            paymentId: p.id,
            receiptType: 'INSTALLMENT',
            payerName: p.contract.customer?.name || '',
            receiverName,
            amount: p.amountPaid,
            installmentNo: p.installmentNo,
            remainingBalance,
            remainingMonths,
            paymentMethod: p.paymentMethod,
            paidDate: receiptDate,
            fileHash,
            issuedById,
            createdAt: receiptDate,
            updatedAt: receiptDate,
          },
        });
      });
      created++;
      if (created % 50 === 0) console.log(`  ${created}/${payments.length} created`);
    } catch (err) {
      failed++;
      console.error(`  FAILED payment ${p.id} (contract ${p.contract.contractNumber} งวด ${p.installmentNo}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. ${created} receipts created, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
