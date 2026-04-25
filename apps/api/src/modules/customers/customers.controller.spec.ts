import { Test } from '@nestjs/testing';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPreCheckService } from './customer-precheck.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

describe('CustomersController PII (Phase 5)', () => {
  let controller: CustomersController;
  let service: { findOne: jest.Mock; findAll: jest.Mock; search: jest.Mock };
  let piiAudit: { logDecryption: jest.Mock };
  let tierService: CustomerTierService;
  let preCheckService: CustomerPreCheckService;

  beforeEach(async () => {
    service = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      search: jest.fn(),
    };
    piiAudit = { logDecryption: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        { provide: CustomersService, useValue: service },
        { provide: PiiAuditService, useValue: piiAudit },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        { provide: CustomerPreCheckService, useValue: { runPreCheck: jest.fn() } },
        { provide: SkipTracingService, useValue: {} },
        { provide: CustomerInsightsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CustomersController);
    tierService = module.get(CustomerTierService);
    preCheckService = module.get(CustomerPreCheckService);
  });

  const reqOf = (role: string) =>
    ({
      user: { id: 'u1', role },
      ip: '1.2.3.4',
      headers: { 'user-agent': 'jest' },
    }) as any;

  it('masks nationalId for SALES role on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123', phone: '0812345678' });
    const result = await controller.findOne('c1', reqOf('SALES'));
    expect((result as any).nationalId).toBe('12345-XXXXX-XX-3');
    expect((result as any).phone).toBe('0812345678'); // not masked per Q1 matrix
  });

  it('returns full nationalId for OWNER on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    const result = await controller.findOne('c1', reqOf('OWNER'));
    expect((result as any).nationalId).toBe('1234567890123');
  });

  it('logs PII_DECRYPT_MASKED for SALES on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    await controller.findOne('c1', reqOf('SALES'));
    // Wait microtask for void this.piiAudit.logDecryption to fire
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: true, role: 'SALES', userId: 'u1' }),
    );
  });

  it('logs PII_DECRYPT_FULL for OWNER on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    await controller.findOne('c1', reqOf('OWNER'));
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: false, role: 'OWNER' }),
    );
  });

  it('masks list response for SALES on findAll', async () => {
    service.findAll.mockResolvedValue({
      data: [
        { id: 'c1', nationalId: '1234567890123', phone: '0812345678' },
        { id: 'c2', nationalId: '1234567890124', phone: '0823456789' },
      ],
      total: 2,
      page: 1,
      limit: 50,
    });
    const result = await controller.findAll(
      { page: 1, limit: 50 } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reqOf('SALES'),
    );
    expect((result.data[0] as any).nationalId).toBe('12345-XXXXX-XX-3');
    expect((result.data[1] as any).nationalId).toBe('12345-XXXXX-XX-4');
    expect((result.data[0] as any).phone).toBe('0812345678');
  });

  it('returns null gracefully on findOne when customer not found', async () => {
    service.findOne.mockResolvedValue(null);
    const result = await controller.findOne('nope', reqOf('SALES'));
    expect(result).toBeNull();
  });

  describe('GET /customers/:id/tier', () => {
    it('returns tier response from service', async () => {
      const mockResp = {
        customerId: 'cust-1',
        tier: 'GOLD' as const,
        reasons: [{ code: 'GOLD', message: 'x' }],
        history: {
          totalContracts: 3, closedContracts: 3, activeContracts: 0,
          onTimePaymentPct: 100, onTimePayments: 36, latePayments: 0,
          maxOverdueDays: 0, currentOutstanding: 0,
          hasBadDebt: false, hasRepossession: false,
        },
      };
      const tierSpy = jest.spyOn(tierService, 'getCustomerTier').mockResolvedValue(mockResp);
      const result = await controller.getTier('cust-1');
      expect(tierSpy).toHaveBeenCalledWith('cust-1');
      expect(result.tier).toBe('GOLD');
    });
  });

  describe('POST /customers/pre-check', () => {
    it('delegates to service with body', async () => {
      const mockResp = {
        customerId: 'cust-1',
        isNewCustomer: true,
        tier: 'NEW' as const,
        decision: 'REVIEW' as const,
        reasons: [],
      };
      const spy = jest.spyOn(preCheckService, 'runPreCheck').mockResolvedValue(mockResp);
      const body = { nationalId: '1234567890123', phone: '0812345678' };
      const result = await controller.preCheck(body);
      expect(spy).toHaveBeenCalledWith(body);
      expect(result.decision).toBe('REVIEW');
    });
  });
});
