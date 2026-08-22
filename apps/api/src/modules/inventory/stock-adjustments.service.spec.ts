import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C3 — 4-eyes on every stock adjustment. The adjuster (userId) and the
 * approver (dto.approverId) must be different people, and the approver must
 * be manager-tier (OWNER / FINANCE_MANAGER / BRANCH_MANAGER). Historical
 * rule that BRANCH_MANAGER could self-approve is removed.
 */
describe('StockAdjustmentsService.create — T5-C3 4-eyes', () => {
  let service: StockAdjustmentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const baseDto = {
    productId: 'p1',
    reason: 'CORRECTION' as const,
    approverId: 'approver-bm',
    notes: 'audit correction',
  };

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'IN_STOCK',
          branchId: 'branch-1',
          deletedAt: null,
        }),
        update: jest.fn(),
      },
      stockAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 'adj-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where: { id } }) =>
          Promise.resolve({
            id,
            role: id.startsWith('approver-bm') ? 'BRANCH_MANAGER'
              : id.startsWith('approver-fm') ? 'FINANCE_MANAGER'
              : id.startsWith('approver-owner') ? 'OWNER'
              : id.startsWith('approver-sales') ? 'SALES'
              : 'SALES',
            isActive: true,
            deletedAt: null,
          }),
        ),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [StockAdjustmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(StockAdjustmentsService);
  });

  it('rejects when approverId is missing', async () => {
    const dto = { ...baseDto, approverId: '' };
    await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects self-approval (adjuster === approver)', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'user-1' }, 'user-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects when approver does not exist', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create({ ...baseDto, approverId: 'ghost' }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when approver is deactivated', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'approver-bm',
      role: 'BRANCH_MANAGER',
      isActive: false,
      deletedAt: null,
    });
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects when approver is not manager-tier (e.g. SALES)', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'approver-sales' }, 'user-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts BRANCH_MANAGER approver for a non-self adjustment', async () => {
    await expect(service.create(baseDto, 'user-1')).resolves.toBeDefined();
    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adjustedById: 'user-1',
          approvedById: 'approver-bm',
          approvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('accepts OWNER approver', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'approver-owner' }, 'user-1'),
    ).resolves.toBeDefined();
  });

  describe('T5-C8: FOUND restoration gates', () => {
    const foundDto = { ...baseDto, reason: 'FOUND' as const };

    it('rejects BRANCH_MANAGER approving FOUND on a DAMAGED product', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'DAMAGED',
        branchId: 'branch-1',
        deletedAt: new Date(),
      });
      await expect(
        service.create({ ...foundDto, approverId: 'approver-bm' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects FINANCE_MANAGER approving FOUND on WRITTEN_OFF product', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'WRITTEN_OFF',
        branchId: 'branch-1',
        deletedAt: new Date(),
      });
      await expect(
        service.create({ ...foundDto, approverId: 'approver-fm' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows OWNER to approve FOUND on DAMAGED', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'DAMAGED',
        branchId: 'branch-1',
        deletedAt: new Date(),
      });
      await expect(
        service.create({ ...foundDto, approverId: 'approver-owner' }, 'user-1'),
      ).resolves.toBeDefined();
      // Restoration stamp applied
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_STOCK',
            restoredFromTerminalAt: expect.any(Date),
          }),
        }),
      );
    });

    it('allows BRANCH_MANAGER to approve FOUND on LOST (not damage fraud pattern)', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'LOST',
        branchId: 'branch-1',
        deletedAt: new Date(),
      });
      await expect(
        service.create({ ...foundDto, approverId: 'approver-bm' }, 'user-1'),
      ).resolves.toBeDefined();
    });

    it('DAMAGED adjustment flips wasPreviouslyDamaged=true', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
      });
      await service.create(
        {
          ...baseDto,
          reason: 'DAMAGED',
          approverId: 'approver-bm',
          photos: ['s3://photos/evidence.jpg'],
        },
        'user-1',
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DAMAGED',
            wasPreviouslyDamaged: true,
          }),
        }),
      );
    });
  });

  // T2-C11 — > 500K THB requires OWNER approver
  describe('T2-C11: high-value adjustments require OWNER', () => {
    it('allows BRANCH_MANAGER approver for adjustment ≤ 500K THB', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
        costPrice: '450000.00',
      });
      await expect(
        service.create({ ...baseDto, approverId: 'approver-bm' }, 'user-1'),
      ).resolves.toBeDefined();
      expect(prisma.stockAdjustment.create).toHaveBeenCalled();
    });

    it('rejects BRANCH_MANAGER approver when value > 500K THB', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
        costPrice: '650000.00',
      });
      await expect(
        service.create({ ...baseDto, approverId: 'approver-bm' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
    });

    it('allows OWNER approver when value > 500K THB', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
        costPrice: '650000.00',
      });
      await expect(
        service.create({ ...baseDto, approverId: 'approver-owner' }, 'user-1'),
      ).resolves.toBeDefined();
      expect(prisma.stockAdjustment.create).toHaveBeenCalled();
    });
  });

  // T5-C14 — DAMAGED requires photos
  describe('T5-C14: DAMAGED photo gate', () => {
    const damagedBase = {
      productId: 'p1',
      reason: 'DAMAGED' as const,
      approverId: 'approver-bm',
      notes: 'screen cracked',
    };

    it('rejects DAMAGED without photos', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
        costPrice: '10000.00',
      });
      await expect(service.create(damagedBase, 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
    });

    it('accepts DAMAGED with non-empty photos array', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'IN_STOCK',
        branchId: 'branch-1',
        deletedAt: null,
        costPrice: '10000.00',
      });
      await expect(
        service.create(
          { ...damagedBase, photos: ['s3://photos/damage-1.jpg'] },
          'user-1',
        ),
      ).resolves.toBeDefined();
      expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'DAMAGED',
            photos: ['s3://photos/damage-1.jpg'],
          }),
        }),
      );
    });
  });
});

