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
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', deletedAt: null }),
      },
      creditCheck: {
        findUnique: jest.fn().mockResolvedValue(baseCheck),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cc-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: 'cc-1', ...args.data })),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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
        overrideReason: 'lorem ipsum valid reason 30+ characters',
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
        overrideReason: 'no-op change test 20+ characters',
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
      overrideReason: 'reconsider on new info from customer',
    }, 'u-owner', 'OWNER');

    const data = prisma.creditCheck.update.mock.calls[0][0].data;
    // Still REJECTED / 35 — we don't lose the AI's original verdict
    expect(data.originalStatus).toBe('REJECTED');
    expect(data.originalScore).toBe(35);
  });

  // ─── createForCustomer idempotency (double-click / retry protection) ──────
  describe('createForCustomer — idempotency', () => {
    it('returns existing record if an identical submission landed within 30s', async () => {
      const existing = {
        id: 'cc-existing',
        customerId: 'cust-1',
        bankName: 'ธนาคารกรุงไทย',
        statementMonths: 3,
        createdAt: new Date(Date.now() - 5_000),
        deletedAt: null,
      };
      prisma.creditCheck.findFirst.mockResolvedValue(existing);

      const result = await service.createForCustomer(
        'cust-1',
        { bankName: 'ธนาคารกรุงไทย', statementFiles: [], statementMonths: 3 },
        'u-1',
      );

      expect(result).toBe(existing);
      expect(prisma.creditCheck.create).not.toHaveBeenCalled();
    });

    it('creates new record when no recent duplicate exists', async () => {
      prisma.creditCheck.findFirst.mockResolvedValue(null);

      await service.createForCustomer(
        'cust-1',
        { bankName: 'ธนาคารกรุงไทย', statementFiles: [], statementMonths: 3 },
        'u-1',
      );

      expect(prisma.creditCheck.create).toHaveBeenCalledTimes(1);
      const findFirstArgs = prisma.creditCheck.findFirst.mock.calls[0][0];
      expect(findFirstArgs.where.customerId).toBe('cust-1');
      expect(findFirstArgs.where.bankName).toBe('ธนาคารกรุงไทย');
      expect(findFirstArgs.where.statementMonths).toBe(3);
      expect(findFirstArgs.where.deletedAt).toBeNull();
    });

    it('throws NotFound when customer missing', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.createForCustomer(
          'missing',
          { bankName: null as unknown as string, statementFiles: [] },
          'u-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.creditCheck.create).not.toHaveBeenCalled();
    });
  });

  // ─── findLatestByCustomer: FULL preferred over PRE ────────────────────────
  describe('findLatestByCustomer — FULL preferred over PRE', () => {
    it('returns the latest FULL check even if a newer PRE exists', async () => {
      const fullApproved = { id: 'cc-full', checkType: 'FULL', status: 'APPROVED' };
      prisma.creditCheck.findFirst
        // First call: filtered to FULL — returns the approved one
        .mockResolvedValueOnce(fullApproved)
        // Second call would be the fallback (any type) — should not be hit
        .mockResolvedValueOnce({ id: 'cc-pre', checkType: 'PRE', status: 'MANUAL_REVIEW' });

      const result = await service.findLatestByCustomer('cust-1');

      expect(result).toBe(fullApproved);
      const firstCallWhere = prisma.creditCheck.findFirst.mock.calls[0][0].where;
      expect(firstCallWhere.checkType).toBe('FULL');
      expect(firstCallWhere.deletedAt).toBeNull();
      expect(prisma.creditCheck.findFirst).toHaveBeenCalledTimes(1);
    });

    it('falls back to any-type check when no FULL exists (covers GOLD-tier PRE auto-approve)', async () => {
      const preApproved = { id: 'cc-pre', checkType: 'PRE', status: 'APPROVED' };
      prisma.creditCheck.findFirst
        .mockResolvedValueOnce(null) // no FULL
        .mockResolvedValueOnce(preApproved); // fallback hits PRE

      const result = await service.findLatestByCustomer('cust-2');

      expect(result).toBe(preApproved);
      expect(prisma.creditCheck.findFirst).toHaveBeenCalledTimes(2);
      // Second call should not filter by checkType
      const secondCallWhere = prisma.creditCheck.findFirst.mock.calls[1][0].where;
      expect(secondCallWhere.checkType).toBeUndefined();
    });

    it('returns null when customer has no credit checks', async () => {
      prisma.creditCheck.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.findLatestByCustomer('cust-none');

      expect(result).toBeNull();
    });
  });

  // ─── T4-C4: evidence gate on overrideById() ──────────────────────────────
  describe('T4-C4 overrideById — evidence gate', () => {
    const shortReason = 'too short'; // 9 chars
    const validReason = 'customer produced additional salary slip evidence'; // > 20 chars

    it('persists attachmentIds + reason in audit log on successful override', async () => {
      prisma.creditCheck.findUnique.mockResolvedValue({
        ...baseCheck,
        id: 'cc-42',
        status: 'MANUAL_REVIEW',
      });

      await service.overrideById(
        'cc-42',
        {
          status: 'APPROVED',
          overrideReason: validReason,
          attachmentIds: ['att-1', 'att-2'],
        },
        'u-owner',
        'OWNER',
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREDIT_CHECK_OVERRIDE',
            entity: 'credit_check',
            entityId: 'cc-42',
            userId: 'u-owner',
            newValue: expect.objectContaining({
              overrideReason: validReason,
              attachmentIds: ['att-1', 'att-2'],
            }),
          }),
        }),
      );
    });

    it('allows empty attachmentIds (informational) but still writes audit log', async () => {
      prisma.creditCheck.findUnique.mockResolvedValue({
        ...baseCheck,
        status: 'MANUAL_REVIEW',
      });

      await service.overrideById(
        'cc-1',
        {
          status: 'APPROVED',
          overrideReason: validReason,
          attachmentIds: [],
        },
        'u-fm',
        'FINANCE_MANAGER',
      );

      const audit = prisma.auditLog.create.mock.calls[0][0];
      expect(audit.data.newValue.attachmentIds).toEqual([]);
      expect(prisma.creditCheck.update).toHaveBeenCalled();
    });

    // Note: @MinLength(20) runs at the DTO-validation layer (ValidationPipe)
    // before reaching the service. Service itself accepts short strings but
    // the contract is enforced by class-validator — assert the decorator via
    // metadata rather than calling the service with a short reason.
    it('DTO rejects overrideReason with less than 20 chars via class-validator', async () => {
      const { validate } = await import('class-validator');
      const { OverrideCreditCheckDto } = await import('./dto/credit-check.dto');
      const { plainToInstance } = await import('class-transformer');

      const dto = plainToInstance(OverrideCreditCheckDto, {
        status: 'APPROVED',
        overrideReason: shortReason,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const reasonError = errors.find((e) => e.property === 'overrideReason');
      expect(reasonError).toBeDefined();
      expect(JSON.stringify(reasonError?.constraints)).toContain('20 ตัวอักษร');
    });

    it('DTO accepts overrideReason >= 20 chars and attachmentIds array', async () => {
      const { validate } = await import('class-validator');
      const { OverrideCreditCheckDto } = await import('./dto/credit-check.dto');
      const { plainToInstance } = await import('class-transformer');

      const dto = plainToInstance(OverrideCreditCheckDto, {
        status: 'APPROVED',
        overrideReason: validReason,
        attachmentIds: ['doc-123'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
