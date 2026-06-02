import { Test } from '@nestjs/testing';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('BLACKLIST always FAIL', () => {
    expect(service.decideOutcome('BLACKLIST', undefined).decision).toBe('FAIL');
  });
  it('RISKY always REVIEW', () => {
    expect(service.decideOutcome('RISKY', 80).decision).toBe('REVIEW');
  });
  it('GOLD always PASS — even without AI', () => {
    expect(service.decideOutcome('GOLD', undefined).decision).toBe('PASS');
  });
  it('GOOD with AI >= 50 PASS', () => {
    expect(service.decideOutcome('GOOD', 65).decision).toBe('PASS');
  });
  it('GOOD with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('GOOD', 45).decision).toBe('REVIEW');
  });
  it('GOOD with AI < 40 FAIL', () => {
    expect(service.decideOutcome('GOOD', 35).decision).toBe('FAIL');
  });
  it('GOOD without AI PASS', () => {
    expect(service.decideOutcome('GOOD', undefined).decision).toBe('PASS');
  });
  it('NEW with AI >= 50 PASS', () => {
    expect(service.decideOutcome('NEW', 60).decision).toBe('PASS');
  });
  it('NEW with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('NEW', 45).decision).toBe('REVIEW');
  });
  it('NEW with AI < 40 FAIL', () => {
    expect(service.decideOutcome('NEW', 30).decision).toBe('FAIL');
  });
  it('NEW without AI REVIEW', () => {
    expect(service.decideOutcome('NEW', undefined).decision).toBe('REVIEW');
  });
  it('NEW without AI + no statement → "ยังไม่มี statement" reason', () => {
    const result = service.decideOutcome('NEW', undefined, false);
    expect(result.decision).toBe('REVIEW');
    expect(result.reasons[0].code).toBe('NEW_NO_DATA');
    expect(result.reasons[0].message).toContain('ยังไม่มี statement');
  });
  it('NEW without AI + has statement → "แนบ statement แล้ว" reason (no contradiction)', () => {
    const result = service.decideOutcome('NEW', undefined, true);
    expect(result.decision).toBe('REVIEW');
    expect(result.reasons[0].code).toBe('NEW_PENDING_REVIEW');
    expect(result.reasons[0].message).toContain('แนบ statement แล้ว');
    // Must NOT claim "no statement" when one was uploaded.
    expect(result.reasons[0].message).not.toContain('ยังไม่มี statement');
  });
});

