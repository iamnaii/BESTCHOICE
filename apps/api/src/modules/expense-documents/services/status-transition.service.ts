import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';

@Injectable()
export class StatusTransitionService {
  /**
   * Validate that a document can be posted from its current status.
   * Allowed source: DRAFT only.
   */
  assertCanPost(input: {
    type: DocumentType;
    from: DocumentStatus;
    hasPaymentMethod: boolean;
  }): void {
    if (input.from !== 'DRAFT') {
      throw new BadRequestException(`ไม่สามารถ post จากสถานะ ${input.from} ได้ (ต้องเป็น DRAFT)`);
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
}
