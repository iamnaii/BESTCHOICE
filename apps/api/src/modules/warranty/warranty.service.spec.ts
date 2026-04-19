import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

  it('BACKWARD allowed by OWNER — writes audit direction=BACKWARD', async () => {
    await service.adjustShopWarranty(
      'c-1',
      new Date('2026-07-01'),
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
});
