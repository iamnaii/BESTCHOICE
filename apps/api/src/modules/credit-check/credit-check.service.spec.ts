import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreditCheckService } from './credit-check.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('CreditCheckService override audit', () => {
  let service: CreditCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationConfig: any;

  const baseCheck = {
    id: 'cc-1',
    contractId: 'con-1',
    status: 'REJECTED',
    aiScore: 35,
    originalStatus: null,
    originalScore: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      creditCheck: {
        findUnique: jest.fn().mockResolvedValue(baseCheck),
        update: jest.fn((args) => Promise.resolve({ id: 'cc-1', ...args.data })),
      },
    };
    integrationConfig = { getValue: jest.fn().mockResolvedValue(null) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CreditCheckService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = mod.get(CreditCheckService);
  });

  it('throws NotFound when credit check missing', async () => {
    prisma.creditCheck.findUnique.mockResolvedValue(null);
    await expect(
      service.override('con-missing', {
        status: 'APPROVED',
        overrideReason: 'lorem ipsum valid',
      }, 'u-1', 'OWNER'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects REJECTED → APPROVED override by BRANCH_MANAGER', async () => {
    await expect(
      service.override('con-1', {
        status: 'APPROVED',
        overrideReason: 'customer provided additional income proof',
      }, 'u-1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.creditCheck.update).not.toHaveBeenCalled();
  });

  it('allows REJECTED → APPROVED by OWNER and captures original state + reason', async () => {
    await service.override('con-1', {
      status: 'APPROVED',
      overrideReason: 'customer produced additional salary slip from second job',
    }, 'u-owner', 'OWNER');

    const data = prisma.creditCheck.update.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.originalStatus).toBe('REJECTED');
    expect(data.originalScore).toBe(35);
    expect(data.overriddenById).toBe('u-owner');
    expect(data.overrideReason).toContain('salary slip');
    expect(data.overriddenAt).toBeInstanceOf(Date);
  });

  it('allows REJECTED → APPROVED by FINANCE_MANAGER', async () => {
    await service.override('con-1', {
      status: 'APPROVED',
      overrideReason: 'manager review — employer confirmed salary verbally',
    }, 'u-fm', 'FINANCE_MANAGER');
    expect(prisma.creditCheck.update).toHaveBeenCalled();
  });

  it('allows MANUAL_REVIEW → APPROVED by BRANCH_MANAGER (lower risk)', async () => {
    prisma.creditCheck.findUnique.mockResolvedValue({
      ...baseCheck,
      status: 'MANUAL_REVIEW',
      aiScore: 52,
    });
    await service.override('con-1', {
      status: 'APPROVED',
      overrideReason: 'reviewed with customer — debts paid off',
    }, 'u-bm', 'BRANCH_MANAGER');
    expect(prisma.creditCheck.update).toHaveBeenCalled();
  });

  it('rejects no-op override (same status)', async () => {
    prisma.creditCheck.findUnique.mockResolvedValue({
      ...baseCheck,
      status: 'APPROVED',
    });
    await expect(
      service.override('con-1', {
        status: 'APPROVED',
        overrideReason: 'no-op change',
      }, 'u-1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('preserves originalStatus across repeat overrides (first override wins)', async () => {
    prisma.creditCheck.findUnique.mockResolvedValue({
      ...baseCheck,
      status: 'APPROVED', // already overridden once from REJECTED
      originalStatus: 'REJECTED',
      originalScore: 35,
    });
    await service.override('con-1', {
      status: 'MANUAL_REVIEW',
      overrideReason: 'reconsider on new info',
    }, 'u-owner', 'OWNER');

    const data = prisma.creditCheck.update.mock.calls[0][0].data;
    // Still REJECTED / 35 — we don't lose the AI's original verdict
    expect(data.originalStatus).toBe('REJECTED');
    expect(data.originalScore).toBe(35);
  });
});
