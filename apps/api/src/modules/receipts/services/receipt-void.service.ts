import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { ReceiptNumberService } from './receipt-number.service';

/**
 * Receipt void: the regulated money-path ($tx #2). Posts a reversal JE for each
 * matched POSTED receipt JE, creates a credit note, marks the original voided,
 * and writes the RECEIPT_VOID forensic audit — all atomically.
 */
export class ReceiptVoidService {
  constructor(
    private prisma: PrismaService,
    private receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
    private numbers: ReceiptNumberService,
  ) {}

  /**
   * Resolve the FINANCE companyId for the period-lock guard. Receipts are a
   * FINANCE-side artifact (their void posts a FINANCE reversal JE). Returns
   * undefined when FINANCE is not configured so a void never crashes on
   * misconfig — FINANCE is always configured in production.
   */
  private async resolveFinanceCompanyId(): Promise<string | undefined> {
    const finance = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    return finance?.id;
  }

  /**
   * Void a receipt (ถ้าผิด → ออกใบลดหนี้/ใบแก้ไขแทน)
   * ใบเสร็จที่ออกแล้วห้ามแก้ไข/ลบ
   *
   * Wave 3 T2 (ปพพ.386 W-3): จำกัดสิทธิ์ — เฉพาะ OWNER / ACCOUNTANT /
   * BRANCH_MANAGER เท่านั้นที่ void ได้. SALES void ไม่ได้เพื่อป้องกัน
   * fraud โดยพนักงานหน้าร้าน. บันทึก audit log RECEIPT_VOID เพิ่มเติม
   * นอกเหนือจาก voidApprovedById บน receipt row เพื่อ forensic trail.
   */
  async voidReceipt(
    id: string,
    reason: string,
    issuedById: string,
    approvedById: string,
    userRole?: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }

    // Wave 3 T2: Role check — controller passes userRole; if absent we
    // still defend in service layer (defensive — prevents future caller misuse).
    const ALLOWED_VOID_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];
    if (userRole !== undefined && !ALLOWED_VOID_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        'ไม่มีสิทธิ์ยกเลิกใบเสร็จ · ต้องเป็นเจ้าของ / ฝ่ายบัญชี / ผจก.สาขา / ผจก.การเงิน',
      );
    }

    // Segregation of duties: the user requesting the void cannot be the same
    // user approving it. Mirrors bad-debt write-off pattern (writtenOffById !==
    // approvedById). Prevents the controller fallback `dto.approvedById ?? user.id`
    // from auto-approving on behalf of the requester.
    if (issuedById === approvedById) {
      throw new ForbiddenException(
        'การยกเลิกใบเสร็จต้องมีผู้ขออนุมัติและผู้อนุมัติเป็นคนละคน',
      );
    }

    // CR-7: Validate void date is not in a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, new Date(), await this.resolveFinanceCompanyId());
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id } });
      if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
      if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

      // W-006: Credit Note 30-day time limit
      const daysSinceIssue = Math.floor(
        (Date.now() - receipt.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceIssue > 30) {
        throw new BadRequestException('ไม่สามารถยกเลิกใบเสร็จที่ออกเกิน 30 วัน');
      }

      // Generate credit note number inside transaction (uses FOR UPDATE lock)
      const creditNoteNumber = await this.numbers.generateReceiptNumber(tx);
      const creditNote = await tx.receipt.create({
        data: {
          receiptNumber: creditNoteNumber,
          contractId: receipt.contractId,
          paymentId: receipt.paymentId,
          receiptType: 'CREDIT_NOTE',
          payerName: receipt.payerName,
          receiverName: receipt.receiverName,
          amount: receipt.amount,
          installmentNo: receipt.installmentNo,
          paymentMethod: receipt.paymentMethod,
          paidDate: new Date(),
          voidedReceiptId: receipt.id,
          issuedById,
        },
      });

      // Mark original as voided with approval trail
      await tx.receipt.update({
        where: { id },
        data: {
          isVoided: true,
          voidReason: reason.trim(),
          voidApprovedById: approvedById,
          voidApprovedAt: new Date(),
        },
      });

      // Phase A.5a: reverse the payment's receipt JE(s).
      // Must propagate errors — a receipt void without FULL ledger reversal would
      // leave HP receivable cleared by the receipt JE(s) but no offsetting credit
      // note JE.
      //
      // PR-843/I2 Phase 3 PR 3.1 — reverse ALL receipt JEs of the payment, not just
      // one. The epic posts MULTIPLE receipt JEs per Payment (a partial then a
      // completion); each JE now carries a fresh unique `reference`, so the old
      // `referenceId == paymentId` lookup found at most ONE and left the other
      // receipt's Cr 11-2103 un-reversed = ledger defect. The canonical payment→JE
      // link is `metadata.paymentId`, which every receipt path stamps (the primitive,
      // the legacy 2B full/2B-split-final templates, and applyCreditBalance's
      // credit-allocation JE). findMany + reverse EACH is backward-compatible: a
      // single-receipt payment returns one JE → one reversal (same as before).
      if (receipt.paymentId) {
        // FINAL-REVIEW BLOCKER 2 — restrict the reversal to TRUE receivable-clearing
        // receipt JEs. autoAllocate's overpayment JE shares the same metadata.paymentId
        // but carries tag:'overpayment-credit' (Dr cash / Cr 21-5101 customer credit);
        // reversing it on a receipt void would phantom-Dr 21-5101/Cr cash and leave the
        // creditBalance un-restored. The tag filter excludes it (and any
        // paysolutions-surplus-advance, which has no paymentId). The advance-consume 2B
        // JE also has no paymentId so it is already not matched.
        const originalEntries = await tx.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['paymentId'], equals: receipt.paymentId } } as any,
              {
                OR: [
                  { metadata: { path: ['tag'], equals: 'receipt' } } as any,
                  { metadata: { path: ['tag'], equals: '2B' } } as any,
                  // legacy credit-funded clears (applyCreditBalance credit-allocation JE)
                  { metadata: { path: ['tag'], equals: 'credit-allocation' } } as any,
                ],
              },
              { status: 'POSTED' },
              { deletedAt: null },
            ],
          },
        });
        for (const originalEntry of originalEntries) {
          await this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx);
        }
        // Zero found (legacy no-JE payment) → graceful skip (unchanged behaviour).
      }

      // Wave 3 T2 (ปพพ.386 W-3): forensic audit log for receipt voids.
      // voidApprovedById on receipt is operational; this is the immutable
      // tamper-evident trail (Merkle-chained, 7-yr retention).
      await tx.auditLog.create({
        data: {
          userId: issuedById,
          action: 'RECEIPT_VOID',
          entity: 'receipt',
          entityId: receipt.id,
          oldValue: {
            receiptNumber: receipt.receiptNumber,
            amount: Number(receipt.amount),
            payerName: receipt.payerName,
            paymentMethod: receipt.paymentMethod,
            installmentNo: receipt.installmentNo,
            paidDate: receipt.paidDate.toISOString(),
          },
          newValue: {
            reason: reason.trim(),
            voidedAt: new Date().toISOString(),
            approvedById,
            creditNoteId: creditNote.id,
            creditNoteNumber: creditNote.receiptNumber,
            userRole: userRole ?? null,
          },
        },
      });

      return { voidedReceipt: receipt, creditNote };
    });
  }
}
