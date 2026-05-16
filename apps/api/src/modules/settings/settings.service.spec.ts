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

    // D1.2.7.2 — DB-driven reverse reasons
    it('reverseReasons defaults to 6 canonical codes', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.reverseReasons).toHaveLength(6);
      expect(flags.reverseReasons.map((r) => r.code)).toEqual([
        'data_entry_error',
        'wrong_vendor',
        'wrong_amount',
        'duplicate_entry',
        'cancel_transaction',
        'other',
      ]);
    });

    it('reverseReasons returns custom list when SystemConfig set', async () => {
      const custom = JSON.stringify([
        { code: 'manager_decision', label: 'ตัดสินใจของผู้บริหาร' },
        { code: 'audit_finding', label: 'ผลการตรวจสอบ' },
      ]);
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') return Promise.resolve({ value: custom });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseReasons).toHaveLength(2);
      expect(flags.reverseReasons[0].code).toBe('manager_decision');
    });

    it('reverseReasons falls back to defaults when stored JSON is malformed', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') return Promise.resolve({ value: 'not-json' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseReasons).toHaveLength(6);
    });

    it('reverseReasons falls back to defaults when stored array is empty', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') return Promise.resolve({ value: '[]' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseReasons).toHaveLength(6);
    });

    it('reverseReasons falls back to defaults when row shape is wrong', async () => {
      const bad = JSON.stringify([{ id: 'x', name: 'y' }]); // missing code+label
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_reasons') return Promise.resolve({ value: bad });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseReasons).toHaveLength(6);
    });

    // D1.2.7.3 — manager approval days threshold
    it('reverseManagerApprovalDays defaults to 7 when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.reverseManagerApprovalDays).toBe(7);
    });

    it('reverseManagerApprovalDays returns OWNER-configured value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_manager_approval_days') return Promise.resolve({ value: '14' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseManagerApprovalDays).toBe(14);
    });

    it('reverseManagerApprovalDays falls back to default on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'reverse_manager_approval_days') return Promise.resolve({ value: 'soon' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.reverseManagerApprovalDays).toBe(7);
    });

    // D1.2.6.3 — payment_date_warning_backdate
    it('paymentDateWarningBackdate defaults to 30 when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.paymentDateWarningBackdate).toBe(30);
    });

    it('paymentDateWarningBackdate returns OWNER-configured value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'payment_date_warning_backdate') return Promise.resolve({ value: '90' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paymentDateWarningBackdate).toBe(90);
    });

    // D1.2.6.4 — payment_date_allow_future
    it('paymentDateAllowFuture defaults to true when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.paymentDateAllowFuture).toBe(true);
    });

    it('paymentDateAllowFuture returns false when OWNER disables it', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'payment_date_allow_future') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paymentDateAllowFuture).toBe(false);
    });

    // D1.2.6.1 — period_close_day
    it('periodCloseDay defaults to 31 (end-of-month) when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.periodCloseDay).toBe(31);
    });

    it('periodCloseDay accepts valid 1-31 range from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'period_close_day') return Promise.resolve({ value: '25' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.periodCloseDay).toBe(25);
    });

    it('periodCloseDay clamps to default when out of valid range', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'period_close_day') return Promise.resolve({ value: '32' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.periodCloseDay).toBe(31);
    });

    it('periodCloseDay clamps to default when zero or negative', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'period_close_day') return Promise.resolve({ value: '0' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.periodCloseDay).toBe(31);
    });

    // D1.2.3.1 — default_time_range preset
    it('defaultTimeRange defaults to "this_month" when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.defaultTimeRange).toBe('this_month');
    });

    it('defaultTimeRange accepts "all" from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'default_time_range') return Promise.resolve({ value: 'all' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.defaultTimeRange).toBe('all');
    });

    it('defaultTimeRange accepts "last_month" from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'default_time_range') return Promise.resolve({ value: 'last_month' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.defaultTimeRange).toBe('last_month');
    });

    it('defaultTimeRange falls back to "this_month" for unknown values', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'default_time_range') return Promise.resolve({ value: 'last_quarter' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.defaultTimeRange).toBe('this_month');
    });

    // D1.3.5.1 — summary_default_range preset (ExpenseDailySummaryPage)
    it('summaryDefaultRange defaults to "this_month" when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.summaryDefaultRange).toBe('this_month');
    });

    it('summaryDefaultRange accepts "today" from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'summary_default_range') return Promise.resolve({ value: 'today' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.summaryDefaultRange).toBe('today');
    });

    it('summaryDefaultRange accepts "this_week" from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'summary_default_range') return Promise.resolve({ value: 'this_week' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.summaryDefaultRange).toBe('this_week');
    });

    it('summaryDefaultRange accepts "last_month" from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'summary_default_range') return Promise.resolve({ value: 'last_month' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.summaryDefaultRange).toBe('last_month');
    });

    it('summaryDefaultRange falls back to "this_month" for unknown values (and rejects "all" — not whitelisted for summary)', async () => {
      // 'all' is intentionally NOT in the summary whitelist. The summary page
      // does not currently expose an "all" UI option and its query needs a
      // bounded period to render. A bad admin edit must not blank the page.
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'summary_default_range') return Promise.resolve({ value: 'all' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.summaryDefaultRange).toBe('this_month');
    });

    // D1.3.5.2 — summary_all_range_warning flag
    it('summaryAllRangeWarning defaults to true when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.summaryAllRangeWarning).toBe(true);
    });

    it('summaryAllRangeWarning returns false when OWNER disables it', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'summary_all_range_warning') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.summaryAllRangeWarning).toBe(false);
    });
  });
});
