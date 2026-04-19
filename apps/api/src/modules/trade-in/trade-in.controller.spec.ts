import { Test } from '@nestjs/testing';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

describe('TradeInController PII (Phase 5)', () => {
  let controller: TradeInController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  let piiAudit: { logDecryption: jest.Mock };

  beforeEach(async () => {
    service = {
      findOne: jest.fn(),
      findAll: jest.fn(),
    };
    piiAudit = { logDecryption: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: service },
        { provide: PiiAuditService, useValue: piiAudit },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TradeInController);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqOf = (role: string): any => ({
    user: { id: 'u1', role },
    ip: '1.2.3.4',
    headers: { 'user-agent': 'jest' },
  });

  // ---------------------------------------------------------------------------
  // findOne masking
  // ---------------------------------------------------------------------------

  it('masks transferAccountNumber for SALES', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    const result = await controller.findOne('t1', reqOf('SALES'));
    expect((result as { transferAccountNumber?: string }).transferAccountNumber).toBe('XXXXXXXX90');
  });

  it('masks transferAccountNumber for BRANCH_MANAGER', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    const result = await controller.findOne('t1', reqOf('BRANCH_MANAGER'));
    expect((result as { transferAccountNumber?: string }).transferAccountNumber).toBe('XXXXXXXX90');
  });

  it('returns full transferAccountNumber for OWNER', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    const result = await controller.findOne('t1', reqOf('OWNER'));
    expect((result as { transferAccountNumber?: string }).transferAccountNumber).toBe('1234567890');
  });

  it('returns full transferAccountNumber for FINANCE_MANAGER', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    const result = await controller.findOne('t1', reqOf('FINANCE_MANAGER'));
    expect((result as { transferAccountNumber?: string }).transferAccountNumber).toBe('1234567890');
  });

  it('returns full transferAccountNumber for ACCOUNTANT', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    const result = await controller.findOne('t1', reqOf('ACCOUNTANT'));
    expect((result as { transferAccountNumber?: string }).transferAccountNumber).toBe('1234567890');
  });

  // ---------------------------------------------------------------------------
  // Audit log
  // ---------------------------------------------------------------------------

  it('logs PII_DECRYPT_MASKED for SALES', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    await controller.findOne('t1', reqOf('SALES'));
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: true }),
    );
  });

  it('logs PII_DECRYPT_FULL for OWNER', async () => {
    service.findOne.mockResolvedValue({ id: 't1', transferAccountNumber: '1234567890' });
    await controller.findOne('t1', reqOf('OWNER'));
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: false }),
    );
  });

  // ---------------------------------------------------------------------------
  // findAll masking
  // ---------------------------------------------------------------------------

  it('masks list items for SALES in findAll', async () => {
    service.findAll.mockResolvedValue({
      data: [
        { id: 't1', transferAccountNumber: '1234567890' },
        { id: 't2', transferAccountNumber: '0987654321' },
      ],
      total: 2,
      page: 1,
      limit: 50,
    });
    const result = await controller.findAll(
      { page: 1, limit: 50 } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      reqOf('SALES'),
    );
    const data = (result as { data: Array<{ transferAccountNumber?: string }> }).data;
    expect(data[0].transferAccountNumber).toBe('XXXXXXXX90');
    expect(data[1].transferAccountNumber).toBe('XXXXXXXX21');
  });

  it('does not mask list items for OWNER in findAll', async () => {
    service.findAll.mockResolvedValue({
      data: [{ id: 't1', transferAccountNumber: '1234567890' }],
      total: 1,
      page: 1,
      limit: 50,
    });
    const result = await controller.findAll(
      { page: 1, limit: 50 } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      reqOf('OWNER'),
    );
    const data = (result as { data: Array<{ transferAccountNumber?: string }> }).data;
    expect(data[0].transferAccountNumber).toBe('1234567890');
  });
});
