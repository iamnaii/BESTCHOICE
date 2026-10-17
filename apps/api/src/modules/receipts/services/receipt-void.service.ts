import {
  consumePaymentApproval,
  type PaymentApprovalContext,
} from '../../payments/services/payment-approval-request.util';
import { NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma, type Receipt } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { emitDeferredWarnings, type DeferredWarning } from '../../journal/deferred-warning';
import { ReceiptNumberService } from './receipt-number.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';
import { voidReceiptInTx, storedTaxColumnsOf, type CreditNoteMoney } from './receipt-void-core';

// ค่าคงที่ย้ายไป receipt-void-core.ts (15ข) — re-export ให้ผู้ import เดิม (orchestrator · reschedule-collect · specs)
export { JE_ADVANCE_SPLIT_META, RESCHEDULE_ADVANCE_UNPARKED } from './receipt-void-core';
import type { ReceiptQueryService } from './receipt-query.service';
import {
  documentMoneyColumns,
  hasStoredReceiptTax,
  legacyReceiptDocumentMoney,
} from './receipt-document-money';




/**
 * Receipt void: the regulated money-path ($tx #2). Posts a reversal JE for each
 * matched POSTED receipt JE, creates a credit note, marks the original voided,
 * un-pays the installment (Payment revert + sibling receipts + denormalized
 * contract balances + loyalty points), and writes the RECEIPT_VOID forensic
 * audit — all atomically.
 *
 * Un-pay semantics (2026-07-08, owner decision): ยกเลิกใบเสร็จ = ยกเลิกการชำระ
 * ของงวดนั้นทั้งงวด. The ledger reversal below is already per-payment (PR 3.1
 * reverses EVERY receipt JE sharing metadata.paymentId — JEs are keyed by
 * paymentId, not receiptId), so the Payment row and sibling receipts must
 * follow or the installment never returns to the pending queue. Mirrors
 * RefundsService.markReversed. Supersedes the 2026-06-07 refund-reversal
 * design note that kept voided payments PAID.
 */
export class ReceiptVoidService {
  private readonly logger = new Logger(ReceiptVoidService.name);

  constructor(
    private prisma: PrismaService,
    private receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
    private numbers: ReceiptNumberService,
    /**
     * PR3: อ่านใบเก่า (ไม่มีค่าที่เก็บ) ในรูปเดียวกับที่ PDF ใช้ เพื่อให้ใบลดหนี้เก็บตัวเลขที่ใบเดิมพิมพ์.
     * ไม่ส่ง (spec เดิม) = ใบลดหนี้ของใบเก่าคงรูปเดิม (ยอดอย่างเดียว)
     */
    private query?: Pick<ReceiptQueryService, 'getReceipt'>,
  ) {}

  /**
   * ใบลดหนี้คัดลอกทุกบรรทัดของใบที่ยกเลิก (ม.86/10 · คำถาม Q5 — PR3). ใบที่ออกก่อน PR3 ไม่มีค่าที่เก็บ →
   * คำนวณตัวเลขที่ใบเดิมพิมพ์ด้วยตรรกะเดิมของ PDF ตัวเดียวกัน ก่อนเปิดธุรกรรมของการยกเลิก (อ่านผ่าน client หลัก —
   * ห้ามอ่านใน tx). ใบที่ตรรกะเดิมพิมพ์ไม่ได้ (ประวัติไม่พอ) หรืออ่านไม่ได้ → ใบลดหนี้ของใบนั้นคงรูปเดิม
   * (ยอดอย่างเดียว) — การยกเลิกห้ามล้มเพราะเอกสาร
   */
  private async legacyCreditNoteMoney(id: string): Promise<Map<string, CreditNoteMoney>> {
    const out = new Map<string, CreditNoteMoney>();
    if (!this.query) return out;
    try {
      const target = await this.prisma.receipt.findUnique({ where: { id } });
      if (!target) return out;
      const rows = target.paymentId
        ? await this.prisma.receipt.findMany({
            where: {
              paymentId: target.paymentId,
              isVoided: false,
              deletedAt: null,
              receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
            },
          })
        : [target];
      for (const row of rows) {
        if (hasStoredReceiptTax(row)) continue;
        try {
          const view = await this.query.getReceipt(row.id);
          out.set(row.id, documentMoneyColumns(legacyReceiptDocumentMoney(view)));
        } catch (err) {
          // ตรรกะเดิมพิมพ์ใบนี้ไม่ได้ / อ่านใบนี้ไม่ได้ — ใบลดหนี้ของใบนี้คงรูปเดิม
          this.reportCreditNoteFallback(err, row.receiptNumber);
        }
      }
    } catch (err) {
      // อ่านไม่ได้ — ใบลดหนี้ทุกใบคงรูปเดิม
      this.reportCreditNotePreReadFailure(err, id);
    }
    return out;
  }

