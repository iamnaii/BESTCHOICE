import { BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  clearFinanceRoomVerification,
  FinanceLineLockSetUnstableError,
  LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE,
  lockCustomersForFinanceLineBind,
  lockFinanceLineCustomers,
  staffLineFinanceChange,
  unlinkFinanceLine,
} from './finance-line-link';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

/**
 * Task 22 I3 — พนักงาน/API ล้าง LINE การเงินได้ (ยกเลิกผูก) แต่ตั้งค่าใหม่ไม่ได้ · การล้างปิดแถว customer_line_links ด้วย
 * (ผูก LINE ใหม่ด้วย OTP ได้ — I4) · การผูกจริงบน Postgres ปักไว้ที่ verification-link.db.spec.ts
 */
describe('staffLineFinanceChange', () => {
  it.each([
    ['ไม่ส่ง', undefined, 'U1'],
    ['ส่งค่าเดิม (ฟอร์มแก้ไขส่งทุกช่องกลับมา)', 'U1', 'U1'],
    ['ส่งค่าเดิมมีช่องว่างรอบ', ' U1 ', 'U1'],
  ])('%s → none', (_label, requested, current) => {
    expect(staffLineFinanceChange(requested, current)).toBe('none');
  });

  // Task 29 #2 (เจ้าของตัดสิน 31 ต.ค.) — ล้างช่อง = ปุ่ม "ยกเลิกการผูก": ไม่ดูคอลัมน์ (คอลัมน์ว่างแต่มีแถว OTP ต้องปิดแถวได้) ·
  // ผู้เรียกตัดสินจากแถว OTP + คอลัมน์ใต้ล็อก (ไม่มีอะไรให้ล้าง = ไม่แตะ)
  it.each([
    ['ว่างทั้งคู่ (null)', null, null],
    ['ส่งค่าว่าง ลูกค้าไม่มีค่า', '', null],
    ['ส่ง null ลูกค้ามีค่าว่าง', null, ''],
  ])(
    '%s → clear (คอลัมน์ว่างไม่ใช่เหตุให้ข้าม — แถว OTP อาจยังผูก)',
    (_label, requested, current) => {
      expect(staffLineFinanceChange(requested, current)).toBe('clear');
    },
  );

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
    $queryRaw: jest.Mock;
    customer: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    customerLineLink: { updateMany: jest.Mock; findMany: jest.Mock };
    chatRoom: { updateMany: jest.Mock };
  };
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerLineLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatRoom: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('ตาม LINE (LIFF): ล้างคอลัมน์บนทุกลูกค้าที่ถือ LINE นี้ (รวมแถวที่ถูกลบ — กู้แล้วค่าไม่กลับ) + ปิดแถว FINANCE ของ LINE นี้', async () => {
    await unlinkFinanceLine(tx as never, { lineUserId: 'U1' }, at);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { lineIdFinance: 'U1' },
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

  // Task 24 M-8 — ห้อง LINE การเงินที่ verified ค้างหลังยกเลิกผูก ⇒ แม่แบบ verifiedOnly ยังส่งได้
  it('ตาม LINE (LIFF): ล้าง verified_at ของห้องการเงินของ LINE นี้ + ของลูกค้าที่ถือแถวของ LINE นี้ (ในทรานแซกชันเดียวกัน)', async () => {
    tx.customerLineLink.findMany.mockResolvedValue([{ customerId: 'c1' }]);
    await unlinkFinanceLine(tx as never, { lineUserId: 'U1' }, at);
    expect(tx.customerLineLink.findMany).toHaveBeenCalledWith({
      where: { lineUserId: 'U1', channel: 'FINANCE', unlinkedAt: null },
      select: { customerId: true },
    });
    expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({
      where: {
        channel: 'LINE_FINANCE',
        verifiedAt: { not: null },
        OR: [{ lineUserId: { in: ['U1'] } }, { customerId: { in: ['c1'] } }],
      },
      data: { verifiedAt: null },
    });
  });

  it('ตามลูกค้า (พนักงาน): ล้าง verified_at ของห้องการเงินของ LINE ในแถวที่ปิด + ห้องการเงินของลูกค้าคนนี้', async () => {
    tx.customerLineLink.findMany.mockResolvedValue([{ lineUserId: 'U9' }]);
    await unlinkFinanceLine(tx as never, { customerId: 'c1' }, at);
    expect(tx.customerLineLink.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', channel: 'FINANCE', unlinkedAt: null },
      select: { lineUserId: true },
    });
    expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({
      where: {
        channel: 'LINE_FINANCE',
        verifiedAt: { not: null },
        OR: [{ lineUserId: { in: ['U9'] } }, { customerId: { in: ['c1'] } }],
      },
      data: { verifiedAt: null },
    });
  });
});

/** ids ที่ส่งเข้า `SELECT … FOR NO KEY UPDATE` (tagged template — อาร์กิวเมนต์ที่สองคือ Prisma.join) */
const lockedIds = (call: unknown[]) => [...(call[1] as { values: string[] }).values].sort();

