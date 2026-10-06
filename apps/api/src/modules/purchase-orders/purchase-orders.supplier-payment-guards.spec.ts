import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, GoneException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { poJournalTestProviders } from './po-journal.test-helpers';

/**
 * ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05): ทุกการจ่ายเงินผู้จัดจำหน่ายผ่านทางเดียว (`POST :id/payments` → SupplierPaymentService)
 *  - สร้าง/อนุมัติใบสั่งซื้อไม่รับยอดจ่ายอีก (เดิม 2026-09-06 อนุมัติพร้อมจ่ายได้)
 *  - `PATCH :id/payment` (เขียน paidAmount ตรง) ถูกปิด = 410
 *  - รับเข้าตรงจ่ายทันที: โอนธนาคารเท่านั้น + สลิปบังคับ แล้วลงรายการผ่าน `recordInTx` ใน tx เดียวกับรับของ
 */
describe('PurchaseOrdersService — ด่านการจ่ายเงินผู้จัดจำหน่าย (ก้อน 2)', () => {
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
      supplierId: 's1', orderDate: '2026-10-05',
      items: [{ category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 17', quantity: 1, unitPrice: 42900 }],
    };

    it('ส่งยอดจ่ายมาตอนสร้าง → 400 ชี้ไปปุ่มบันทึกการจ่าย และไม่สร้างใบ', async () => {
      const { prisma, created } = makePrisma();
      const service = await build(prisma);
      await expect(service.create({ ...dto, paymentStatus: 'DEPOSIT_PAID', paidAmount: 5000 } as never, 'owner-1', 'OWNER')).rejects.toThrow(/บันทึกการจ่าย/);
      await expect(service.create({ ...dto, paidAmount: 100 } as never, 'owner-1', 'OWNER')).rejects.toThrow(BadRequestException);
      expect(created).toHaveLength(0);
    });

    it('ไม่ส่งยอดจ่าย → สร้างได้ ใบเริ่มที่ยังไม่จ่าย 0 บาทเสมอ (แม้ส่ง paymentStatus UNPAID มา)', async () => {
      const { prisma, created } = makePrisma();
      const service = await build(prisma);
      await service.create({ ...dto, paymentStatus: 'UNPAID', paymentMethod: 'CREDIT' } as never, 'owner-1', 'OWNER');
      expect(created[0]).toEqual(expect.objectContaining({ paymentStatus: 'UNPAID', paidAmount: 0, paymentMethod: 'CREDIT' }));
    });
  });

  describe('updatePayment() — เส้นทางเขียนยอดจ่ายตรงถูกปิด', () => {
    it('ตอบ 410 Gone เสมอ ไม่แตะฐาน', async () => {
      const prisma = { purchaseOrder: { findUnique: jest.fn(), update: jest.fn() } };
      const service = await build(prisma);
      await expect(service.updatePayment('po-1', { paymentStatus: 'FULLY_PAID', paidAmount: 1 })).rejects.toThrow(GoneException);
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('directReceive() จ่ายทันที', () => {
    const baseDto = () => ({
      supplierId: 'sup-1',
      orderDate: '2099-01-15',
      supplierDocType: 'NONE',
      notes: 'ไม่มีเอกสาร ทดสอบ',
      items: [{ category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 16', storage: '256GB', quantity: 1, unitPrice: 30000, imeiSerial: '350000000000001', status: 'PASS' }],
    });

    it('จ่ายเงินสด → 400 ก่อนเปิดธุรกรรม (ไม่มีใบสั่งซื้อเกิด)', async () => {
      const prisma = { $transaction: jest.fn() };
      const service = await build(prisma);
      await expect(
        service.directReceive({ ...baseDto(), paymentStatus: 'FULLY_PAID', paymentMethod: 'CASH', paidAmount: 30000, attachments: ['slip'] } as never, 'user-1'),
      ).rejects.toThrow(/โอนธนาคาร/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('จ่ายโดยไม่มีสลิป → 400 ก่อนเปิดธุรกรรม', async () => {
      const prisma = { $transaction: jest.fn() };
      const service = await build(prisma);
      await expect(
        service.directReceive({ ...baseDto(), paymentStatus: 'FULLY_PAID', paymentMethod: 'BANK_TRANSFER', paidAmount: 30000 } as never, 'user-1'),
      ).rejects.toThrow(/สลิป/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
