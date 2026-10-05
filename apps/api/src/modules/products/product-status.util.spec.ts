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

  it('workflow → workflow แก้มือได้ (เช่น IN_STOCK → INSPECTION, QC_PENDING → IN_STOCK, DAMAGED → REFURBISHED ซ่อมเสร็จ)', () => {
    expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, 'INSPECTION')).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.QC_PENDING, 'IN_STOCK'),
    ).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.DAMAGED, 'REFURBISHED'),
    ).not.toThrow();
  });

  // ก้อน 3 (2026-10-05) — เสียหาย/สูญหาย/ตัดจำหน่าย ต้องผ่านคำขอให้เจ้าของอนุมัติ (เมนู คลังสินค้า › ตัดสินค้า)
  it('ตัดสินค้าต้องผ่านคำขอ — ตั้งปลายทาง DAMAGED/LOST/WRITTEN_OFF/ADJUSTMENT_PENDING ด้วยมือไม่ได้', () => {
    for (const to of ['DAMAGED', 'LOST', 'WRITTEN_OFF', 'ADJUSTMENT_PENDING']) {
      expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, to)).toThrow(/ตัดสินค้า/);
      expect(() => assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, to)).toThrow(/ตัดสินค้า/);
    }
  });

  it('เครื่องที่รออนุมัติตัดสินค้า แก้สถานะมือไม่ได้ (ต้องยกเลิกคำขอ/ให้เจ้าของพิจารณา)', () => {
    expect(() => assertManualStatusChangeAllowed(ProductStatus.ADJUSTMENT_PENDING, 'IN_STOCK')).toThrow(/คำขอตัดสินค้า/);
    expect(() => assertManualStatusChangeAllowed(ProductStatus.ADJUSTMENT_PENDING, 'ADJUSTMENT_PENDING')).not.toThrow();
  });

  it('QC_PENDING เลิกใช้แล้ว — ตั้งเป็นปลายทางไม่ได้ แต่แถวเก่ายังย้ายออกได้', () => {
    expect(() => assertManualStatusChangeAllowed(ProductStatus.IN_STOCK, 'QC_PENDING')).toThrow(
      /QC_PENDING เลิกใช้แล้ว/,
    );
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.QC_PENDING, 'PHOTO_PENDING'),
    ).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.QC_PENDING, 'QC_PENDING'),
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

  it('transition อื่นของ REFURBISHED ยังแก้มือได้ (ไม่เหมารวมทั้งสถานะ) — ยกเว้นปลายทางตัดสินค้า (ก้อน 3)', () => {
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'INSPECTION'),
    ).not.toThrow();
    expect(() =>
      assertManualStatusChangeAllowed(ProductStatus.REFURBISHED, 'PHOTO_PENDING'),
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