describe('ลำดับล็อก ลูกค้า → link → ห้อง (Task 29)', () => {
  const at = new Date('2026-11-01T03:00:00Z');
  const makeTx = () => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerLineLink: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatRoom: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  });
  const before = (a: jest.Mock, b: jest.Mock) =>
    expect(a.mock.invocationCallOrder[0]).toBeLessThan(b.mock.invocationCallOrder[0]);

  it('lockFinanceLineCustomers: คำสั่งเดียวเรียง id · ตัดค่าว่าง/ซ้ำ · ไม่มีอะไร = ไม่ยิง', async () => {
    const tx = makeTx();
    await lockFinanceLineCustomers(tx as never, [null, '', undefined]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    await lockFinanceLineCustomers(tx as never, ['c2', 'c1', 'c2', null]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect((tx.$queryRaw.mock.calls[0][0] as string[]).join('?')).toContain(
      'ORDER BY id FOR NO KEY UPDATE',
    );
    expect(lockedIds(tx.$queryRaw.mock.calls[0])).toEqual(['c1', 'c2']);
  });

  it('ตาม LINE (LIFF): ล็อกผู้ถือแถว link + ผู้ถือคอลัมน์ทุกคนก่อนล้างคอลัมน์/ปิดแถว/ล้างห้อง', async () => {
    const tx = makeTx();
    tx.customerLineLink.findMany.mockResolvedValue([{ customerId: 'c1' }]);
    tx.customer.findMany.mockResolvedValue([{ id: 'c9' }, { id: 'c1' }]);
    await unlinkFinanceLine(tx as never, { lineUserId: 'U1' }, at);
    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: { lineIdFinance: 'U1' },
      select: { id: true },
    });
    expect(lockedIds(tx.$queryRaw.mock.calls[0])).toEqual(['c1', 'c9']);
    before(tx.$queryRaw, tx.customer.updateMany);
    before(tx.$queryRaw, tx.customerLineLink.updateMany);
    before(tx.$queryRaw, tx.chatRoom.updateMany);
  });

  it('ตามลูกค้า (พนักงาน): คำสั่งเขียนแรก = แถวลูกค้า (ล้างคอลัมน์) ก่อนแตะแถว link/ห้อง', async () => {
    const tx = makeTx();
    await unlinkFinanceLine(tx as never, { customerId: 'c1' }, at);
    before(tx.customer.update, tx.customerLineLink.updateMany);
    before(tx.customer.update, tx.chatRoom.updateMany);
  });
});

describe('lockCustomersForFinanceLineBind — ชุดลูกค้าไม่นิ่ง (Task 29 fix round 1 · review M-2)', () => {
  it('อ่านซ้ำใต้ล็อกแล้วชุดยังโตครบ 5 รอบ → Sentry warning (ไม่มี U-id/ข้อมูลลูกค้า) + error ที่ bind ลองทั้งก้อนใหม่ได้ (ไม่ไปต่อแบบล็อกไม่ครบ)', async () => {
    let round = 0;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
      // ทุกรอบมีผู้ถือคอลัมน์คนใหม่ (bind ของ LINE เดียวกันอีกตัว commit คั่นทุกครั้ง — สถานการณ์จำลอง)
      customer: { findMany: jest.fn(async () => [{ id: `c-new-${++round}` }]) },
    };

    const err = await lockCustomersForFinanceLineBind(tx as never, 'U-secret', 'c1').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(FinanceLineLockSetUnstableError);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(context).toMatchObject({ level: 'warning', tags: { subsystem: 'finance-line-lock' } });
    expect(JSON.stringify([message, context])).not.toMatch(/U-secret|c1|c-new/);
  });

  it('ชุดนิ่งในรอบที่สอง → ล็อกครั้งเดียว ไม่เตือน', async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customerLineLink: { findUnique: jest.fn().mockResolvedValue({ customerId: 'h1' }) },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 'h1' }]) },
    };
    await expect(lockCustomersForFinanceLineBind(tx as never, 'U1', 'c1')).resolves.toEqual({
      lineHolderId: 'h1',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('clearFinanceRoomVerification', () => {
  it('ไม่มี LINE/ลูกค้าที่หลุด → ไม่แตะห้อง · ค่าซ้ำ/ว่างถูกตัด', async () => {
    const tx = { chatRoom: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    await clearFinanceRoomVerification(tx as never, { lineUserIds: [''], customerIds: [] });
    expect(tx.chatRoom.updateMany).not.toHaveBeenCalled();
    await clearFinanceRoomVerification(tx as never, { lineUserIds: ['U1', 'U1'] });
    expect(tx.chatRoom.updateMany).toHaveBeenCalledWith({
      where: {
        channel: 'LINE_FINANCE',
        verifiedAt: { not: null },
        OR: [{ lineUserId: { in: ['U1'] } }],
      },
      data: { verifiedAt: null },
    });
  });
});
