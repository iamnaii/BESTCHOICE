import { BadRequestException } from '@nestjs/common';
import {
  LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE,
  staffLineFinanceChange,
  unlinkFinanceLine,
} from './finance-line-link';

/**
 * Task 22 I3 — พนักงาน/API ล้าง LINE การเงินได้ (ยกเลิกผูก) แต่ตั้งค่าใหม่ไม่ได้ · การล้างปิดแถว customer_line_links ด้วย
 * (ผูก LINE ใหม่ด้วย OTP ได้ — I4) · การผูกจริงบน Postgres ปักไว้ที่ verification-link.db.spec.ts
 */
describe('staffLineFinanceChange', () => {
  it.each([
    ['ไม่ส่ง', undefined, 'U1'],
    ['ส่งค่าเดิม (ฟอร์มแก้ไขส่งทุกช่องกลับมา)', 'U1', 'U1'],
    ['ส่งค่าเดิมมีช่องว่างรอบ', ' U1 ', 'U1'],
    ['ว่างทั้งคู่ (null)', null, null],
    ['ส่งค่าว่าง ลูกค้าไม่มีค่า', '', null],
    ['ส่ง null ลูกค้ามีค่าว่าง', null, ''],
  ])('%s → none', (_label, requested, current) => {
    expect(staffLineFinanceChange(requested, current)).toBe('none');
  });

  it.each([
    ['ส่งค่าว่าง', ''],
    ['ส่ง null', null],
    ['ส่งช่องว่างล้วน', '   '],
  ])('%s ขณะที่ลูกค้ามี LINE การเงิน → clear (ยกเลิกผูก)', (_label, requested) => {
    expect(staffLineFinanceChange(requested, 'U1')).toBe('clear');
  });

  it.each([
    ['ตั้งให้ลูกค้าที่ยังไม่มี', 'U-attacker', null],
    ['เปลี่ยนเป็น LINE อื่น', 'U-attacker', 'U1'],
  ])('%s → 400 ข้อความไทยชี้ทาง OTP (field lineIdFinance)', (_label, requested, current) => {
    let err: unknown;
    try {
      staffLineFinanceChange(requested, current);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      message: LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE,
      field: 'lineIdFinance',
    });
  });
});

describe('unlinkFinanceLine', () => {
  const at = new Date('2026-11-01T03:00:00Z');
  let tx: {
    customer: { update: jest.Mock; updateMany: jest.Mock };
    customerLineLink: { updateMany: jest.Mock };
  };
  beforeEach(() => {
    tx = {
      customer: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerLineLink: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('ตาม LINE (LIFF): ล้างคอลัมน์บนทุกลูกค้าที่ถือ LINE นี้ + ปิดแถว FINANCE ของ LINE นี้', async () => {
    await unlinkFinanceLine(tx as never, { lineUserId: 'U1' }, at);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { lineIdFinance: 'U1', deletedAt: null },
      data: { lineIdFinance: null },
    });
    expect(tx.customerLineLink.updateMany).toHaveBeenCalledWith({
      where: { lineUserId: 'U1', channel: 'FINANCE', unlinkedAt: null },
      data: { unlinkedAt: at },
    });
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('ตามลูกค้า (พนักงาน): ล้างคอลัมน์ของลูกค้าคนนี้ + ปิดแถว FINANCE ของลูกค้าคนนี้เท่านั้น (ไม่ปิดตาม LINE)', async () => {
    await unlinkFinanceLine(tx as never, { customerId: 'c1' }, at);
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { lineIdFinance: null },
    });
    expect(tx.customerLineLink.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', channel: 'FINANCE', unlinkedAt: null },
      data: { unlinkedAt: at },
    });
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });
});
