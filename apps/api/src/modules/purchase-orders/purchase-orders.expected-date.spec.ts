import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Rule: expectedDate (วันที่คาดรับสินค้า) must not be before orderDate
 * (วันที่สั่งซื้อ). Enforced on every path that writes expectedDate —
 * create(), update(), order() — because the wizard's step gate can be bypassed
 * by draft recovery and the API is also reachable without the UI.
 */
describe('PurchaseOrdersService — expectedDate must not be before orderDate', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  function buildPrisma(po: Record<string, unknown>) {
    return {
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ deletedAt: null, hasVat: false, paymentMethods: [] }),
      },
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(po),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn().mockImplementation((arg: any) => Promise.resolve({ id: 'po-created', ...arg.data })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: jest.fn().mockImplementation((arg: any) => Promise.resolve({ id: 'po-1', ...arg.data })),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fn as (tx: any) => unknown)(prisma),
      ),
    };
  }

  async function makeService(po: Record<string, unknown> = {}) {
    prisma = buildPrisma({
      id: 'po-1', status: 'DRAFT', deletedAt: null, orderDate: new Date('2026-09-13'),
      items: [], supplier: { id: 's1', name: 'S' }, ...po,
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  }

  const baseCreate = { supplierId: 'sup-1', items: [{ quantity: 1, unitPrice: 100 }] };

  describe('create()', () => {
    it('rejects expectedDate before orderDate with a Thai message', async () => {
      const service = await makeService();
      await expect(
        service.create({ ...baseCreate, orderDate: '2026-09-13', expectedDate: '2026-09-07' } as never, 'user-1'),
      ).rejects.toThrow(new BadRequestException('วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่งซื้อ'));
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('accepts expectedDate on the same day as orderDate', async () => {
      const service = await makeService();
      await service.create({ ...baseCreate, orderDate: '2026-09-13', expectedDate: '2026-09-13' } as never, 'user-1');
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });

    it('accepts a missing expectedDate', async () => {
      const service = await makeService();
      await service.create({ ...baseCreate, orderDate: '2026-09-13' } as never, 'user-1');
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update()', () => {
    it('rejects expectedDate before the stored orderDate', async () => {
      const service = await makeService({ status: 'DRAFT' });
      await expect(service.update('po-1', { expectedDate: '2026-09-07' })).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('accepts expectedDate after the stored orderDate', async () => {
      const service = await makeService({ status: 'DRAFT' });
      await service.update('po-1', { expectedDate: '2026-09-20' });
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expectedDate: new Date('2026-09-20') }) }),
      );
    });
  });

  describe('order()', () => {
    it('rejects expectedDate before the stored orderDate', async () => {
      const service = await makeService({ status: 'APPROVED' });
      await expect(service.order('po-1', 'user-1', { expectedDate: '2026-09-07' })).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('accepts expectedDate after the stored orderDate', async () => {
      const service = await makeService({ status: 'APPROVED' });
      await service.order('po-1', 'user-1', { expectedDate: '2026-09-20' });
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ORDERED', expectedDate: new Date('2026-09-20') }) }),
      );
    });
  });
});
