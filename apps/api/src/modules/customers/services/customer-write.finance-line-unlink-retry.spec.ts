import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerWriteService } from './customer-write.service';

/**
 * Task 27 fix round 1 (review M-2) — ปุ่มยกเลิกผูก LINE การเงินล็อก ลูกค้า → link → ห้อง (เท่าทาง PATCH/LIFF) ส่วน `VerificationService.bind`
 * ล็อกกลับด้าน ⇒ Postgres อาจตัดสิน deadlock ให้ฝั่งปุ่ม · ทรานแซกชันของปุ่มอ่านใหม่ใต้ล็อกทุกครั้ง จึงลองทั้งก้อนใหม่ได้ (legacy สูงสุด 3 ครั้ง)
 * · error อื่นไม่ลองซ้ำ · audit เขียนครั้งเดียวหลังทรานแซกชันที่สำเร็จ
 */
describe('CustomerWriteService.unlinkFinanceLineByStaff — deadlock ลองใหม่', () => {
  const deadlock = () =>
    new Prisma.PrismaClientKnownRequestError('deadlock detected', {
      code: 'P2034',
      clientVersion: 'test',
    });

  function setup(failures: unknown[]) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      customer: {
        findUnique: jest.fn().mockResolvedValue({ deletedAt: null, lineIdFinance: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      customerLineLink: {
        findFirst: jest.fn().mockResolvedValue({ linkedAt: new Date('2026-10-30T03:00:00.000Z') }),
        findMany: jest.fn().mockResolvedValue([{ lineUserId: 'U-x' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRoom: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const queue = [...failures];
    const root = {
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
        const next = queue.shift();
        if (next) throw next;
        return cb(tx);
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomerWriteService(
      root as never,
      {} as never,
      {} as never,
      undefined,
      audit as never,
    );
    return { service, root, audit };
  }

  it('deadlock ครั้งแรก → ลองทั้งทรานแซกชันใหม่แล้วสำเร็จ · audit ครั้งเดียว', async () => {
    const { service, root, audit } = setup([deadlock()]);
    const out = await service.unlinkFinanceLineByStaff('c1', { id: 'staff-1' });
    expect(out.unlinked).toBe(true);
    expect(root.$transaction).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('deadlock ครบ 3 ครั้ง → ส่ง error ต่อ (ไม่ลองไม่สิ้นสุด) · ไม่มี audit', async () => {
    const { service, root, audit } = setup([deadlock(), deadlock(), deadlock()]);
    await expect(service.unlinkFinanceLineByStaff('c1', { id: 'staff-1' })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(root.$transaction).toHaveBeenCalledTimes(3);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('error ที่ไม่ใช่ deadlock/serialization (เช่น 404) → ไม่ลองซ้ำ', async () => {
    const { service, root } = setup([new NotFoundException('ไม่พบลูกค้า')]);
    await expect(service.unlinkFinanceLineByStaff('c1', { id: 'staff-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(root.$transaction).toHaveBeenCalledTimes(1);
  });
});
