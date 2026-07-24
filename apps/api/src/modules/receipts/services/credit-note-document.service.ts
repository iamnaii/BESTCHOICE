import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptNumberService } from './receipt-number.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';

export type CreditNoteSource = 'REPOSSESSION' | 'WRITE_OFF';

export interface IssueCreditNoteInput {
  contractId: string;
  source: CreditNoteSource;
  /** เลข JE จาก template result (templates คืน { entryNo } — ไม่มี UUID) */
  sourceJournalEntryNo: string;
  actorUserId: string;
}

export type IssueCreditNoteResult =
  | { outcome: 'ISSUED'; receiptId: string; receiptNumber: string }
  | { outcome: 'HELD_PARTIAL_PAID'; todoId: string }
  | { outcome: 'SKIPPED_NO_ACCRUED' | 'SKIPPED_DUPLICATE' };

/** Public PDF link (LINE) lifetime for an auto-issued CN. */
const PUBLIC_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Phase 3 CN — issues (or gates) the automatic ใบลดหนี้ (Credit Note) document
 * that follows a REPOSSESSION (JP5) or WRITE_OFF write-off JE (ม.82/5 — VAT on
 * accrued-but-unpaid installments reversed at contract termination).
 *
 * Caller contract: `issueForContract` MUST be invoked from inside the SAME
 * `$transaction` that just posted the source JE (the repossession / write-off
 * template) — the `journalEntry.findUnique` lookup below relies on
 * read-your-own-write visibility within that transaction.
 *
 * Owner's dirty-gate (2026-07-24): if any accrued-unpaid installment carries a
 * PARTIALLY_PAID payment, we do NOT issue a receipt/number — a CPA must review
 * the ม.82/5 credit-note treatment for a part-paid installment first. We park
 * a Todo instead and return HELD_PARTIAL_PAID; a human re-runs this once the
 * review is done (or the partial resolves).
 */
@Injectable()
export class CreditNoteDocumentService {
  private readonly logger = new Logger(CreditNoteDocumentService.name);
  private readonly numbers: ReceiptNumberService;

  constructor(private prisma: PrismaService) {
    this.numbers = new ReceiptNumberService(this.prisma);
  }

