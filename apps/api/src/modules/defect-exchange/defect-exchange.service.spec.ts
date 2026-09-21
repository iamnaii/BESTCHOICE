import * as creditApproval from '../credit-check/services/credit-approval';
import * as creditLocks from '../credit-check/services/room-credit-history';
beforeEach(() => {
  jest.spyOn(creditApproval, 'bindExchangeCreditCheck').mockResolvedValue(undefined);
  jest.spyOn(creditLocks, 'lockCreditCustomer').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DefectExchangeService } from './defect-exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';
import { RepairTicketsService } from '../repair-tickets/repair-tickets.service';
import { TEST_CUSTOMER_ADDRESS } from '../../utils/test-data-markers';

// generateContractNumber issues a $queryRaw lock + sequence read; stub it out
// so unit tests don't need a Postgres advisory-lock implementation.
jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('CT-2026-05-00001'),
}));

// test-data fence (spec 2026-09-05 §5.4 — แก้หลัง final review): เคลมเปลี่ยนเครื่องสืบทอด "ลูกค้า"
// แต่ "เครื่อง" เลือกใหม่จากสต็อก ⇒ คู่ใหม่ ต้องผ่าน `assertSameTestSide`. mock ที่ไปถึงรั้วต้องมี
// ฟิลด์ที่รั้วอ่าน: ลูกค้า {name, phone, addressCurrent} · เครื่อง {name, imeiSerial, po}
const REAL_CUSTOMER = {
  id: 'cust-1',
  name: 'ลูกค้าจริง',
  phone: '0891234567',
  addressCurrent: 'กรุงเทพ',
};
const TEST_CUSTOMER = {
  id: 'cust-1',
  name: 'ทดสอบระบบ ลูกค้า',
  phone: 'TEST-0000001',
  addressCurrent: TEST_CUSTOMER_ADDRESS,
};
const REAL_PRODUCT_FENCE = { name: 'iPhone 14', imeiSerial: '356789012345678', po: null };
const TEST_PRODUCT_FENCE = { name: 'iPhone 14', imeiSerial: 'TEST-0001', po: null };

