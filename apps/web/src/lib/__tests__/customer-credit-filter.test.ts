import { describe, it, expect } from 'vitest';
import {
  applyCreditFilter,
  CREDIT_CHECK_OPTIONS,
  CUSTOMER_CREDIT_OPTIONS,
} from '../customer-credit-filter';

// สำเนาของ enum ฝั่ง Prisma (apps/api/prisma/schema.prisma) — ถ้าฝั่ง schema เพิ่ม/ลบค่า
// เทสต์นี้จะไม่รู้เอง แต่มันทำหน้าที่หลักได้: กันไม่ให้ตัวเลือกบนหน้าจอหลุดไปอยู่ผิด enum
// เหมือนที่เคยเกิด (APPROVED/PENDING/MANUAL_REVIEW ถูกส่งเข้า Customer.creditCheckStatus)
const CUSTOMER_CREDIT_CHECK_STATUS = [
  'NONE',
  'PRE_CHECK_PASSED',
  'FULL_CHECK_PASSED',
  'REJECTED',
  'UNDER_REVIEW',
];
const CREDIT_CHECK_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];

describe('applyCreditFilter', () => {
  it('ส่งสถานะของลูกค้าเข้า param creditCheckStatus', () => {
    const params: Record<string, string> = {};
    applyCreditFilter(params, 'customer:PRE_CHECK_PASSED');
    expect(params).toEqual({ creditCheckStatus: 'PRE_CHECK_PASSED' });
  });

  it('ส่งสถานะของใบตรวจเข้า param creditStatus (คนละฟิลด์)', () => {
    const params: Record<string, string> = {};
    applyCreditFilter(params, 'check:APPROVED');
    expect(params).toEqual({ creditStatus: 'APPROVED' });
  });

  it('REJECTED มีอยู่ทั้งสอง enum — ต้องไปตาม prefix ไม่ใช่เดาจากค่า', () => {
    const a: Record<string, string> = {};
    const b: Record<string, string> = {};
    applyCreditFilter(a, 'customer:REJECTED');
    applyCreditFilter(b, 'check:REJECTED');
    expect(a).toEqual({ creditCheckStatus: 'REJECTED' });
    expect(b).toEqual({ creditStatus: 'REJECTED' });
  });

  it('ค่าว่าง / ไม่มี prefix → ไม่กรองอะไรเลย (ห้ามยิง enum ผิดจนได้ 500)', () => {
    for (const bad of ['', 'APPROVED', 'ALL', 'weird:']) {
      const params: Record<string, string> = {};
      applyCreditFilter(params, bad);
      expect(params).toEqual({});
    }
  });

  it('ทุกตัวเลือกบนหน้าจอต้องเป็นสมาชิกของ enum ที่มันถูกส่งไป', () => {
    for (const o of CUSTOMER_CREDIT_OPTIONS) {
      const params: Record<string, string> = {};
      applyCreditFilter(params, o.value);
      expect(params.creditStatus).toBeUndefined();
      expect(CUSTOMER_CREDIT_CHECK_STATUS).toContain(params.creditCheckStatus);
    }
    for (const o of CREDIT_CHECK_OPTIONS) {
      const params: Record<string, string> = {};
      applyCreditFilter(params, o.value);
      expect(params.creditCheckStatus).toBeUndefined();
      expect(CREDIT_CHECK_STATUS).toContain(params.creditStatus);
    }
  });

  it('ค่าของทุกตัวเลือกต้องไม่ซ้ำกัน (Select ใช้ value เป็น key)', () => {
    const all = [...CUSTOMER_CREDIT_OPTIONS, ...CREDIT_CHECK_OPTIONS].map((o) => o.value);
    expect(new Set(all).size).toBe(all.length);
  });
});
