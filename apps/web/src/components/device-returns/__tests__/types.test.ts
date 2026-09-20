import { describe, it, expect } from 'vitest';
import {
  canCancelDeviceReturn,
  computeDeviationPct,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_STATUS_LABEL,
  formatDeviationLabel,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  RETURN_REASON_OPTIONS,
} from '../types';

describe('device-returns/types — label maps', () => {
  it('ครบทุกสถานะใบ / ประเภท / เหตุผล / สถานะไลน์ (ป้ายไทยตาม spec §7)', () => {
    expect(DEVICE_RETURN_STATUS_LABEL).toEqual({
      PENDING_CONFIRM: 'รอ FINANCE ยืนยัน',
      CONFIRMED: 'ยืนยันแล้ว',
      REJECTED: 'ส่งกลับ',
      CANCELED: 'ยกเลิก',
    });
    expect(DEVICE_RETURN_KIND_LABEL).toEqual({
      VOLUNTARY: 'ลูกค้าคืนเอง',
      REPOSSESSION: 'ยึดเครื่อง',
    });
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'UNAFFORDABLE',
      'NO_LONGER_NEEDED',
      'AFTER_TERMINATION',
      'OTHER',
    ]);
    expect(RETURN_REASON_LABEL.AFTER_TERMINATION).toBe('รับเครื่องคืนหลังบอกเลิกสัญญา');
    expect(LINE_STATUS_LABEL).toEqual({
      SENT: 'ส่งไลน์แล้ว',
      FAILED: 'ส่งไลน์ไม่สำเร็จ',
      NO_LINE: 'ไม่มีไลน์ผูก',
    });
  });
});

describe('computeDeviationPct / formatDeviationLabel — ตรรกะ ±15% เดียวกับ overlay เดิม', () => {
  it('คิดเป็น % เทียบตาราง; null เมื่อไม่มีตาราง/ตาราง 0/ราคาประเมิน 0', () => {
    expect(computeDeviationPct(7000, 6500)).toBeCloseTo(7.69, 2);
    expect(computeDeviationPct(5000, 6500)).toBeCloseTo(-23.08, 2);
    expect(computeDeviationPct(7000, null)).toBeNull();
    expect(computeDeviationPct(7000, 0)).toBeNull();
    expect(computeDeviationPct(0, 6500)).toBeNull();
    expect(computeDeviationPct(Number.NaN, 6500)).toBeNull();
  });

  it('ป้าย: ปัดเป็นจำนวนเต็ม มีเครื่องหมาย + เมื่อบวก, ว่างเมื่อ null', () => {
    expect(formatDeviationLabel(7.69)).toBe('+8%');
    expect(formatDeviationLabel(-23.08)).toBe('-23%');
    expect(formatDeviationLabel(null)).toBe('');
  });
});

describe('canCancelDeviceReturn — OWNER ทุกใบ, BM เฉพาะสาขาที่รับ, อื่น ๆ ไม่ได้', () => {
  const row = { receivingBranch: { id: 'b1', name: 'ลาดพร้าว' } };
  it.each([
    [{ role: 'OWNER', branchId: null }, true],
    [{ role: 'BRANCH_MANAGER', branchId: 'b1' }, true],
    [{ role: 'BRANCH_MANAGER', branchId: 'b2' }, false],
    [{ role: 'BRANCH_MANAGER', branchId: null }, false],
    [{ role: 'FINANCE_MANAGER', branchId: null }, false],
    [{ role: 'SALES', branchId: 'b1' }, false],
  ])('%o → %s', (user, expected) => {
    expect(canCancelDeviceReturn(user, row)).toBe(expected);
  });
  it('user null → false', () => {
    expect(canCancelDeviceReturn(null, row)).toBe(false);
  });
});
