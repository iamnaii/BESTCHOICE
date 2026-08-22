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

/**
 * Phase 5 Task 3 — ปิดทางแก้มือเฉพาะ REFURBISHED → IN_STOCK
 *
 * ตัดสินใจใช้ deny-list ราย transition แทนการโยน REFURBISHED เข้า
 * SYSTEM_MANAGED_STATUSES: REFURBISHED **ถูกตั้ง** โดย flow ระบบ (ยึดเครื่อง /
 * เปลี่ยนเครื่อง) แต่ไม่มี flow ไหน **ปลด** มันเลย ⇒ ถ้าเหมารวมจะตัดเส้นทางแก้มือที่
 * ไม่มีของทดแทน (เช่น REFURBISHED → DAMAGED ตอนตรวจแล้วเจอเสียเพิ่ม,
 * DAMAGED → REFURBISHED หลังซ่อม) แล้วเครื่องจะค้างสถานะถาวร
 */
describe('assertManualStatusChangeAllowed — REFURBISHED → IN_STOCK ต้องผ่านปุ่ม (Phase 5 T3)', () => {
  it('REFURBISHED → IN_STOCK แก้มือไม่ได้ — ข้อความบอกให้ใช้ปุ่มนำเข้าคลังพร้อมขาย', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'IN_STOCK'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'IN_STOCK'),
    ).toThrow(/นำเข้าคลังพร้อมขาย/);
  });

  it('transition อื่นของ REFURBISHED ยังแก้มือได้ (ไม่เหมารวมทั้งสถานะ)', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'DAMAGED'),
    ).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'WRITTEN_OFF'),
    ).not.toThrow();
  });

  it('เข้าสู่ REFURBISHED ด้วยมือยังทำได้ (เช่น DAMAGED → REFURBISHED หลังซ่อม)', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.DAMAGED, 'REFURBISHED'),
    ).not.toThrow();
  });

  it('ส่งค่าเดิม REFURBISHED → REFURBISHED ยังผ่าน (ไม่ใช่การเปลี่ยนสถานะ)', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'REFURBISHED'),
    ).not.toThrow();
  });
});
