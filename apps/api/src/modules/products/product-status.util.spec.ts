import { BadRequestException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import {
  assertManualStatusChangeAllowed,
  SYSTEM_MANAGED_STATUSES,
} from './product-status.util';

describe('assertManualStatusChangeAllowed', () => {
  it('ค่าเดิม (ไม่เปลี่ยน) ผ่านเสมอ แม้เป็นสถานะระบบจัดการ', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.SOLD_INSTALLMENT, 'SOLD_INSTALLMENT'),
    ).not.toThrow();
    expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, 'IN_STOCK')).not.toThrow();
  });

  it('workflow → workflow แก้มือได้ (เช่น IN_STOCK → DAMAGED, QC_PENDING → IN_STOCK)', () => {
    expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, 'DAMAGED')).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.QC_PENDING, 'IN_STOCK'),
    ).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.DAMAGED, 'WRITTEN_OFF'),
    ).not.toThrow();
  });

  it('ออกจากสถานะระบบจัดการ (ขาย/จอง/ยึด) ด้วยมือ → block', () => {
    for (const from of SYSTEM_MANAGED_STATUSES) {
      expect(() => assertManualStatusChangeAllowed(from, 'IN_STOCK')).toThrow(BadRequestException);
    }
  });

  it('เข้าสถานะระบบจัดการด้วยมือ → block', () => {
    for (const to of SYSTEM_MANAGED_STATUSES) {
      expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, to)).toThrow(
        BadRequestException,
      );
    }
  });

  it('สถานะที่ไม่มีจริง → block', () => {
    expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, 'NOT_A_STATUS')).toThrow(
      BadRequestException,
    );
  });
});
