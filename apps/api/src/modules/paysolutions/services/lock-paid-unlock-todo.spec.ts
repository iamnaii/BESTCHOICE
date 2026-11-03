import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import {
  LOCK_PAID_UNLOCK_TODO_TAG,
  createLockPaidUnlockTodo,
  lockPaidUnlockTodoKey,
} from './lock-paid-unlock-todo';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 42 — ข้อความแจ้งล็อกบอกลูกค้า "ชำระยอดค้าง … แล้วเจ้าหน้าที่จะปลดล็อคให้" ⇒ เงินของลิงก์แจ้งล็อกเข้าแล้ว (webhook สำเร็จ หลัง commit)
 * ต้องมีงานให้เจ้าหน้าที่ตรวจยอดแล้วปลดล็อค · ระบบไม่ปลดล็อคเอง (ห้ามแตะการเชื่อม MDM) · งานเดียวต่อหนึ่งลิงก์ · พังแล้วไม่ทำให้ webhook ล้ม
 */
describe('createLockPaidUnlockTodo', () => {
  const paid = {
    paidAmount: new Prisma.Decimal('2231.66'),
    refno: '793686721395',
    paidAt: new Date('2026-11-03T05:30:00.000Z'),
  };
  const source = (fields: Record<string, unknown> = {}) => ({
    id: 'src-1',
    purpose: 'AMOUNT',
    sourceEvent: 'DEVICE_LOCKED',
    contract: { id: 'ct-1', contractNumber: 'BC-0001', branchId: 'br-1' },
    ...fields,
  });

  function build(src: Record<string, unknown> | null = source()) {
    return {
      paymentLink: { findUnique: jest.fn().mockResolvedValue(src) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-1' }) },
      todo: { upsert: jest.fn().mockResolvedValue({ id: 'todo-1' }) },
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('เงินของลิงก์แจ้งล็อกเข้าแล้ว → งาน HIGH ให้เจ้าหน้าที่ตรวจยอดแล้วปลดล็อค · ผู้สร้าง = ผู้ใช้ระบบ · สาขาของสัญญา', async () => {
    const prisma = build();

    await createLockPaidUnlockTodo(prisma as never, { sourceLinkId: 'src-1' }, paid);

    expect(prisma.paymentLink.findUnique.mock.calls[0][0].where).toEqual({ id: 'src-1' });
    expect(prisma.user.findFirst.mock.calls[0][0].where).toMatchObject({ isSystemUser: true });
    expect(prisma.todo.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.todo.upsert.mock.calls[0][0];
    // งานเดียวต่อหนึ่งลิงก์ — webhook ส่งซ้ำ / เรียกซ้ำได้งานเดิม (upsert ไม่แก้งานที่มีอยู่)
    expect(args.where).toEqual({ requestKey: lockPaidUnlockTodoKey('src-1') });
    expect(args.update).toEqual({});
    expect(args.create).toMatchObject({
      requestKey: 'lock-paid-unlock:src-1',
      title: 'ลูกค้าชำระยอดค้างผ่าน LINE แล้ว — ตรวจยอดแล้วปลดล็อคเครื่อง สัญญา BC-0001',
      priority: 'HIGH',
      tags: [LOCK_PAID_UNLOCK_TODO_TAG],
      createdById: 'system-1',
      branchId: 'br-1',
    });
    expect(args.create.assigneeId).toBeUndefined();
    // คำอธิบายบอกยอด · เลขอ้างอิง · ว่าระบบไม่ปลดล็อคให้ · ทางปลดล็อคที่มีจริง (หน้ารายละเอียดสัญญา การ์ด "อุปกรณ์ MDM" ปุ่ม "ปลดล็อค")
    expect(args.create.description).toContain('2,231.66 บาท');
    expect(args.create.description).toContain('793686721395');
    expect(args.create.description).toContain('ระบบไม่ได้ปลดล็อคเครื่องให้');
    expect(args.create.description).toContain('การ์ด "อุปกรณ์ MDM" ปุ่ม "ปลดล็อค"');
  });

  it.each([
    ['ลิงก์ยอดนัด', source({ sourceEvent: 'CALL_ANSWERED_PROMISE' })],
    ['ลิงก์ AMOUNT ที่ไม่รู้กฎ (แถวก่อน migration)', source({ sourceEvent: null })],
    ['ลิงก์ปิดยอด', source({ purpose: 'PAYOFF', sourceEvent: null })],
    ['ลิงก์ที่ไม่ใช่ของสัญญา', source({ contract: null })],
    ['ไม่พบลิงก์ต้นทาง', null],
  ])('%s → ไม่สร้างงาน', async (_label, src) => {
    const prisma = build(src);

    await createLockPaidUnlockTodo(prisma as never, { sourceLinkId: 'src-1' }, paid);

    expect(prisma.todo.upsert).not.toHaveBeenCalled();
  });

  it('แถวติดตามไม่มีลิงก์ต้นทาง (ลิงก์งวด · LiffEarlyPayoff) → ไม่อ่านอะไรเลย', async () => {
    const prisma = build();

    await createLockPaidUnlockTodo(prisma as never, { sourceLinkId: null }, paid);

    expect(prisma.paymentLink.findUnique).not.toHaveBeenCalled();
    expect(prisma.todo.upsert).not.toHaveBeenCalled();
  });

  it('ไม่มีผู้ใช้ระบบ → ไม่สร้างงาน · แจ้ง Sentry (เงินเข้าแล้ว ห้ามทำให้ webhook ล้ม)', async () => {
    const prisma = build();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      createLockPaidUnlockTodo(prisma as never, { sourceLinkId: 'src-1' }, paid),
    ).resolves.toBeUndefined();

    expect(prisma.todo.upsert).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('เขียนงานไม่สำเร็จ → ไม่ throw · แจ้ง Sentry พร้อมเลขสัญญา', async () => {
    const prisma = build();
    prisma.todo.upsert.mockRejectedValue(new Error('db down'));

    await expect(
      createLockPaidUnlockTodo(prisma as never, { sourceLinkId: 'src-1' }, paid),
    ).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect((Sentry.captureException as jest.Mock).mock.calls[0][1]).toMatchObject({
      extra: { sourceLinkId: 'src-1', refno: '793686721395' },
    });
  });
});
