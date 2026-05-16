import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('SettingsService audit trail', () => {
  let service: SettingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args) => Promise.resolve({ id: 'sc-1', ...args.update, key: args.where.key })),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(SettingsService);
  });

  it('records SYSTEM_CONFIG_CREATE when key did not exist', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue(null);

    await service.update('bank_account_number', '1234567890', 'u-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SYSTEM_CONFIG_CREATE',
        entity: 'SystemConfig',
        entityId: 'bank_account_number',
        userId: 'u-1',
        newValue: { key: 'bank_account_number', value: '1234567890' },
      }),
    );
  });

  it('records SYSTEM_CONFIG_UPDATE with oldValue + newValue when key existed', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ value: '111' });

    await service.update('bank_account_number', '222', 'u-1');

    const call = audit.log.mock.calls[0][0];
    expect(call.action).toBe('SYSTEM_CONFIG_UPDATE');
    expect(call.oldValue).toEqual({ key: 'bank_account_number', value: '111' });
    expect(call.newValue).toEqual({ key: 'bank_account_number', value: '222' });
  });

  it('redacts values for sensitive keys (token/secret/api_key/password/credential)', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'old-secret' });
    await service.update('paysolutions_secret_key', 'new-secret', 'u-1');
    const call = audit.log.mock.calls[0][0];
    expect(call.oldValue.value).toBe('[REDACTED]');
    expect(call.newValue.value).toBe('[REDACTED]');
  });

  it('does NOT redact non-sensitive keys (e.g. bank_name)', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'KBank' });
    await service.update('bank_name', 'SCB', 'u-1');
    const call = audit.log.mock.calls[0][0];
    expect(call.newValue.value).toBe('SCB');
  });

  it('bulkUpdate logs one audit entry per item with correct old/new values', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'a', value: 'old-a' },
      // key 'b' does not exist yet
    ]);

    await service.bulkUpdate(
      [
        { key: 'a', value: 'new-a' },
        { key: 'b', value: 'new-b' },
      ],
      'u-1',
    );

    expect(audit.log).toHaveBeenCalledTimes(2);
    const actions = audit.log.mock.calls.map((c: [{ action: string }]) => c[0].action);
    expect(actions).toContain('SYSTEM_CONFIG_UPDATE');
    expect(actions).toContain('SYSTEM_CONFIG_CREATE');
  });

  it('audit failure does NOT block config update (audit.log is fire-and-forget-style)', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({ value: 'old' });
    audit.log.mockRejectedValue(new Error('audit DB down'));

    // The service does await audit.log — if audit throws, the error bubbles.
    // AuditService itself catches its own errors, so we verify the service
    // still calls prisma.upsert before audit.
    await expect(service.update('k', 'v', 'u-1')).rejects.toThrow();
    expect(prisma.systemConfig.upsert).toHaveBeenCalled();
  });

  // D1.2.8.2 + D1.2.7.1 — UI feature flags endpoint
  describe('getUiFlags', () => {
    it('all flags default to true when SystemConfig rows missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.taxExemptWarningEnabled).toBe(true);
      expect(flags.reverseReasonRequired).toBe(true);
    });

    it('returns taxExemptWarningEnabled=false when SystemConfig row set to "false"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'TAX_EXEMPT_WARNING_ENABLED') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.taxExemptWarningEnabled).toBe(false);
      expect(flags.reverseReasonRequired).toBe(true);
    });

    it('returns reverseReasonRequired=false when SystemConfig set to "false"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reason_required') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseReasonRequired).toBe(false);
      expect(flags.taxExemptWarningEnabled).toBe(true);
    });

    it('falls back to default for unparseable SystemConfig values', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue({ value: 'maybe' });
      const flags = await service.getUiFlags();
      expect(flags.taxExemptWarningEnabled).toBe(true);
      expect(flags.reverseReasonRequired).toBe(true);
    });
  });
});
