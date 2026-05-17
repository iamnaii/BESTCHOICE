import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class StatusTransitionService {
  /**
   * Validate that a document can be posted from its current status.
   * Allowed source: DRAFT only.
   * Optional totalAmount guard: prevents posting a placeholder-instantiated doc
   * where unitPrice=0.01 was never edited by the user.
   */
  assertCanPost(input: {
    type: DocumentType;
    from: DocumentStatus;
    hasPaymentMethod: boolean;
    totalAmount?: number | string | Decimal;
  }): void {
    // D1.2.1.6 — when approval_enabled is true, docs may also reach post()
    // already in APPROVED (manual post after approve, or the auto-post chain).
    // DRAFT remains valid for the legacy / approval-disabled path.
    if (input.from !== 'DRAFT' && input.from !== 'APPROVED') {
      throw new BadRequestException(
        `ไม่สามารถ post จากสถานะ ${input.from} ได้ (ต้องเป็น DRAFT หรือ APPROVED)`,
      );
    }
    if (input.totalAmount !== undefined) {
      const t =
        input.totalAmount instanceof Decimal
          ? input.totalAmount
          : new Decimal(
              typeof input.totalAmount === 'number'
                ? input.totalAmount.toString()
                : input.totalAmount,
            );
      if (t.lte(new Decimal('0.01'))) {
        throw new BadRequestException(
          'ยอดรวมต้องมากกว่า 0.01 บาท — กรุณาแก้ไขจำนวนเงินก่อน Post',
        );
      }
    }
  }

  /**
   * Determine the target status after posting given doc characteristics.
   * - EXPENSE: POSTED if paid same day; ACCRUAL otherwise
   * - CREDIT_NOTE / PAYROLL / VENDOR_SETTLEMENT: always POSTED
   */
  resolveTargetStatus(type: DocumentType, hasPaymentMethod: boolean): DocumentStatus {
    if (type === 'EXPENSE' && !hasPaymentMethod) return 'ACCRUAL';
    return 'POSTED';
  }

  /** Void allowed from any non-VOIDED state. */
  assertCanVoid(input: { from: DocumentStatus }): void {
    if (input.from === 'VOIDED') {
      throw new BadRequestException('เอกสารถูกยกเลิกอยู่แล้ว');
    }
  }

  /** Edit allowed only from DRAFT. */
  assertCanEdit(input: { from: DocumentStatus }): void {
    if (input.from !== 'DRAFT') {
      throw new BadRequestException(`ไม่สามารถแก้ไขเอกสารในสถานะ ${input.from} ได้ (DRAFT เท่านั้น)`);
    }
  }

  /**
   * D1.2.1.6 — approve allowed only from PENDING_APPROVAL.
   * Used when SystemConfig `approval_enabled` is true. The DRAFT →
   * PENDING_APPROVAL gate is added by D1.2.1.1.
   */
  assertCanApprove(input: { from: DocumentStatus }): void {
    if (input.from !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `ไม่สามารถอนุมัติเอกสารในสถานะ ${input.from} ได้ (PENDING_APPROVAL เท่านั้น)`,
      );
    }
  }
}
