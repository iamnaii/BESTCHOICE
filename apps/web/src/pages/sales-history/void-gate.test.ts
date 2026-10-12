import { describe, expect, it } from 'vitest';
import { voidGate } from './void-gate';

const base = {
  saleType: 'CASH',
  deletedAt: null as string | null,
  exchangeCase: null as { caseNumber: string } | null,
};

describe('voidGate — ปุ่มยกเลิกใบขายบนหน้าประวัติการขาย', () => {
  it('ขายสดปกติ → ปุ่ม', () => expect(voidGate(base)).toEqual({ kind: 'button' }));
  it('ยกเลิกแล้ว → ไม่มีอะไร', () =>
    expect(voidGate({ ...base, deletedAt: '2026-10-01T00:00:00Z' })).toEqual({ kind: 'none' }));
  it('ใบผ่อน → ข้อความ "ยกเลิกผ่านสัญญา"', () =>
    expect(voidGate({ ...base, saleType: 'INSTALLMENT' })).toMatchObject({
      kind: 'text',
      text: 'ยกเลิกผ่านสัญญา',
    }));
  it('PR 5 — เปลี่ยนเครื่องแล้ว → ข้อความ "เปลี่ยนเครื่องแล้ว · AS-…" ไม่มีปุ่ม', () =>
    expect(voidGate({ ...base, exchangeCase: { caseNumber: 'AS-20261012-0001' } })).toEqual({
      kind: 'text',
      text: 'เปลี่ยนเครื่องแล้ว · AS-20261012-0001',
      title: 'ใบขายที่เปลี่ยนรุ่นเดิมแล้วยกเลิกไม่ได้ — ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น',
    }));
});