describe('DefectExchangeService', () => {
  let service: DefectExchangeService;
  let prisma: any;
  let repairTickets: any;
  let reversal: any;

  const oldContractId = 'ct-old';
  const newProductId = 'prod-new';
  const userId = 'user-1';

  const futureWindowEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // +5 days

  // Helper: contract within the 7-day defect window with eligible product.
  const baseContract = (overrides: Partial<any> = {}) => ({
    id: oldContractId,
    contractNumber: 'CT-2026-05-OLD',
    customerId: 'cust-1',
    productId: 'prod-old',
    branchId: 'branch-1',
    salespersonId: 'user-2',
    planType: 'INSTALLMENT',
    sellingPrice: 10000,
    downPayment: 1000,
    interestRate: 0,
    totalMonths: 12,
    interestTotal: 0,
    financedAmount: 9000,
    storeCommission: 0,
    vatAmount: 0,
    vatPct: 0,
    monthlyPayment: 750,
    paymentDueDay: 5,
    interestConfigId: null,
    parentContractId: null,
    notes: null,
    status: 'ACTIVE',
    deletedAt: null,
    deviceReceivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    shopWarrantyStartDate: null,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    product: {
      id: 'prod-old',
      brand: 'Apple',
      model: 'iPhone 14',
      storage: '128GB',
      category: 'PHONE_USED',
      status: 'SOLD_INSTALLMENT',
      imeiSerial: 'IMEI-OLD',
      shopWarrantyDays: 30,
      stockInDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      supplierId: 'sup-1',
    },
    payments: [],
    // test-data fence: execute() include ลูกค้าของสัญญาเดิมมาเข้ารั้ว
    customer: REAL_CUSTOMER,
    ...overrides,
  });

  // Replacement product matching brand/model/storage of old product.
  const newProductRec = {
    id: newProductId,
    brand: 'Apple',
    model: 'iPhone 14',
    storage: '128GB',
    category: 'PHONE_USED',
    status: 'IN_STOCK',
    shopWarrantyDays: 30,
    deviceOrigin: 'IMPORTED',
    warrantyTerms: 'Replacement warranty',
    stockInDate: new Date(),
    supplierId: 'sup-1',
    ...REAL_PRODUCT_FENCE,
  };

  const OWNER = { id: 'user-owner', role: 'OWNER', branchId: null };

  beforeEach(async () => {
    const txMock = {
      contract: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'ct-new', contractNumber: 'CT-2026-05-00001', customerId: 'cust-1' }),
      },
      product: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        count: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      repairTicket: {
        findUnique: jest.fn(),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma = {
      contract: {
        findUnique: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
      __tx: txMock,
    };

    repairTickets = {
      markReplaced: jest.fn().mockResolvedValue(undefined),
    };
    reversal = { reverseContract: jest.fn().mockResolvedValue({ id: 'je-rev' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefectExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: {} },
        { provide: DefectExchangeReversalTemplate, useValue: reversal },
        { provide: RepairTicketsService, useValue: repairTickets },
      ],
    }).compile();

    service = module.get<DefectExchangeService>(DefectExchangeService);
  });

  it('rolls back a replacement with no fresh credit review before reserving its product', async () => {
    prisma.contract.findUnique.mockResolvedValue(baseContract());
    prisma.product.findUnique.mockResolvedValue(newProductRec);
    prisma.__tx.contract.findUnique.mockResolvedValue(baseContract());
    prisma.__tx.product.findUnique.mockResolvedValue(newProductRec);
    prisma.__tx.payment.count.mockResolvedValue(0);
    jest.spyOn(creditApproval, 'bindExchangeCreditCheck').mockRejectedValue(new BadRequestException('ต้องตรวจเครดิตรอบใหม่'));
    await expect(service.execute({ oldContractId, newProductId, defectReason: 'screen broken' } as any, userId)).rejects.toThrow(/รอบใหม่/);
    expect(prisma.__tx.product.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: newProductId } }));
  });

  describe('execute — Wave 3 T2 payment guard (ปพพ.386 C-6)', () => {
    it('throws BadRequestException when contract has any PAID payment record', async () => {
      const contract = baseContract();

      // checkEligibility uses the top-level prisma (not tx) — return contract there.
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      // Tx: payment.count returns 1 (paid record exists) → guard trips.
      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(1);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(/มีรายการชำระเงินแล้ว/);
    });

    it('proceeds when contract has zero payments', async () => {
      const contract = baseContract();
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(contract);
      tx.product.findUnique.mockResolvedValue(newProductRec);

      const result = await service.execute(
        {
          oldContractId,
          newProductId,
          defectReason: 'screen broken',
        } as any,
        userId,
      );

      expect(result.newContract).toBeDefined();
      expect(tx.contract.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        productDisclosure: { version: 1, deviceOrigin: 'IMPORTED', shopWarrantyDays: 30, warrantyTerms: 'Replacement warranty' },
      }) }));
      expect(result.oldContract.status).toBe('DEFECT_EXCHANGED');
      expect(tx.payment.count).toHaveBeenCalledWith({
        where: {
          contractId: oldContractId,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
      });
    });

    it('B5: ตัด hold ของเว็บใน tx เดียวกับที่เครื่องออกจาก IN_STOCK', async () => {
      const contract = baseContract();
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(contract);
      tx.product.findUnique.mockResolvedValue(newProductRec);
      tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

      await service.execute(
        {
          oldContractId,
          newProductId,
          defectReason: 'screen broken',
        } as any,
        userId,
      );

      const call = tx.productReservation.updateMany.mock.calls.at(-1)[0];
      expect(call.where.productId.in).toContain(newProductId);
      expect(call.where.status).toBe('ACTIVE');
      expect(call.data).toEqual({ status: 'PREEMPTED' });
    });

    it('payment guard message includes the count of payment records', async () => {
      const contract = baseContract();
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(3);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(/3 รายการ/);
    });
  });

  // Reference futureWindowEnd to silence unused-var warning if test grows.
  it('windowEnd helper — sanity check', () => {
    expect(futureWindowEnd.getTime()).toBeGreaterThan(Date.now());
  });

  describe('execute — bypassWindowCheck path', () => {
    const bypassDto = {
      oldContractId,
      newProductId,
      defectReason: 'insurance replacement',
      bypassWindowCheck: true,
      originRepairTicketId: 'rt-1',
    } as any;

    it('throws BadRequestException when bypass=true without originRepairTicketId', async () => {
      await expect(
        service.execute(
          { ...bypassDto, originRepairTicketId: undefined } as any,
          OWNER,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.execute(
          { ...bypassDto, originRepairTicketId: undefined } as any,
          OWNER,
        ),
      ).rejects.toThrow(/originRepairTicketId/);
    });

    it('throws ForbiddenException when SALES role tries bypass', async () => {
      const salesUser = { id: 'user-sales', role: 'SALES', branchId: 'branch-1' };
      await expect(
        service.execute(bypassDto, salesUser),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.execute(bypassDto, salesUser),
      ).rejects.toThrow(/OWNER/);
    });

    it('throws BadRequestException when ticket is in terminal status', async () => {
      const tx = prisma.__tx;
      tx.repairTicket.findUnique.mockResolvedValue({
        id: 'rt-1',
        customerId: 'cust-1',
        status: 'CLOSED',
        deletedAt: null,
      });

      await expect(service.execute(bypassDto, OWNER)).rejects.toThrow(BadRequestException);
      await expect(service.execute(bypassDto, OWNER)).rejects.toThrow(/terminal/);
    });

    it('throws ForbiddenException when repair ticket customer does not match contract customer', async () => {
      const tx = prisma.__tx;
      // Both calls to repairTicket.findUnique return ticket with different customerId.
      // First call: existence + status guard (status IN_PROGRESS → passes).
      // Second call: customer match select (customerId = 'cust-DIFFERENT' ≠ contract.customerId 'cust-1').
      const mismatchTicket = {
        id: 'rt-1',
        customerId: 'cust-DIFFERENT',
        status: 'IN_PROGRESS',
        deletedAt: null,
      };
      tx.repairTicket.findUnique.mockResolvedValue(mismatchTicket);

      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(baseContract()); // customerId = 'cust-1'
      tx.product.findUnique.mockResolvedValue(newProductRec);
      // newContract.customerId = 'cust-1' → mismatch with ticket's 'cust-DIFFERENT'
      tx.contract.create.mockResolvedValue({
        id: 'ct-new',
        contractNumber: 'CT-2026-05-00001',
        customerId: 'cust-1',
      });

      prisma.contract.findUnique.mockResolvedValue(baseContract());
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const err = await service.execute(bypassDto, OWNER).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toMatch(/customer mismatch/);
    });

    it('happy path: skips eligibility, creates contract, calls markReplaced, writes bypass audit log', async () => {
      const tx = prisma.__tx;
      tx.repairTicket.findUnique
        // First call: existence + status check
        .mockResolvedValueOnce({
          id: 'rt-1',
          customerId: 'cust-1',
          status: 'IN_PROGRESS',
          deletedAt: null,
        })
        // Second call: customer match check (select: { customerId })
        .mockResolvedValueOnce({ customerId: 'cust-1' });

      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(baseContract());
      tx.product.findUnique.mockResolvedValue(newProductRec);
      tx.contract.create.mockResolvedValue({
        id: 'ct-new',
        contractNumber: 'CT-2026-05-00001',
        customerId: 'cust-1',
      });

      prisma.contract.findUnique.mockResolvedValue(baseContract());
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const result = await service.execute(bypassDto, OWNER);

      expect(result.newContract).toBeDefined();
      expect(result.oldContract.status).toBe('DEFECT_EXCHANGED');

      // markReplaced must be called with correct args inside same tx
      expect(repairTickets.markReplaced).toHaveBeenCalledWith(
        'rt-1',
        'ct-new',
        OWNER,
        expect.anything(), // tx proxy
      );

      // DEFECT_EXCHANGE_WINDOW_BYPASSED audit log must be written
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
            entityId: 'ct-new',
            newValue: expect.objectContaining({ originRepairTicketId: 'rt-1' }),
          }),
        }),
      );
    });
  });

  // spec 2026-09-05 §5.4 (แก้หลัง final review Critical): เคลมเปลี่ยนเครื่องตำหนิสืบทอด "ลูกค้า"
  // แต่เลือก "เครื่อง" ใหม่จากสต็อก (ต้องตรงรุ่น/ความจุ — เครื่องทดสอบที่ seed ไว้ก็ผ่าน)
  // ⇒ คู่ใหม่ ต้องผ่านรั้วที่จุดโหลดเครื่องใน tx ก่อนปิดสัญญาเดิม/สร้างสัญญาใหม่/แตะสถานะเครื่อง.
  // ทาง replace จากใบซ่อม (bypassWindowCheck) ข้าม checkEligibility แต่ต้องไม่ข้ามรั้ว.
  describe('execute — test-data fence (คู่ใหม่ = ลูกค้าเดิม + เครื่องที่เลือกใหม่)', () => {
    const dto = { oldContractId, newProductId, defectReason: 'screen broken' } as any;
    const arm = (contract: any, product: any) => {
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(product);
      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(contract);
      tx.product.findUnique.mockResolvedValue(product);
      return tx;
    };
    const expectNothingWritten = (tx: any) => {
      expect(tx.contract.update).not.toHaveBeenCalled();
      expect(tx.contract.create).not.toHaveBeenCalled();
      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.payment.createMany).not.toHaveBeenCalled();
      expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(reversal.reverseContract).not.toHaveBeenCalled();
    };

    it('จริง ↔ จริง ผ่าน และโหลดลูกค้าของสัญญาเดิม + PO ของเครื่องใหม่ใน tx', async () => {
      const tx = arm(baseContract(), newProductRec);
      const result = await service.execute(dto, userId);
      expect(result.newContract).toBeDefined();
      expect(tx.contract.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: oldContractId },
          include: expect.objectContaining({
            customer: { select: expect.objectContaining({ addressCurrent: true }) },
          }),
        }),
      );
      // po บังคับในชนิดของรั้ว — อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบต้องถูกมองเป็นของทดสอบ
      expect(tx.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: newProductId },
          include: { po: { select: { poNumber: true } } },
        }),
      );
    });

    it('ทดสอบ ↔ ทดสอบ ผ่าน', async () => {
      const tx = arm(baseContract({ customer: TEST_CUSTOMER }), {
        ...newProductRec,
        ...TEST_PRODUCT_FENCE,
      });
      const result = await service.execute(dto, userId);
      expect(result.oldContract.status).toBe('DEFECT_EXCHANGED');
      expect(tx.contract.create).toHaveBeenCalledTimes(1);
    });

    it('เครื่องทดสอบ → ลูกค้าจริง: BadRequest ก่อนปิดสัญญาเดิม/สร้างสัญญาใหม่', async () => {
      const tx = arm(baseContract(), { ...newProductRec, ...TEST_PRODUCT_FENCE });
      await expect(service.execute(dto, userId)).rejects.toThrow(/เครื่องทดสอบระบบ/);
      expectNothingWritten(tx);
    });

    it('เครื่องจริง → ลูกค้าทดสอบ: BadRequest ก่อนเขียนอะไรทั้งสิ้น', async () => {
      const tx = arm(baseContract({ customer: TEST_CUSTOMER }), newProductRec);
      await expect(service.execute(dto, userId)).rejects.toThrow(/ลูกค้าทดสอบระบบ/);
      expectNothingWritten(tx);
    });

    it('ทาง replace จากใบซ่อม (bypassWindowCheck) ก็ไม่ข้ามรั้ว — ไม่ markReplaced', async () => {
      const tx = arm(baseContract(), { ...newProductRec, ...TEST_PRODUCT_FENCE });
      tx.repairTicket.findUnique.mockResolvedValue({
        id: 'rt-1',
        customerId: 'cust-1',
        status: 'IN_PROGRESS',
        deletedAt: null,
      });
      await expect(
        service.execute({ ...dto, bypassWindowCheck: true, originRepairTicketId: 'rt-1' }, OWNER),
      ).rejects.toThrow(/เครื่องทดสอบระบบ/);
      expectNothingWritten(tx);
      expect(repairTickets.markReplaced).not.toHaveBeenCalled();
    });
  });
});