  async issueForContract(
    input: IssueCreditNoteInput,
    tx: Prisma.TransactionClient,
  ): Promise<IssueCreditNoteResult> {
    const { contractId, source, sourceJournalEntryNo, actorUserId } = input;

    // (1) Duplicate check — one CN receipt per (contract, source). Mirrors the
    // partial unique index added in Task 1: (contract_id, cn_source) WHERE
    // cn_source IS NOT NULL AND deleted_at IS NULL.
    const existing = await tx.receipt.findFirst({
      where: { contractId, cnSource: source, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return { outcome: 'SKIPPED_DUPLICATE' };
    }

    const contract = await tx.contract.findUnique({
      where: { id: contractId, deletedAt: null },
      include: { customer: { select: { name: true } } },
    });
    if (!contract) {
      throw new Error(`[CN] ไม่พบสัญญา ${contractId}`);
    }

    // (2) Accrued-unpaid definition — IDENTICAL to
    // bad-debt-writeoff.template.ts:139-152 (accrued = has an accrual JE;
    // unpaid = no PAID payment row for that installmentNo). We additionally
    // keep each installment's payment status (not just presence in a "paid"
    // set) so we can detect the PARTIALLY_PAID dirty-gate below in the same
    // pass — Payment has a (contractId, installmentNo) unique constraint so
    // this map is a 1:1 equivalent of the template's `paidNos` Set.
    const allInsts = await tx.installmentSchedule.findMany({
      where: { contractId, deletedAt: null },
      select: { installmentNo: true, accrualJournalEntryId: true },
    });
    const payments = await tx.payment.findMany({
      where: { contractId },
      select: { installmentNo: true, status: true },
    });
    const paymentStatusByInst = new Map(payments.map((p) => [p.installmentNo, p.status]));
    const accruedUnpaid = allInsts.filter(
      (i) =>
        i.accrualJournalEntryId !== null && paymentStatusByInst.get(i.installmentNo) !== 'PAID',
    );

    if (accruedUnpaid.length === 0) {
      return { outcome: 'SKIPPED_NO_ACCRUED' };
    }

    // (3) Owner's dirty-gate (2026-07-24): any accrued-unpaid installment
    // mid-way through a partial payment → hold for CPA review instead of
    // auto-issuing a CN/number.
    const hasPartiallyPaid = accruedUnpaid.some(
      (i) => paymentStatusByInst.get(i.installmentNo) === 'PARTIALLY_PAID',
    );
    if (hasPartiallyPaid) {
      const systemUser = await tx.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      if (!systemUser) {
        throw new Error(
          'ไม่พบผู้ใช้ระบบ (SYSTEM user, isSystemUser=true) — ต้องรัน seed collections-foundation ก่อน',
        );
      }

      const todo = await tx.todo.create({
        data: {
          title: `ตรวจใบลดหนี้ ${contract.contractNumber} — มีงวดจ่ายบางส่วน รอ CPA (ม.82/5)`,
          priority: 'HIGH',
          tags: ['credit-note-review'],
          createdById: systemUser.id,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'CN_HELD_PARTIAL_PAID',
          entity: 'contract',
          entityId: contractId,
          newValue: {
            source,
            sourceJournalEntryNo,
            todoId: todo.id,
            accruedUnpaidCount: accruedUnpaid.length,
          },
        },
      });

      return { outcome: 'HELD_PARTIAL_PAID', todoId: todo.id };
    }

    // (4) Clean path — resolve the JE that was just posted in this same tx,
    // cross-check its stamped CN VAT against our own recompute (drift guard),
    // then issue the CN.
    const je = await tx.journalEntry.findUnique({
      where: { entryNumber: sourceJournalEntryNo },
      select: { id: true, metadata: true },
    });
    if (!je) {
      throw new Error(`[CN] ไม่พบ Journal Entry เลขที่ ${sourceJournalEntryNo}`);
    }

    const breakdown = computeInstallmentBreakdown({
      financedAmount: contract.financedAmount.toString(),
      storeCommission:
        contract.storeCommission != null ? contract.storeCommission.toString() : null,
      interestTotal: contract.interestTotal.toString(),
      vatAmount: contract.vatAmount != null ? contract.vatAmount.toString() : null,
      totalMonths: contract.totalMonths,
    });

    const count = new Decimal(accruedUnpaid.length);
    const vatAmount = breakdown.vatPerInst.times(count);
    const amountBeforeVat = breakdown.installmentExclVat.times(count);
    const amount = amountBeforeVat.plus(vatAmount);

    const jeMetadata = je.metadata as Record<string, unknown> | null;
    const jeCnVat = jeMetadata?.['creditNoteVatAmount'];
    if (jeCnVat !== vatAmount.toFixed(2)) {
      throw new Error(
        `[CN] ยอด VAT ใบลดหนี้ (${vatAmount.toFixed(2)}) ไม่ตรงกับ Journal Entry ${sourceJournalEntryNo} (${String(jeCnVat)}) — หยุดเพื่อป้องกันข้อมูลคลาดเคลื่อน`,
      );
    }

    const receiptNumber = await this.numbers.generateReceiptNumber(tx);
    const publicToken = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const publicTokenExpiresAt = new Date(now.getTime() + PUBLIC_TOKEN_TTL_MS);

    const receipt = await tx.receipt.create({
      data: {
        receiptNumber,
        contractId,
        receiptType: 'CREDIT_NOTE',
        payerName: contract.customer?.name ?? '',
        receiverName: 'BESTCHOICE FINANCE',
        amount,
        amountBeforeVat,
        vatAmount,
        itemDescription: `ใบลดหนี้ยกเลิกงวดค้าง ${accruedUnpaid.length} งวด — เลิกสัญญา (ม.82/5)`,
        paidDate: now,
        issuedById: actorUserId,
        cnSource: source,
        sourceJournalEntryId: je.id,
        publicToken,
        publicTokenExpiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'CN_ISSUED',
        entity: 'receipt',
        entityId: receipt.id,
        newValue: {
          contractId,
          source,
          sourceJournalEntryNo,
          amount: amount.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          amountBeforeVat: amountBeforeVat.toFixed(2),
        },
      },
    });

    this.logger.log(
      `[CN] ISSUED ${receipt.receiptNumber} — contract=${contractId} source=${source} amount=${amount.toFixed(2)}`,
    );

    return { outcome: 'ISSUED', receiptId: receipt.id, receiptNumber: receipt.receiptNumber };
  }
}
