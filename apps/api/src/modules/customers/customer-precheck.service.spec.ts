import { Test } from '@nestjs/testing';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomersService } from './customers.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';

// Shared placeholder-customer helper mock. The lookup/create/revive logic now
// lives in CustomersService.findOrCreatePrecheckCustomer (so the pre-check path
// shares create()'s nationalIdHash + Contact dedup — see that helper's spec for
// the dedup behavior). Here we only assert pre-check DELEGATES to it.
function customersServiceMock(ret: { id: string; isNew: boolean } = { id: 'cust-default', isNew: false }) {
  return { findOrCreatePrecheckCustomer: jest.fn().mockResolvedValue(ret) };
}

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
        { provide: CustomersService, useValue: customersServiceMock() },
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
    expect(result.reasons[0].message).not.toContain('ยังไม่มี statement');
  });
});

describe('CustomerPreCheckService — runPreCheck placeholder + credit-check', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let customersService: ReturnType<typeof customersServiceMock>;

  async function build() {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: { getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }) },
        },
        { provide: CustomersService, useValue: customersService },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    return mod.get(CustomerPreCheckService);
  }

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
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    customersService = customersServiceMock({ id: 'cust-default', isNew: false });
    service = await build();
  });

  it('delegates placeholder creation to CustomersService.findOrCreatePrecheckCustomer (shared dedup pipeline)', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-new', isNew: true });

    const result = await service.runPreCheck({ nationalId: '2222222222222', phone: '0898765432' });

    expect(customersService.findOrCreatePrecheckCustomer).toHaveBeenCalledWith({
      nationalId: '2222222222222',
      phone: '0898765432',
    });
    // It must NOT do its own plaintext create/lookup anymore (that was the bug).
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-new');
    expect(result.isNewCustomer).toBe(true);
  });

  it('returns an existing (non-new) customer from the helper', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-live', isNew: false });

    const result = await service.runPreCheck({ nationalId: '3333333333333', phone: '0811111111' });

    expect(result.customerId).toBe('cust-live');
    expect(result.isNewCustomer).toBe(false);
    // The only customer.update is the final creditCheckStatus write — never a
    // deletedAt clear here (revive lives inside the helper now).
    const updateCalls = prisma.customer.update.mock.calls;
    expect(
      updateCalls.every((call: [unknown]) => !('deletedAt' in (call[0] as { data: object }).data)),
    ).toBe(true);
  });

  it('reuses a recent PRE credit check instead of creating a duplicate', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-x', isNew: false });
    prisma.creditCheck.findFirst.mockResolvedValue({ id: 'cc-recent', aiScore: null });
    service = await build(); // fresh instance — empty in-memory cache

    const result = await service.runPreCheck({
      nationalId: '4444444444444',
      phone: '0820000000',
      bankName: 'KBANK',
      statementFiles: ['data:image/png;base64,xxx'],
    });

    expect(prisma.creditCheck.create).not.toHaveBeenCalled();
    expect(result.creditCheckId).toBe('cc-recent');
  });

  it('creates a new PRE credit check when no recent duplicate exists', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-y', isNew: false });
    prisma.creditCheck.findFirst.mockResolvedValue(null);
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-new', aiScore: null });
    service = await build();

    const result = await service.runPreCheck({
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

  it('wraps creditCheck create + customer.creditCheckStatus update in one $transaction (no drift on failure)', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-tx', isNew: false });
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-tx', aiScore: null });
    service = await build();

    await service.runPreCheck({
      nationalId: '6666666666666',
      phone: '0844444444',
      bankName: 'BBL',
      statementFiles: ['data:image/png;base64,zzz'],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.creditCheck.create).toHaveBeenCalledTimes(1);
    const statusUpdateCall = prisma.customer.update.mock.calls.find(
      (call: [{ data: { creditCheckStatus?: string } }]) => call[0].data.creditCheckStatus !== undefined,
    );
    expect(statusUpdateCall).toBeDefined();
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
});

// ─── Test-mode bypass (Task 3) ──────────────────────────────────────────────
describe('CustomerPreCheckService — test-mode bypass', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let testMode: { isEnabled: jest.Mock };
  let audit: { log: jest.Mock };
  let customersService: ReturnType<typeof customersServiceMock>;

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      creditCheck: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    testMode = { isEnabled: jest.fn() };
    audit = { log: jest.fn() };
    customersService = customersServiceMock({ id: 'cust-real', isNew: false });
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: {
            getCustomerTier: jest.fn(() => {
              throw new Error('real precheck must NOT run when test-mode is ON');
            }),
          },
        },
        { provide: CustomersService, useValue: customersService },
        { provide: TestModeService, useValue: testMode },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('returns PASS + TEST_MODE_BYPASS reason WITHOUT running real checks when test-mode is ON', async () => {
    testMode.isEnabled.mockResolvedValue(true);

    const result = await service.runPreCheck({ nationalId: '1111111111111', phone: '0810000000' });

    expect(result.decision).toBe('PASS');
    expect(result.reasons.map((r) => r.code)).toContain('TEST_MODE_BYPASS');
    expect(customersService.findOrCreatePrecheckCustomer).not.toHaveBeenCalled();
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
    // Reaches the placeholder helper, then the throwing tier mock proves the
    // bypass did NOT short-circuit.
    await expect(
      service.runPreCheck({ nationalId: '3333333333333', phone: '0830000000' }),
    ).rejects.toThrow('real precheck must NOT run when test-mode is ON');
    expect(customersService.findOrCreatePrecheckCustomer).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
