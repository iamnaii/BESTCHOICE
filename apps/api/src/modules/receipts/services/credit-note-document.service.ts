import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptNumberService } from './receipt-number.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { computeCnBreakdown } from '../../journal/compute-cn-breakdown';

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
  | { outcome: 'SKIPPED_NO_ACCRUED' | 'SKIPPED_DUPLICATE' };

/** Public PDF link (LINE) lifetime for an auto-issued CN. */
const PUBLIC_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Phase 3 CN — auto-issues the ใบลดหนี้ (Credit Note) document that follows a
 * REPOSSESSION (JP5) or WRITE_OFF write-off JE (ม.82/5 — VAT on accrued-but-
 * unpaid installments reversed at contract termination).
 *
 * Caller contract: `issueForContract` MUST be invoked from inside the SAME
 * `$transaction` that just posted the source JE (the repossession / write-off
 * template) — the `journalEntry.findUnique` lookup below relies on
 * read-your-own-write visibility within that transaction.
 *
 * CPA pro-rate ruling (2026-07-26,
 * docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md): a partially-paid
 * accrued installment's CN VAT is pro-rated to its outstanding balance via
 * `computeCnBreakdown` — the SAME util the JE templates (RepossessionJP5Template,
 * BadDebtWriteOffTemplate) use to stamp `metadata.creditNoteVatAmount`, so the
 * JE and this document can never drift apart. Every case — clean or partial —
 * now auto-issues a receipt; this SUPERSEDES the 2026-07-24 dirty-gate
 * (HELD_PARTIAL_PAID + Todo `credit-note-review`). See
 * `.claude/rules/accounting.md` "เอกสารใบลดหนี้" for the historical note on
 * pre-existing HELD Todos from before this ruling.
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

    // (2) Pro-rated CN breakdown — single source of truth shared with the JE
    // templates. "Accrued-unpaid" definition lives inside computeCnBreakdown
    // (accrued = has an accrual JE; unpaid = no PAID payment row).
    const cnBreakdown = await computeCnBreakdown(tx, contract);
    if (cnBreakdown.count === 0) {
      return { outcome: 'SKIPPED_NO_ACCRUED' };
    }

    // (3) Resolve the JE that was just posted in this same tx, cross-check its
    // stamped CN VAT against our own recompute (drift guard), then issue the CN.
    const je = await tx.journalEntry.findUnique({
      where: { entryNumber: sourceJournalEntryNo },
      select: { id: true, metadata: true },
    });
    if (!je) {
      throw new Error(`[CN] ไม่พบ Journal Entry เลขที่ ${sourceJournalEntryNo}`);
    }

    const jeMetadata = je.metadata as Record<string, unknown> | null;
    const jeCnVat = jeMetadata?.['creditNoteVatAmount'];
    if (jeCnVat !== cnBreakdown.totalCnVat.toFixed(2)) {
      throw new Error(
        `[CN] ยอด VAT ใบลดหนี้ (${cnBreakdown.totalCnVat.toFixed(2)}) ไม่ตรงกับ Journal Entry ${sourceJournalEntryNo} (${String(jeCnVat)}) — หยุดเพื่อป้องกันข้อมูลคลาดเคลื่อน`,
      );
    }

    const amount = cnBreakdown.totalOutstanding;
    const vatAmount = cnBreakdown.totalCnVat;
    const amountBeforeVat = cnBreakdown.totalBeforeVat;

    // Flag installments that were pro-rated (outstanding < full installment
    // amount) so the printed CN is self-explanatory about the reduced amount.
    const { installmentExclVat, vatPerInst } = computeInstallmentBreakdown({
      financedAmount: contract.financedAmount.toString(),
      storeCommission:
        contract.storeCommission != null ? contract.storeCommission.toString() : null,
      interestTotal: contract.interestTotal.toString(),
      vatAmount: contract.vatAmount != null ? contract.vatAmount.toString() : null,
      totalMonths: contract.totalMonths,
    });
    const installmentTotal = installmentExclVat.plus(vatPerInst);
    const hasProRatedRow = cnBreakdown.rows.some((r) => r.outstanding.lt(installmentTotal));

    let itemDescription = `ใบลดหนี้ยกเลิกงวดค้าง ${cnBreakdown.count} งวด — เลิกสัญญา (ม.82/5)`;
    if (hasProRatedRow) {
      itemDescription += ' (ลดตามสัดส่วนยอดค้างจริง)';
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
        itemDescription,
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