describe('CustomerPreCheckService — runPreCheck soft-delete revival', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      creditCheck: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      // Pass-through transaction so tests exercise the same prisma mocks.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const tierService = {
      getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: tierService },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('revives a soft-deleted customer with the same nationalId instead of throwing P2002', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-dead',
      deletedAt: new Date('2026-04-22'),
    });

    const result = await service.runPreCheck({
      nationalId: '1234567890123',
      phone: '0812345678',
    });

    // Must NOT call create() — that's the line that blows up with P2002
    expect(prisma.customer.create).not.toHaveBeenCalled();
    // Must clear deletedAt so the customer is usable again
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-dead' },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(result.customerId).toBe('cust-dead');
    expect(result.isNewCustomer).toBe(false);
  });

  it('creates a fresh customer when no row exists at all', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.create.mockResolvedValue({ id: 'cust-new' });

    const result = await service.runPreCheck({
      nationalId: '2222222222222',
      phone: '0898765432',
    });

    expect(prisma.customer.create).toHaveBeenCalled();
    expect(result.customerId).toBe('cust-new');
    expect(result.isNewCustomer).toBe(true);
  });

  it('uses the active customer without touching update() when one already exists', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-live',
      deletedAt: null,
    });

    const result = await service.runPreCheck({
      nationalId: '3333333333333',
      phone: '0811111111',
    });

    expect(prisma.customer.create).not.toHaveBeenCalled();
    // update() is still called at the end of runPreCheck to set creditCheckStatus,
    // so assert we did NOT try to clear deletedAt (the revive-only path).
    const updateCalls = prisma.customer.update.mock.calls;
    expect(
      updateCalls.every((call: [unknown]) => !('deletedAt' in (call[0] as { data: object }).data)),
    ).toBe(true);
    expect(result.customerId).toBe('cust-live');
    expect(result.isNewCustomer).toBe(false);
  });

  // ─── PRE-check idempotency (covers cross-instance / cache-miss races) ────
  it('reuses a recent PRE credit check instead of creating a duplicate', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-x', deletedAt: null });
    prisma.creditCheck.findFirst.mockResolvedValue({ id: 'cc-recent', aiScore: null });

    // Fresh instance so the in-memory cache is empty — forces DB check path.
    const fresh = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: {
            getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }),
          },
        },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    const svc = fresh.get(CustomerPreCheckService);

    const result = await svc.runPreCheck({
      nationalId: '4444444444444',
      phone: '0820000000',
      bankName: 'KBANK',
      statementFiles: ['data:image/png;base64,xxx'],
    });

    expect(prisma.creditCheck.create).not.toHaveBeenCalled();
    expect(result.creditCheckId).toBe('cc-recent');
  });

  it('creates a new PRE credit check when no recent duplicate exists', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-y', deletedAt: null });
    prisma.creditCheck.findFirst.mockResolvedValue(null);
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-new', aiScore: null });

    const fresh = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: {
            getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }),
          },
        },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    const svc = fresh.get(CustomerPreCheckService);

    const result = await svc.runPreCheck({
      nationalId: '5555555555555',
      phone: '0833333333',
      bankName: 'SCB',
      statementFiles: ['data:image/png;base64,yyy'],
    });

    expect(prisma.creditCheck.create).toHaveBeenCalledTimes(1);
    expect(result.creditCheckId).toBe('cc-new');
    const findFirstCall = prisma.creditCheck.findFirst.mock.calls[0][0];
    expect(findFirstCall.where.checkType).toBe('PRE');
    expect(findFirstCall.where.bankName).toBe('SCB');
    expect(findFirstCall.where.deletedAt).toBeNull();
  });

  // ─── abandonPreCheck — refuse to delete real customer rows ──────────────
  it('abandons a placeholder customer with no contracts', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-placeholder',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 0 },
    });

    const result = await service.abandonPreCheck('cust-placeholder');

    expect(result.deleted).toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-placeholder' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('refuses to abandon if name was changed (full intake completed)', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-real',
      name: 'สมชาย ใจดี',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 0 },
    });

    const result = await service.abandonPreCheck('cust-real');

    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('refuses to abandon if any contracts exist', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-with-contract',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 1 },
    });

    const result = await service.abandonPreCheck('cust-with-contract');

    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('refuses to abandon if creditCheckStatus is no longer UNDER_REVIEW', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-approved',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'APPROVED',
      _count: { contracts: 0 },
    });

    const result = await service.abandonPreCheck('cust-approved');

    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('returns {deleted:false} silently if customer does not exist (already removed)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    const result = await service.abandonPreCheck('cust-gone');

    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('wraps creditCheck create + customer.creditCheckStatus update in one $transaction (no drift on failure)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-tx', deletedAt: null });
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-tx', aiScore: null });

    const fresh = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: {
            getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }),
          },
        },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    const svc = fresh.get(CustomerPreCheckService);

    await svc.runPreCheck({
      nationalId: '6666666666666',
      phone: '0844444444',
      bankName: 'BBL',
      statementFiles: ['data:image/png;base64,zzz'],
    });

    // The transaction should have been invoked once covering both writes.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.creditCheck.create).toHaveBeenCalledTimes(1);
    // customer.update was called via the pass-through tx proxy — verifies the
    // creditCheckStatus write is inside the same transactional boundary.
    const statusUpdateCall = prisma.customer.update.mock.calls.find(
      (call: [{ data: { creditCheckStatus?: string } }]) => call[0].data.creditCheckStatus !== undefined,
    );
    expect(statusUpdateCall).toBeDefined();
  });
});

// ─── Test-mode bypass (Task 3) ──────────────────────────────────────────────
describe('CustomerPreCheckService — test-mode bypass', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let testMode: { isEnabled: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      creditCheck: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    testMode = { isEnabled: jest.fn() };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          // If the bypass ever falls through to the real logic, this throws
          // loudly so the test can't accidentally pass via real checks.
          useValue: {
            getCustomerTier: jest.fn(() => {
              throw new Error('real precheck must NOT run when test-mode is ON');
            }),
          },
        },
        { provide: TestModeService, useValue: testMode },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('returns PASS + TEST_MODE_BYPASS reason WITHOUT running real checks when test-mode is ON', async () => {
    testMode.isEnabled.mockResolvedValue(true);

    const result = await service.runPreCheck({
      nationalId: '1111111111111',
      phone: '0810000000',
    });

    expect(result.decision).toBe('PASS');
    expect(result.reasons.map((r) => r.code)).toContain('TEST_MODE_BYPASS');
    // No real-check side effects — no DB reads/writes, no tier lookup.
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes a CREDIT_PRECHECK_BYPASSED_TEST_MODE audit marker when bypassing', async () => {
    testMode.isEnabled.mockResolvedValue(true);

    await service.runPreCheck(
      { nationalId: '2222222222222', phone: '0820000000' },
      { userId: 'user-1', ipAddress: '127.0.0.1' },
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREDIT_PRECHECK_BYPASSED_TEST_MODE',
        entity: 'customer',
        userId: 'user-1',
      }),
    );
  });

  it('falls through to real logic when test-mode is OFF', async () => {
    testMode.isEnabled.mockResolvedValue(false);
    // Let the real path reach the tier lookup, where the throwing mock proves
    // the bypass did NOT short-circuit.
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-real', deletedAt: null });
    await expect(
      service.runPreCheck({ nationalId: '3333333333333', phone: '0830000000' }),
    ).rejects.toThrow('real precheck must NOT run when test-mode is ON');
    expect(prisma.customer.findFirst).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
