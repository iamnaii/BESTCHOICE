import { describe, it, expect } from 'vitest';
import {
  creditCheckStatusMap,
  customerCreditStatusMap,
  getStatusBadgeProps,
} from '../status-badges';

/**
 * แทน `customer-credit-filter.test.ts` ที่ถูกลบไปพร้อมกับไลบรารี prefix `customer:`/`check:`
 * (สองแท็บของหน้า /customers กรองคนละฟิลด์แล้ว ไม่มี <Select> ที่ผสมสอง enum อีก)
 *
 * หน้าที่ที่ยังต้องมีคนถือไว้: **คีย์ของแผนที่ป้ายต้องเป็นสมาชิกของ enum ที่มันอ้าง**
 * เพราะค่าเดียวกันนี้ถูกส่งเป็น query param `creditCheckStatus` — ส่งค่าของ enum ผิดตัว
 * เข้าไป Prisma โยน validation error = HTTP 500 (ไม่ใช่ 400)
 */

// สำเนาของ enum ฝั่ง Prisma (apps/api/prisma/schema.prisma)
const CUSTOMER_CREDIT_CHECK_STATUS = [
  'NONE',
  'PRE_CHECK_PASSED',
  'FULL_CHECK_PASSED',
  'REJECTED',
  'UNDER_REVIEW',
] as const;
const CREDIT_CHECK_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'] as const;

describe('customerCreditStatusMap', () => {
  it('ทุกคีย์เป็นสมาชิกของ CustomerCreditCheckStatus', () => {
    for (const key of Object.keys(customerCreditStatusMap)) {
      expect(CUSTOMER_CREDIT_CHECK_STATUS).toContain(key);
    }
  });

  it('ครอบทุกค่าของ enum — ไม่มีค่าไหนตกไปเป็นป้าย raw', () => {
    for (const value of CUSTOMER_CREDIT_CHECK_STATUS) {
      expect(customerCreditStatusMap[value]).toBeDefined();
      expect(getStatusBadgeProps(value, customerCreditStatusMap).label).not.toBe(value);
    }
  });

  it('ยังเป็นคนละแผนที่กับ creditCheckStatusMap — REJECTED อยู่ทั้งสอง enum คนละความหมาย', () => {
    const customerOnly = Object.keys(customerCreditStatusMap).filter(
      (k) => !(CREDIT_CHECK_STATUS as readonly string[]).includes(k),
    );
    expect(customerOnly.length).toBeGreaterThan(0);
    expect(customerCreditStatusMap.REJECTED).toBeDefined();
    expect(creditCheckStatusMap.REJECTED).toBeDefined();
    // ใบตรวจมี MANUAL_REVIEW / PENDING ที่ตัวลูกค้าไม่มี — ยุบรวมกันแล้วจะยิง enum ผิด
    expect(customerCreditStatusMap.MANUAL_REVIEW).toBeUndefined();
    expect(customerCreditStatusMap.PENDING).toBeUndefined();
  });
});