/**
 * Phase 5 fix round 2 [Important 1] — `FOUND` เป็นอีกประตูที่ตั้ง `IN_STOCK` ตรง ๆ
 * ("พบของหาย") — เครื่องมือสองที่รับคืน (REFURBISHED) ต้องไม่ลัดเข้าคลังทางนี้
 * เพราะข้ามด่านยืนยันราคาของปุ่ม "นำเข้าคลังพร้อมขาย"
 */
describe('StockAdjustmentsService.create — FOUND ต้องไม่ปลุกเครื่อง REFURBISHED (Phase 5 fix round 2)', () => {
  let service: StockAdjustmentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const foundDto = {
    productId: 'p1',
    reason: 'FOUND' as const,
    approverId: 'approver-bm',
    notes: 'พบเครื่องในตู้เซฟ',
  };

  const setStatus = (status: string) =>
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      status,
      branchId: 'branch-1',
      costPrice: '10000',
      deletedAt: status === 'REFURBISHED' ? null : new Date(),
    });

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      stockAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 'adj-1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'approver-bm',
          role: 'BRANCH_MANAGER',
          isActive: true,
          deletedAt: null,
        }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [StockAdjustmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<StockAdjustmentsService>(StockAdjustmentsService);
  });

  it('FOUND บนเครื่อง REFURBISHED → reject + ชี้ไปที่ปุ่มนำเข้าคลังพร้อมขาย', async () => {
    setStatus('REFURBISHED');

    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(BadRequestException);
    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(/นำเข้าคลังพร้อมขาย/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('FOUND บนเครื่องที่หายไปจริง (LOST) → ยังทำได้ตามเดิม', async () => {
    setStatus('LOST');

    await expect(service.create(foundDto, 'adjuster-1')).resolves.toBeDefined();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IN_STOCK' }) }),
    );
  });
});

/**
 * Phase 5 fix round 3 [Important 1] — `FOUND` เป็น **allow-list** ไม่ใช่ deny ทีละสถานะ
 *
 * รอบ 2 ปฏิเสธเฉพาะ `REFURBISHED` แต่ `repossessions.service.ts` ตั้ง `REPOSSESSED`
 * ตอนยึด (REFURBISHED มาทีหลังตอน markReadyForSale) ⇒ เครื่องยึดที่ยังถือราคาขายเดิม
 * flip เข้า IN_STOCK ได้ด้วย "พบของ" โดยไม่เช็คราคา ไม่มี audit — ทั้งที่ปุ่มนำเข้าคลัง
 * ปฏิเสธมัน. ผลพลอยได้: ปิด `SOLD_INSTALLMENT → IN_STOCK` ที่เปิดอยู่แต่เดิมด้วย
 *
 * `FOUND` = "พบของที่หายไป" ⇒ พา IN_STOCK ได้เฉพาะกลุ่มของหาย/ของเสีย
 * (LOST / DAMAGED / WRITTEN_OFF) — สถานะอื่นที่ถูก soft-delete ยัง "กู้แถวคืน" ได้
 * แต่กลับไปสถานะเดิมของมัน ไม่ใช่ IN_STOCK
 */
