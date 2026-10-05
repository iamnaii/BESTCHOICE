import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

/**
 * Owner decision 2026-09-06 ("ลดขั้นตอนอนุมัติ/สั่ง"):
 *  - a PO the OWNER creates needs no self-approval → it is ORDERED straight away;
 *    a BRANCH_MANAGER's PO still waits for the owner (DRAFT) — that gate is the branch spend control
 *  - approve = order: DRAFT → ORDERED in one step (orderedAt stamped, expected date confirmable there)
 *  - an ORDERED PO with nothing received yet can still be cancelled (approve used to leave a
 *    cancellable APPROVED state in between; collapsing it must not lock the PO in)
 */
describe('PurchaseOrdersService — approval rules', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = async (prisma: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }, ...poJournalTestProviders().providers],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  describe('create()', () => {
    const makePrisma = () => {
      const created: Record<string, unknown>[] = [];
      const tx = {
        purchaseOrder: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockImplementation(({ data }) => {
            created.push(data);
            return Promise.resolve({ id: 'po-new', ...data });
          }),
        },
      };
      const prisma = {
        supplier: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, hasVat: false, paymentMethods: [] }) },
        systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      };
      return { prisma, created };
    };
    const dto = {
      supplierId: 's1', orderDate: '2026-09-10',
      items: [{ category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 17 Pro', quantity: 1, unitPrice: 42900 }],
    };

    it('OWNER: the PO is ORDERED immediately, approved by the creator, orderedAt stamped', async () => {
      const { prisma, created } = makePrisma();
      const service = await build(prisma);
      await service.create(dto as never, 'owner-1', 'OWNER');
      expect(created[0]).toEqual(expect.objectContaining({ status: 'ORDERED', approvedById: 'owner-1', orderedAt: expect.any(Date) }));
    });

    it('BRANCH_MANAGER: the PO still waits for the owner (DRAFT, nobody approved it)', async () => {
      const { prisma, created } = makePrisma();
      const service = await build(prisma);
      await service.create(dto as never, 'bm-1', 'BRANCH_MANAGER');
      expect(created[0]).toEqual(expect.objectContaining({ status: 'DRAFT' }));
      expect(created[0].approvedById).toBeUndefined();
      expect(created[0].orderedAt).toBeUndefined();
    });
  });

  describe('approve() = order', () => {
    const makePrisma = (status: string) => ({
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'po-1', status, orderDate: new Date('2026-09-10'), deletedAt: null, items: [], supplier: { id: 's1', name: 'S' },
        }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'po-1', ...data })),
      },
    });

    it('DRAFT → ORDERED in one step: approvedById + orderedAt, expected date confirmed when given', async () => {
      const prisma = makePrisma('DRAFT');
      const service = await build(prisma);
      const result = await service.approve('po-1', 'owner-1', { expectedDate: '2026-09-20' });
      expect(result.status).toBe('ORDERED');
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1' },
          data: expect.objectContaining({
            status: 'ORDERED', approvedById: 'owner-1', orderedAt: expect.any(Date), expectedDate: new Date('2026-09-20'),
          }),
        }),
      );
    });

    it('keeps the existing expected date when none is given', async () => {
      const prisma = makePrisma('DRAFT');
      const service = await build(prisma);
      await service.approve('po-1', 'owner-1');
      const data = prisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('expectedDate');
    });

    it('rejects an expected date before the order date', async () => {
      const prisma = makePrisma('DRAFT');
      const service = await build(prisma);
      await expect(service.approve('po-1', 'owner-1', { expectedDate: '2026-09-01' })).rejects.toThrow(
        'วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่งซื้อ',
      );
    });

    it('still only approves a DRAFT', async () => {
      const prisma = makePrisma('ORDERED');
      const service = await build(prisma);
      await expect(service.approve('po-1', 'owner-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05): ทุกการจ่ายผ่านปุ่ม "บันทึกการจ่าย" หลังอนุมัติ — อนุมัติไม่รับยอดจ่ายอีก
  // (เดิม 2026-09-06 อนุมัติพร้อมจ่ายได้ — ถอดออกเพราะต้องลงบัญชีทุกการจ่ายผ่านทางเดียว)
  describe('approve() ไม่รับยอดจ่าย', () => {
    const makePrisma = () => ({
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'po-1', status: 'DRAFT', orderDate: new Date('2026-09-10'), netAmount: 44900, deletedAt: null, items: [],
          supplier: { id: 's1', name: 'S' },
        }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'po-1', ...data })),
      },
    });

    it('ส่งยอดจ่ายมาพร้อมอนุมัติ → 400 ชี้ไปปุ่มบันทึกการจ่าย และไม่อนุมัติ', async () => {
      const prisma = makePrisma();
      const service = await build(prisma);
      await expect(
        service.approve('po-1', 'owner-1', { expectedDate: '2026-09-20', paymentStatus: 'DEPOSIT_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 13470 }),
      ).rejects.toThrow(/บันทึกการจ่าย/);
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('อนุมัติเปล่า (หรือ UNPAID) → ORDERED โดยไม่แตะช่องจ่ายเงิน', async () => {
      const prisma = makePrisma();
      const service = await build(prisma);
      await service.approve('po-1', 'owner-1', { expectedDate: '2026-09-20', paymentStatus: 'UNPAID' });
      const data = prisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ status: 'ORDERED', approvedById: 'owner-1' }));
      expect(data).not.toHaveProperty('paymentStatus');
      expect(data).not.toHaveProperty('paidAmount');
    });
  });

  describe('cancel()', () => {
    // ก้อน 2: ยกเลิกอยู่ใน $transaction (ปิดมัดจำค้างในใบเดียวกัน) — ใบที่ไม่เคยมัดจำผ่านทางลัด findFirst = null
    const makePrisma = (status: string, receivedQty: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prisma: any = {
        purchaseOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'po-1', status, deletedAt: null, supplier: { id: 's1', name: 'S' },
            items: [{ id: 'i1', quantity: 2, receivedQty }],
          }),
          update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'po-1', ...data })),
        },
        purchaseOrderPayment: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(prisma));
      return prisma;
    };

    it('an ORDERED PO with nothing received can be cancelled', async () => {
      const service = await build(makePrisma('ORDERED', 0));
      const result = await service.cancel('po-1', 'owner-1');
      expect(result.status).toBe('CANCELLED');
      expect(result.depositClosed).toBeNull();
    });

    it('an ORDERED PO that already received something cannot', async () => {
      const service = await build(makePrisma('ORDERED', 1));
      await expect(service.cancel('po-1', 'owner-1')).rejects.toThrow(BadRequestException);
    });

    it('a PARTIALLY_RECEIVED PO cannot (unchanged)', async () => {
      const service = await build(makePrisma('PARTIALLY_RECEIVED', 1));
      await expect(service.cancel('po-1', 'owner-1')).rejects.toThrow(BadRequestException);
    });
  });
});