  /**
   * ใบลดหนี้ของใบเก่าใบหนึ่งถอยไปเป็นยอดอย่างเดียว — ห้ามเงียบ (final review I2): log เตือนพร้อมเลขที่ใบเสมอ ·
   * ข้อความ "ตรรกะเดิมพิมพ์ใบนี้ไม่ได้" ของ legacyReceiptDocumentMoney เป็น BadRequestException = คาดไว้ (log อย่างเดียว) ·
   * อย่างอื่น (อ่านใบไม่ได้ / ฐานข้อมูล) ส่ง Sentry ด้วย. ใช้ captureException เท่านั้น (เทสของ PR2ข นับ captureMessage
   * ของการยกเลิก) · ไม่ throw ไม่ว่ากรณีใด — การยกเลิกห้ามล้มเพราะเอกสาร
   */
  private reportCreditNoteFallback(err: unknown, receiptNumber: string): void {
    try {
      this.logger.warn(
        `[ReceiptVoid] ${receiptNumber}: credit note falls back to amount only — legacy document money unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!(err instanceof BadRequestException)) {
        Sentry.captureException(err, {
          level: 'warning',
          tags: { subsystem: 'receipt-void-credit-note' },
          extra: { receiptNumber },
        });
      }
    } catch {
      // การแจ้งเตือนห้ามทำให้การยกเลิกล้ม
    }
  }

  /** อ่านใบเป้าหมาย/ใบพี่น้องก่อนยกเลิกไม่ได้ทั้งชุด — ใบลดหนี้ของใบเก่าทุกใบเป็นยอดอย่างเดียว (final review I2) */
  private reportCreditNotePreReadFailure(err: unknown, receiptId: string): void {
    try {
      this.logger.error(
        `[ReceiptVoid] receipt ${receiptId}: legacy credit-note pre-read failed — every unstored credit note of this void falls back to amount only: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, {
        level: 'error',
        tags: { subsystem: 'receipt-void-credit-note' },
      });
    } catch {
      // การแจ้งเตือนห้ามทำให้การยกเลิกล้ม
    }
  }

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
    approvalContext?: PaymentApprovalContext,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }

    if (!approvalContext) {
      throw new ForbiddenException('กรุณาส่งคำขอยกเลิกใบเสร็จผ่านหน้ารออนุมัติ');
    }
    // The queue's authenticated actor approves; a nominated name has no authority.
    approvedById = approvalContext.actorId;

    // CR-7: Validate void date is not in a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, new Date(), await this.resolveFinanceCompanyId());
    /** สัญญาณเตือนของการกลับรายการตั้งลูกหนี้งวด — ส่งหลังธุรกรรม commit เท่านั้น */
    let accrualWarnings: readonly DeferredWarning[] = [];
    const legacyMoney = await this.legacyCreditNoteMoney(id);
    /** ตัวเลขของใบลดหนี้ = ทุกบรรทัดของใบที่ถูกยกเลิก (ใบใหม่: ค่าที่เก็บ · ใบเก่า: ที่ใบเดิมพิมพ์) */
    const creditNoteMoney = (row: Receipt): Partial<CreditNoteMoney> =>
      hasStoredReceiptTax(row) ? storedTaxColumnsOf(row) : (legacyMoney.get(row.id) ?? {});
    const voided = await this.prisma.$transaction(
      async (tx) => {
        const receipt = await tx.receipt.findUnique({ where: { id } });
        if (!receipt || receipt.deletedAt) throw new NotFoundException('ไม่พบใบเสร็จ');
        const approval = await consumePaymentApproval(tx, approvalContext, 'VOID_RECEIPT', id);
        if (approval.requestedById !== issuedById)
          throw new ForbiddenException('ผู้ขออนุมัติไม่ตรงกับผู้ทำรายการ');
        if (receipt.isVoided) throw new BadRequestException('ใบเสร็จนี้ถูกยกเลิกแล้ว');

        const out = await voidReceiptInTx(
          tx,
          { reversal: this.receiptVoidReversalTemplate, numbers: this.numbers },
          { receipt, reason, issuedById, approvedById, userRole, creditNoteMoney },
        );
        accrualWarnings = out.warnings;
        return { voidedReceipt: out.voidedReceipt, creditNote: out.creditNote, paymentReverted: out.paymentReverted };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    emitDeferredWarnings(accrualWarnings);
    return voided;
  }
}