describe('StockAdjustmentsService.create — FOUND allow-list (Phase 5 fix round 3)', () => {
  let service: StockAdjustmentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const foundDto = {
    productId: 'p1',
    reason: 'FOUND' as const,
    approverId: 'approver-owner',
    notes: 'พบเครื่องในตู้เซฟ',
  };

  const setProduct = (status: string, deleted: boolean) =>
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      status,
      branchId: 'branch-1',
      costPrice: '10000',
      deletedAt: deleted ? new Date() : null,
    });

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      stockAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adj-1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'approver-owner',
          role: 'OWNER',
          isActive: true,
          deletedAt: null,
        }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [StockAdjustmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<StockAdjustmentsService>(StockAdjustmentsService);
  });

  it.each([
    ['LOST', true],
    ['DAMAGED', true],
    ['WRITTEN_OFF', true],
  ])('%s → พาเข้า IN_STOCK ได้ตามเดิม (กลุ่มของหาย/ของเสีย)', async (status, deleted) => {
    setProduct(status, deleted as boolean);

    await expect(service.create(foundDto, 'adjuster-1')).resolves.toBeDefined();
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK', deletedAt: null }),
      }),
    );
  });

  it('REPOSSESSED (ยึดมา ยังถือราคาขายเดิม) → reject ชี้ flow ยึดเครื่อง ไม่ flip เข้า IN_STOCK', async () => {
    setProduct('REPOSSESSED', false);

    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(BadRequestException);
    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(/ยึดเครื่อง/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('SOLD_INSTALLMENT → reject (เครื่องที่สัญญายังถืออยู่ ห้ามคืนเข้าสต็อกด้วย "พบของ")', async () => {
    setProduct('SOLD_INSTALLMENT', false);

    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(BadRequestException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it.each(['PO_RECEIVED', 'QC_PENDING', 'PHOTO_PENDING', 'INSPECTION', 'RESERVED', 'SOLD_CASH', 'SOLD_RESELL', 'DEFECT_RETURN'])(
    '%s → reject (ไม่ใช่ของหาย/ของเสีย — มี flow ของตัวเอง)',
    async (status) => {
      setProduct(status, false);
      await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    },
  );

  it('REFURBISHED (ยังไม่ถูกลบ) → reject ชี้ไปที่ปุ่มนำเข้าคลังพร้อมขาย (พฤติกรรมรอบ 2)', async () => {
    setProduct('REFURBISHED', false);

    await expect(service.create(foundDto, 'adjuster-1')).rejects.toThrow(/นำเข้าคลังพร้อมขาย/);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  /**
   * nit รอบ 3 — allow-list จะปิดทางกู้เครื่อง REFURBISHED ที่ถูก soft-delete
   * (ทางเดียวที่มีในระบบ) ⇒ กู้แถวคืนได้ แต่กลับไปสถานะเดิมของมัน ไม่ใช่ IN_STOCK
   * (ยังต้องผ่านปุ่มนำเข้าคลังพร้อมขาย = ยืนยันราคา อยู่ดี)
   */
  it('REFURBISHED ที่ถูก soft-delete → กู้แถวคืนโดยไม่แตะสถานะ (ไม่ใช่ IN_STOCK, ไม่ตั้ง stockInDate)', async () => {
    setProduct('REFURBISHED', true);

    await expect(service.create(foundDto, 'adjuster-1')).resolves.toBeDefined();
    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBeUndefined(); // ไม่แตะสถานะ = คงเป็น REFURBISHED ตามเดิม
    expect(data.stockInDate).toBeUndefined();
  });

  it('SOLD_INSTALLMENT ที่ถูก soft-delete → กู้แถวคืนโดยไม่แตะสถานะ (ไม่ปลุกเข้าคลัง)', async () => {
    setProduct('SOLD_INSTALLMENT', true);

    await expect(service.create(foundDto, 'adjuster-1')).resolves.toBeDefined();
    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBeUndefined(); // ไม่แตะสถานะ = คงเป็น SOLD_INSTALLMENT ตามเดิม
  });
});
