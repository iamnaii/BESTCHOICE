import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TradeInCreditService } from './trade-in-credit.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * `assertActor` อ่านแถว user จาก tx โดยตรง ไม่ใช่ `req.user` จึงเป็นจุดเดียวในเส้นทางเครดิตเทิร์น
 * ที่ JwtStrategy (ซึ่ง resolve สิทธิ์บริษัทให้แล้ว) ครอบไม่ถึง — เดิมเขียนเป็น
 * `actor.accessibleCompanies.includes('SHOP')` ตรง ๆ ⇒ ทุกคนที่ยังไม่ backfill โดน 403
 * ข้อความ error ต้องคงเดิมทุกตัวอักษร เพราะ e2e (credit-payment-flow) assert ด้วยสตริง 'สิทธิ์ SHOP'
 */
describe('TradeInCreditService.assertActor — สิทธิ์บริษัทของผู้ทำรายการ', () => {
  const findUnique = jest.fn();
  const tx = { user: { findUnique } } as unknown as Prisma.TransactionClient;
  const service = new TradeInCreditService({} as unknown as PrismaService);

  const assertActor = (actorId: string, branchId: string) =>
    (
      service as unknown as {
        assertActor: (
          tx: Prisma.TransactionClient,
          actorId: string,
          branchId: string,
        ) => Promise<void>;
      }
    ).assertActor(tx, actorId, branchId);

  const actor = (over: Record<string, unknown>) => ({
    id: 'actor-1',
    role: 'SALES',
    branchId: 'branch-1',
    isActive: true,
    deletedAt: null,
    accessibleCompanies: [],
    primaryCompany: null,
    ...over,
  });

  beforeEach(() => findUnique.mockReset());

  it('ผ่านเมื่อบัญชียังไม่ backfill — array ว่างของ SALES = ค่า default ที่มี SHOP', async () => {
    findUnique.mockResolvedValue(actor({ role: 'SALES', accessibleCompanies: [] }));

    await expect(assertActor('actor-1', 'branch-1')).resolves.toBeUndefined();
  });

  it('ยังปฏิเสธบัญชีที่ถูกจำกัดไว้จริง — OWNER ที่มีแค่ FINANCE ทำเครดิตเทิร์นไม่ได้', async () => {
    findUnique.mockResolvedValue(
      actor({ role: 'OWNER', branchId: null, accessibleCompanies: ['FINANCE'] }),
    );

    await expect(assertActor('actor-1', 'branch-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertActor('actor-1', 'branch-1')).rejects.toThrow('สิทธิ์ SHOP');
  });

  it('ผ่านเมื่อบัญชีถูก backfill ด้วย SHOP แล้ว', async () => {
    findUnique.mockResolvedValue(actor({ role: 'SALES', accessibleCompanies: ['SHOP'] }));

    await expect(assertActor('actor-1', 'branch-1')).resolves.toBeUndefined();
  });
});
