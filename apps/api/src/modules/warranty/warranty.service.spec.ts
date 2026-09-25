import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WarrantyService.adjustShopWarranty', () => {
  let service: WarrantyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const contractWithWarranty = (end: Date | null) => ({
    id: 'c-1',
    shopWarrantyEndDate: end,
  });

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(contractWithWarranty(new Date('2026-08-01'))),
        update: jest.fn().mockResolvedValue({}),
      },
      warrantyAuditLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [WarrantyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WarrantyService);
  });

  it('rejects reason < 10 chars', async () => {
    await expect(
      service.adjustShopWarranty('c-1', new Date('2026-09-01'), 'short', 'u', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when contract missing', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(
      service.adjustShopWarranty(
        'c-missing',
        new Date('2026-09-01'),
        'reason ten chars plus',
        'u',
        'OWNER',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('BACKWARD direction rejected for non-OWNER', async () => {
    await expect(
      service.adjustShopWarranty(
        'c-1',
        new Date('2026-07-01'), // earlier than current 2026-08-01
        'customer handover delayed — correcting end date',
        'u',
        'BRANCH_MANAGER',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('BACKWARD allowed by OWNER — writes audit direction=BACKWARD (≤ 7 days, no co-approver needed)', async () => {
    // Default mock: oldEnd = 2026-08-01. Shorten by 5 days = within single-approver threshold.
    await service.adjustShopWarranty(
      'c-1',
      new Date('2026-07-27'),
      'fix data-entry error from activation',
      'u-owner',
      'OWNER',
    );
    const auditArgs = prisma.warrantyAuditLog.create.mock.calls[0][0];
    expect(auditArgs.data.direction).toBe('BACKWARD');
    expect(auditArgs.data.reason).toContain('fix data-entry');
  });

  it('FORWARD allowed for BRANCH_MANAGER — writes audit direction=FORWARD', async () => {
    await service.adjustShopWarranty(
      'c-1',
      new Date('2026-12-01'), // later than current
      'customer bought extended warranty add-on',
      'u-bm',
      'BRANCH_MANAGER',
    );
    const auditArgs = prisma.warrantyAuditLog.create.mock.calls[0][0];
    expect(auditArgs.data.direction).toBe('FORWARD');
  });

  it('INITIAL direction when oldEnd was null', async () => {
    prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(null));
    await service.adjustShopWarranty(
      'c-1',
      new Date('2026-12-01'),
      'manual warranty set for legacy contract',
      'u-owner',
      'OWNER',
    );
    const auditArgs = prisma.warrantyAuditLog.create.mock.calls[0][0];
    expect(auditArgs.data.direction).toBe('INITIAL');
    expect(auditArgs.data.oldEndDate).toBeNull();
  });

  it('FORWARD adjustment rejected for SALES (not in allowed list)', async () => {
    await expect(
      service.adjustShopWarranty(
        'c-1',
        new Date('2026-12-01'),
        'attempting unauthorized forward change',
        'u-sales',
        'SALES',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── T5-C13: atomic audit + second approver on backward > 7 days ──────────
  describe('T5-C13 — atomic audit + backward > 7 days co-approval', () => {
    it('FORWARD one-person OK — update + single audit row inside one $transaction', async () => {
      prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(new Date('2026-08-01')));

      await service.adjustShopWarranty(
        'c-1',
        new Date('2026-09-01'),
        'extend warranty per customer agreement',
        'u-bm',
        'BRANCH_MANAGER',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Transaction received an array of writes: contract.update + audit.create
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(ops)).toBe(true);
      expect(prisma.warrantyAuditLog.create).toHaveBeenCalledTimes(1);
      // No second-approver auditLog row needed
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('BACKWARD ≤ 7 days one-person OK by OWNER — no second approver required', async () => {
      // oldEnd = 2026-08-10, newEnd = 2026-08-05 → 5 days shortened
      prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(new Date('2026-08-10')));

      await service.adjustShopWarranty(
        'c-1',
        new Date('2026-08-05'),
        'customer swapped phones earlier than expected',
        'u-owner',
        'OWNER',
      );

      expect(prisma.warrantyAuditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      // audit row still gets direction=BACKWARD
      const row = prisma.warrantyAuditLog.create.mock.calls[0][0];
      expect(row.data.direction).toBe('BACKWARD');
    });

    it('BACKWARD > 7 days requires second approver — missing throws 400', async () => {
      prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(new Date('2026-08-30')));

      await expect(
        service.adjustShopWarranty(
          'c-1',
          new Date('2026-08-01'), // 29 days shortened
          'major data-entry correction — reshipping warranty terms',
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.warrantyAuditLog.create).not.toHaveBeenCalled();
    });

    it('BACKWARD > 7 days with self-approval (same user) throws 400', async () => {
      prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(new Date('2026-08-30')));

      await expect(
        service.adjustShopWarranty(
          'c-1',
          new Date('2026-08-01'),
          'ten-plus day correction — must have two-person signoff',
          'u-owner',
          'OWNER',
          { secondApproverId: 'u-owner' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('BACKWARD > 7 days with different second approver writes co-approval audit row', async () => {
      prisma.contract.findUnique.mockResolvedValue(contractWithWarranty(new Date('2026-08-30')));

      await service.adjustShopWarranty(
        'c-1',
        new Date('2026-08-01'), // 29 days backward
        'ten-plus day correction — two-person signoff required',
        'u-owner',
        'OWNER',
        { secondApproverId: 'u-cfo' },
      );

      // Both writes inside ONE $transaction (atomicity)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.warrantyAuditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

      const coApproval = prisma.auditLog.create.mock.calls[0][0];
      expect(coApproval.data.userId).toBe('u-cfo');
      expect(coApproval.data.action).toBe('WARRANTY_BACKWARD_SECOND_APPROVAL');
      expect(coApproval.data.newValue.primaryUserId).toBe('u-owner');
    });
  });
});

// ─── PR 3 Task 5 — getExpiringWarranties: รวมลูกค้าขายสด (Sale) กับสัญญาผ่อน (Contract) ───
describe('WarrantyService.getExpiringWarranties', () => {
  let service: WarrantyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const NOW = new Date('2026-09-25T00:00:00.000Z');
  const PLUS_3D = new Date('2026-09-28T00:00:00.000Z'); // ภายใน daysAhead=7

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      sale: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new WarrantyService(prisma as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // (a) — Sale ขายสด shopWarrantyEndDate = now+3d (มี lineIdShop) → source:'SALE';
  // Contract เดิมยังอยู่ source:'CONTRACT'; Sale ที่ contractId ไม่ null ไม่ถูกนับซ้ำ
  it('(a) รวม Sale ขายสดประกันร้านใกล้หมด (source SALE) + Contract เดิม (source CONTRACT); กรอง contractId:null ที่ query เอง', async () => {
    const cashSale = {
      id: 'sale-cash-1',
      contractId: null,
      shopWarrantyEndDate: PLUS_3D,
      product: { name: 'iPhone 14', brand: 'Apple', model: '14', storage: '256GB' },
      customer: { id: 'cust-sale', name: 'ลูกค้าขายสด', lineIdShop: 'U-sale' },
    };
    const installmentSale = {
      id: 'sale-installment-1',
      contractId: 'contract-xyz',
      shopWarrantyEndDate: PLUS_3D,
      product: { name: 'iPhone 15', brand: 'Apple', model: '15', storage: '128GB' },
      customer: { id: 'cust-other', name: 'ลูกค้าอื่น', lineIdShop: 'U-other' },
    };
    const contractRow = {
      id: 'contract-1',
      shopWarrantyEndDate: PLUS_3D,
      product: { name: 'iPhone 13', brand: 'Apple', model: '13', storage: '128GB' },
      customer: { id: 'cust-contract', name: 'ลูกค้าสัญญา', lineIdShop: 'U-contract' },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.sale.findMany.mockImplementation(async ({ where }: any) => {
      expect(where.deletedAt).toBeNull();
      expect(where.contractId).toBeNull();
      if (!where.shopWarrantyEndDate) return [];
      // จำลองพฤติกรรมจริงของ DB: where.contractId: null กรอง installmentSale ออก
      return [cashSale, installmentSale].filter((s) => s.contractId === where.contractId);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.contract.findMany.mockImplementation(async ({ where }: any) => {
      if (where.shopWarrantyEndDate) return [contractRow];
      return [];
    });

    const result = await service.getExpiringWarranties(7);

    // ห้ามมี Sale ที่ contractId ไม่ null หลุดเข้ามา
    expect(result.some((i) => i.sourceId === 'sale-installment-1')).toBe(false);

    const saleItem = result.find((i) => i.source === 'SALE' && i.sourceId === 'sale-cash-1');
    expect(saleItem).toMatchObject({
      type: 'shop',
      source: 'SALE',
      sourceId: 'sale-cash-1',
      customerId: 'cust-sale',
      customerName: 'ลูกค้าขายสด',
      deviceName: 'Apple 14 256GB',
      daysRemaining: 3,
      lineIdShop: 'U-sale',
    });
    expect(saleItem!.expireDate).toEqual(PLUS_3D);
    expect(saleItem!.contractId).toBeUndefined();

    const contractItem = result.find((i) => i.source === 'CONTRACT' && i.sourceId === 'contract-1');
    expect(contractItem).toMatchObject({
      type: 'shop',
      source: 'CONTRACT',
      sourceId: 'contract-1',
      contractId: 'contract-1',
      customerId: 'cust-contract',
      deviceName: 'Apple 13 128GB',
      lineIdShop: 'U-contract',
    });
  });

  it('รวมประกันศูนย์ของลูกค้าขายสด (source SALE, type manufacturer)', async () => {
    const cashSaleMfg = {
      id: 'sale-mfg-1',
      contractId: null,
      product: {
        name: 'iPhone 15',
        brand: 'Apple',
        model: '15',
        storage: '128GB',
        warrantyExpireDate: PLUS_3D,
      },
      customer: { id: 'cust-mfg', name: 'ลูกค้ามือถือใหม่', lineIdShop: 'U-mfg' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.sale.findMany.mockImplementation(async ({ where }: any) => {
      if (where.product?.warrantyExpireDate) return [cashSaleMfg];
      return [];
    });

    const result = await service.getExpiringWarranties(7);

    const item = result.find((i) => i.source === 'SALE' && i.type === 'manufacturer');
    expect(item).toMatchObject({
      sourceId: 'sale-mfg-1',
      customerId: 'cust-mfg',
      deviceName: 'Apple 15 128GB',
      lineIdShop: 'U-mfg',
    });
    expect(item!.expireDate).toEqual(PLUS_3D);
  });

  it('customer ไม่มี lineIdShop → item.lineIdShop เป็น null (ไม่ throw)', async () => {
    const contractRow = {
      id: 'contract-2',
      shopWarrantyEndDate: PLUS_3D,
      product: { name: 'iPhone 13', brand: 'Apple', model: '13', storage: null },
      customer: { id: 'cust-2', name: 'ลูกค้าไม่ผูกไลน์', lineIdShop: null },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.contract.findMany.mockImplementation(async ({ where }: any) => {
      if (where.shopWarrantyEndDate) return [contractRow];
      return [];
    });

    const result = await service.getExpiringWarranties(7);
    const item = result.find((i) => i.sourceId === 'contract-2');
    expect(item?.lineIdShop).toBeNull();
  });
});
