/* eslint-disable @typescript-eslint/no-explicit-any -- mock clients ที่บันทึกลำดับคำสั่ง */
import { BadRequestException } from '@nestjs/common';
import { CustomerWriteService } from './customer-write.service';
import { LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE } from '../../line-oa/services/finance-line-link';

/**
 * Task 22 I3/I4 — ฟอร์มลูกค้า (POST/PATCH /customers) ตั้ง `lineIdFinance` เป็นค่าใหม่ไม่ได้ (การผูกต้องผ่าน OTP ทาง SMS)
 * แต่ล้างได้ = ยกเลิกผูก: ล้างคอลัมน์ + ปิดแถว customer_line_links (FINANCE) ของลูกค้าคนนี้ในทรานแซกชันเดียวกับการแก้ไข
 * ⇒ ลูกค้าที่เปลี่ยนเครื่อง/บัญชี LINE ยืนยัน OTP ด้วย LINE ใหม่ได้ (ไม่ติด 409) · ส่งค่าเดิมกลับมา = ไม่แตะ
 */
describe('CustomerWriteService — LINE การเงินจากฟอร์มพนักงาน', () => {
  const calls: string[] = [];
  let root: Record<string, any>;
  let tx: Record<string, any>;
  let service: CustomerWriteService;
  let query: { findOne: jest.Mock };
  let prevSalt: string | undefined;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    process.env.PII_HASH_SALT = 'line-finance-write-spec-salt-0123456789';
  });
  afterAll(() => {
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = prevSalt;
  });

  function client(label: string) {
    const log = (name: string, value: unknown = null) =>
      jest.fn(async (...args: unknown[]) => {
        calls.push(`${label}.${name}`);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown)(...args)
          : value;
      });
    return {
      $executeRaw: log('lock', 1),
      $queryRaw: log('lockCustomer', []), // Task 29 — lockFinanceLineCustomers (แถวลูกค้าก่อนแถว link/ห้อง)
      customer: {
        findFirst: log('findFirst'),
        // แกนยกเลิกผูก (unlinkFinanceLineInTx) อ่านสถานะลูกค้าใต้ล็อก — select lineIdFinance
        findUnique: log('findUnique', (a: any) =>
          a?.select?.lineIdFinance ? { deletedAt: null, lineIdFinance: 'U-verified' } : null,
        ),
        count: log('count', 0),
        create: log('create', (a: any) => ({ id: 'new', ...a.data })),
        update: log('update', (a: any) => ({ id: a.where.id, name: 'x', ...a.data })),
      },
      customerLineLink: {
        findFirst: log('activeLink', { linkedAt: new Date('2026-10-01T00:00:00.000Z') }),
        findMany: log('linkRows', [{ lineUserId: 'U-old' }]),
        updateMany: log('closeLink', { count: 1 }),
      },
      chatRoom: { updateMany: log('unverifyRooms', { count: 1 }) },
    };
  }

  beforeEach(() => {
    calls.length = 0;
    tx = client('tx');
    root = {
      ...client('root'),
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
        calls.push('root.$transaction');
        return cb(tx);
      }),
    };
    query = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'c1', phone: '0899999999', lineIdFinance: 'U-verified' }),
    };
    const contactResolver = {
      findOrCreateByNaturalKey: jest.fn(async () => ({ id: 'contact-1' })),
    };
    service = new CustomerWriteService(root as never, contactResolver as never, query as never);
  });

  const rejectOtp = async (p: Promise<unknown>) => {
    const err: any = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual({
      message: LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE,
      field: 'lineIdFinance',
    });
  };

  it('create: ส่ง U-id มา → 400 ชี้ทาง OTP และไม่เขียนอะไร', async () => {
    await rejectOtp(
      service.create({ name: 'ใหม่', phone: '0812345678', lineIdFinance: 'U-typed' } as never),
    );
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('create: ช่องว่าง → สร้างได้ และไม่เขียนคอลัมน์ lineIdFinance', async () => {
    await service.create({ name: 'ใหม่', phone: '0812345678', lineIdFinance: '' } as never);
    const data = tx.customer.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('lineIdFinance');
  });

  it('update: ส่งค่าเดิมกลับมา (ฟอร์มแก้ไขส่งทุกช่อง) → แก้ช่องอื่นได้ ไม่แตะ LINE การเงิน ไม่ปิดแถว link', async () => {
    await service.update('c1', { name: 'ชื่อใหม่', lineIdFinance: 'U-verified' } as never);
    const data = root.customer.update.mock.calls[0][0].data;
    expect(data.name).toBe('ชื่อใหม่');
    expect(data).not.toHaveProperty('lineIdFinance');
    expect(root.customerLineLink.updateMany).not.toHaveBeenCalled();
    expect(tx.customerLineLink.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['เปลี่ยนเป็น LINE อื่น', 'U-verified', 'U-attacker'],
    ['ตั้งให้ลูกค้าที่ยังไม่ผูก', null, 'U-attacker'],
  ])('update: %s → 400 ชี้ทาง OTP และไม่เขียนอะไร', async (_label, current, requested) => {
    query.findOne.mockResolvedValue({ id: 'c1', phone: '0899999999', lineIdFinance: current });
    await rejectOtp(service.update('c1', { name: 'x', lineIdFinance: requested } as never));
    expect(root.customer.update).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it.each([
    ['null (ฟอร์มหน้าสัญญาส่ง null เมื่อช่องว่าง)', null],
    ['ค่าว่าง', ''],
  ])(
    'update: ล้างช่อง (%s) → ยกเลิกผูกในทรานแซกชันเดียวกับการแก้ไข: ล้างคอลัมน์ + ปิดแถว FINANCE ของลูกค้าคนนี้',
    async (_label, requested) => {
      const updated = await service.update('c1', { name: 'x', lineIdFinance: requested } as never);
      expect(calls).toEqual([
        'root.$transaction',
        // Task 29 #2 — แกนเดียวกับปุ่ม "ยกเลิกการผูก" (unlinkFinanceLineInTx)
        'tx.lockCustomer', // ล็อกแถวลูกค้าก่อน (ลำดับเดียวกับ bind — Task 29 #1)
        'tx.findUnique', // สถานะลูกค้าใต้ล็อก (ถูกลบ = 404 · คอลัมน์มีค่าไหม)
        'tx.activeLink', // แถว OTP ที่ยังผูก — ตัดสินจากแถว ไม่ใช่คอลัมน์อย่างเดียว
        'tx.linkRows', // LINE ของแถวที่กำลังปิด (Task 24 M-8)
        'tx.update', // unlinkFinanceLine — ล้างคอลัมน์ของลูกค้าคนนี้
        'tx.closeLink', // ปิดแถว customer_line_links ของลูกค้าคนนี้
        'tx.unverifyRooms', // ล้าง verified_at ของห้อง LINE การเงิน (Task 24 M-8 — แม่แบบ verifiedOnly หยุดส่ง)
        'tx.update', // การแก้ไขของฟอร์ม (ไม่มี lineIdFinance — ไม่ทับค่าที่เพิ่งล้าง)
      ]);
      expect(tx.customer.update.mock.calls[0][0]).toEqual({
        where: { id: 'c1' },
        data: { lineIdFinance: null },
      });
      expect(tx.customerLineLink.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'c1', channel: 'FINANCE', unlinkedAt: null },
        data: { unlinkedAt: expect.any(Date) },
      });
      expect(tx.customer.update.mock.calls[1][0].data).not.toHaveProperty('lineIdFinance');
      expect(root.customer.update).not.toHaveBeenCalled();
      expect(updated).toMatchObject({ id: 'c1' });
    },
  );

  it('update: เปลี่ยนเบอร์ + ล้าง LINE → ล็อกเบอร์ยังเป็นคำสั่งแรกของทรานแซกชันเดียวกัน', async () => {
    await service.update('c1', { phone: '0812345678', lineIdFinance: null } as never);
    expect(calls.slice(0, 2)).toEqual(['root.$transaction', 'tx.lock']);
    expect(calls).toContain('tx.closeLink');
    expect(root.$transaction).toHaveBeenCalledTimes(1);
  });
});
