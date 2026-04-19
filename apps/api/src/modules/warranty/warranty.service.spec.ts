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
