import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopReservationService } from './shop-reservation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopReservationService', () => {
  let service: ShopReservationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findFirst: jest.fn(),
        // Fix 2 (F2, final-review forward-flag): reserve()'s create() now runs inside a
        // $transaction, then re-reads product.status AFTER the insert, in the SAME tx.
        // Default = still IN_STOCK (happy path) — the sold-mid-race tests below override.
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }),
      },
      productReservation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      // Fix round 1/5 (Minor): readBoolFlag('shop_hide_demo_products') reads this — most
      // tests leave it unmocked (undefined → readRawValue catches → default false).
      systemConfig: { findFirst: jest.fn() },
      // B5 fix round 1: reserve()'s re-reserve guard now counts unresolved PAID
      // OnlineOrder rows on this productId (was: terminal CONSUMED hold count).
      onlineOrder: { count: jest.fn().mockResolvedValue(0) },
    };
    // Fix 2 (F2): in these unit tests `tx` and `prisma` are the SAME mock object — every
    // product/productReservation method lives on one shape — so `prisma.$transaction`
    // just invokes the callback with `prisma` itself. This keeps every EXISTING
    // assertion that reads `prisma.productReservation.create.mock.calls[...]` (or
    // similar) valid without introducing a separate tx-mock surface.
    prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    const module = await Test.createTestingModule({
      providers: [ShopReservationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopReservationService);
  });

  describe('reserve', () => {
    it('creates 15-min reservation for available product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({
        id: 'r1',
        expiresAt: new Date(Date.now() + 900_000),
      });

      const result = await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.create).toHaveBeenCalled();
      const data = prisma.productReservation.create.mock.calls[0][0].data;
      expect(data.productId).toBe('p1');
      expect(data.sessionId).toBe('s1');
      expect(data.status).toBe('ACTIVE');
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeGreaterThan(890_000);
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    });

    it('rejects if product not found', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects (404) เมื่อเครื่องไม่ผ่าน readiness — ขายแล้ว / ปิดจากเว็บ / ไม่มีราคา / ไม่มีรูป', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        'สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ',
      );
      // fragment ถูกส่งเข้า query จริง (ไม่ได้จองเครื่องไม่มีราคาได้อีก)
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ cashPrice: { gt: 0 } }]));
    });

    it('Fix round 1/5 (Minor): กรอง [DEMO] เมื่อเปิด flag shop_hide_demo_products — จองเครื่อง [DEMO] ไม่ได้ (404)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'demo-1', sessionId: 's1' })).rejects.toThrow(
        'สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ',
      );
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
    });

    it('rejects if already reserved by another session', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 'other-session',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
      });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('extends existing reservation if same session re-reserves', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 's1',
        status: 'ACTIVE',
      });
      prisma.productReservation.update.mockResolvedValue({
        id: 'r-existing',
        expiresAt: new Date(),
      });

      await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r-existing' } }),
      );
      expect(prisma.productReservation.create).not.toHaveBeenCalled();
    });

    it('Final fix wave F1: sweeps a stale-expired ACTIVE row (still ACTIVE, expiresAt in the past) before checking/creating — so the new hold does not collide with the partial unique index', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });
      // ยังไม่ถูก cron กวาด (cron รันทุก 5 นาที) — findFirst หลัง sweep ต้องไม่เจอมันแล้ว
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({
        id: 'r-new',
        expiresAt: new Date(Date.now() + 900_000),
      });

      await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.updateMany).toHaveBeenCalledWith({
        where: { productId: 'p1', status: 'ACTIVE', expiresAt: { lte: expect.any(Date) } },
        data: { status: 'EXPIRED' },
      });
      // sweep ต้องเกิดก่อน findFirst/create (ลำดับสำคัญ — ไม่งั้นแถวหมดอายุยังกันทางอยู่)
      const sweepOrder = prisma.productReservation.updateMany.mock.invocationCallOrder[0];
      const findOrder = prisma.productReservation.findFirst.mock.invocationCallOrder[0];
      const createOrder = prisma.productReservation.create.mock.invocationCallOrder[0];
      expect(sweepOrder).toBeLessThan(findOrder);
      expect(findOrder).toBeLessThan(createOrder);
      expect(prisma.productReservation.create).toHaveBeenCalled();
    });

    it('Final fix wave F1: create() ชน partial unique index (P2002 race — สองคนจองพร้อมกัน) → ConflictException ข้อความไทย ไม่ใช่ error ดิบหลุดเป็น 500', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      const raceError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.x',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      prisma.productReservation.create.mockRejectedValue(raceError);

      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        'เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — กรุณาลองใหม่ภายหลัง',
      );
    });

    // ── Fix 2 (F2, final-review forward-flag, closed here — proven with a 554ms-block
    // experiment): product.status was read via a plain findFirst with NO tx/lock at the
    // TOP of reserve(). The create() below can BLOCK on the partial unique index while a
    // competing checkout holds the same product's hold slot — and while blocked, the
    // in-store sale flow can sell the very same device (its preempt only flips holds
    // that already EXIST at the moment it runs; a hold created AFTER the sale committed
    // is invisible to it). Fix: wrap create() in a $transaction, then RE-READ
    // product.status INSIDE the same tx, AFTER the create resolves — at READ COMMITTED
    // (Prisma default) every statement sees the latest committed data, so a sale that
    // committed while our INSERT was blocked is visible to this post-insert SELECT.
    it('Fix 2 (F2): เครื่องถูกขายไปแล้วระหว่าง initial check กับ post-insert re-read → ConflictException, rollback (create รันอยู่ใน tx เดียวกัน)', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({
        id: 'r-new',
        expiresAt: new Date(Date.now() + 900_000),
      });
      // Post-insert re-read runs INSIDE the same tx, AFTER create — sees the device
      // already sold (e.g. the in-store sale flow committed while our INSERT was
      // blocked on the partial unique index).
      prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        'เครื่องนี้เพิ่งถูกจำหน่าย กรุณาเลือกเครื่องอื่น',
      );

      // Proves the create + re-read ran INSIDE the same $transaction callback — the tx
      // wraps both, so throwing after create() rolls the INSERT back with it.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.productReservation.create).toHaveBeenCalled();
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        select: { status: true },
      });
    });

    it('Fix 2 (F2): happy path — post-insert re-read ยืนยัน IN_STOCK แล้ว → คืน hold ตามปกติ ไม่เปลี่ยนพฤติกรรมเดิม', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      const created = { id: 'r-new', expiresAt: new Date(Date.now() + 900_000) };
      prisma.productReservation.create.mockResolvedValue(created);
      prisma.product.findUnique.mockResolvedValue({ status: 'IN_STOCK' });

      const result = await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(result).toEqual(created);
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { id: 'p1' },
        select: { status: true },
      });
    });

    it('B5 fix round 1: มี OnlineOrder ค้างสถานะ PAID บนเครื่องนี้ → จองไม่ได้ แม้เครื่องยัง IN_STOCK (saleAdapter พังหลังเงินเข้า)', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.onlineOrder.count.mockResolvedValue(1);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        'เครื่องนี้ถูกจำหน่ายไปแล้ว — กรุณาเลือกเครื่องอื่น',
      );
      expect(prisma.productReservation.create).not.toHaveBeenCalled();
    });

    it('B5 fix round 1: ไม่มี OnlineOrder ค้างสถานะ PAID → จองได้ตามปกติ', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.onlineOrder.count.mockResolvedValue(0);
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({
        id: 'r-new',
        expiresAt: new Date(Date.now() + 900_000),
      });

      await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.onlineOrder.count).toHaveBeenCalledWith({
        where: { productId: 'p1', status: 'PAID' },
      });
      expect(prisma.productReservation.create).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('marks reservation as CANCELLED when sessionId matches the active hold', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });
      await service.cancel('r1', 's1');
      expect(prisma.productReservation.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', sessionId: 's1', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });

    it('throws NotFound when sessionId does not own the reservation (IDOR guard)', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancel('r1', 'wrong-session')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when sessionId is missing', async () => {
      await expect(service.cancel('r1', '')).rejects.toThrow(BadRequestException);
      expect(prisma.productReservation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('expireOldReservations', () => {
    it('updates all expired ACTIVE reservations to EXPIRED', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 5 });
      const count = await service.expireOldReservations();
      expect(count).toBe(5);
      expect(prisma.productReservation.updateMany).toHaveBeenCalled();
    });
  });
});
