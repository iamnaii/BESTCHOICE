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

  // D1.1.3.1 follow-up — VAT-rate write normalisation.
  describe('bulkUpdate VAT_RATE normalisation', () => {
    beforeEach(() => {
      // Mock the upsert side-effect so we can read the call args.
      prisma.systemConfig.upsert = jest.fn(
        (args: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) =>
          Promise.resolve({ id: 'sc-1', key: args.where.key, value: args.update.value }),
      );
    });

    it('rewrites vat_pct decimal form to VAT_RATE percent form', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await service.bulkUpdate([{ key: 'vat_pct', value: '0.07' }], 'u-1');
      const upsertArgs = prisma.systemConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ key: 'VAT_RATE' });
      expect(upsertArgs.update).toEqual({ value: '7' });
    });

    it('passes through VAT_RATE writes unchanged', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await service.bulkUpdate([{ key: 'VAT_RATE', value: '7' }], 'u-1');
      const upsertArgs = prisma.systemConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ key: 'VAT_RATE' });
      expect(upsertArgs.update).toEqual({ value: '7' });
    });

    it('rewrites legacy vat_rate alias the same way as vat_pct', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await service.bulkUpdate([{ key: 'vat_rate', value: '0.07' }], 'u-1');
      const upsertArgs = prisma.systemConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ key: 'VAT_RATE' });
      expect(upsertArgs.update).toEqual({ value: '7' });
    });

    it('preserves percent-form value sent under vat_pct (operator confusion)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      // Operator types "7" into a field labelled vat_pct — that's percent,
      // not decimal. Heuristic treats >=1 as already percent.
      await service.bulkUpdate([{ key: 'vat_pct', value: '7' }], 'u-1');
      const upsertArgs = prisma.systemConfig.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ key: 'VAT_RATE' });
      expect(upsertArgs.update).toEqual({ value: '7' });
    });
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

    // D1.2.1.1 — Approval Workflow opt-in (default true per Settings_Audit_Core_v2.0.md)
    it('approvalEnabled defaults to true when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.approvalEnabled).toBe(true);
    });

    it('approvalEnabled returns false when OWNER disables it explicitly', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'approval_enabled') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.approvalEnabled).toBe(false);
    });

    it('approvalEnabled falls back to default (true) on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'approval_enabled') return Promise.resolve({ value: 'maybe' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.approvalEnabled).toBe(true);
    });

    // D1.2.3.2 — pagination_size
    it('paginationSize defaults to 50 when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.paginationSize).toBe(50);
    });

    it('paginationSize accepts valid value 100 from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'pagination_size') return Promise.resolve({ value: '100' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paginationSize).toBe(100);
    });

    it('paginationSize clamps to default 50 when out-of-range (5)', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'pagination_size') return Promise.resolve({ value: '5' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paginationSize).toBe(50);
    });

    it('paginationSize clamps to default 50 when above max (250)', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'pagination_size') return Promise.resolve({ value: '250' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paginationSize).toBe(50);
    });

    it('paginationSize falls back to default 50 when non-numeric', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'pagination_size') return Promise.resolve({ value: 'many' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.paginationSize).toBe(50);
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

    // D1.1.6 — adjustmentCodes for V4 form's Multi-line Adjustment row.
    it('adjustmentCodes defaults to 52-1104 (underpay) / 53-1503 (overpay)', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.adjustmentCodes).toEqual({ underpay: '52-1104', overpay: '53-1503' });
    });

    it('adjustmentCodes accepts OWNER override from SystemConfig', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'adjustment_code_underpay') return Promise.resolve({ value: '52-9999' });
        if (args.where.key === 'adjustment_code_overpay') return Promise.resolve({ value: '53-9999' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.adjustmentCodes).toEqual({ underpay: '52-9999', overpay: '53-9999' });
    });

    it('adjustmentCodes rejects malformed code via regex fallback', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'adjustment_code_underpay') return Promise.resolve({ value: 'BAD-CODE' });
        if (args.where.key === 'adjustment_code_overpay') return Promise.resolve({ value: '' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      // Both bad → fall back to legacy defaults.
      expect(flags.adjustmentCodes).toEqual({ underpay: '52-1104', overpay: '53-1503' });
    });

    // D1.4.1.1 — sidebar_collapsed_default
    it('sidebarCollapsedDefault defaults to false (expanded) when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.sidebarCollapsedDefault).toBe(false);
    });

    it('sidebarCollapsedDefault returns true when OWNER stores "true"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'sidebar_collapsed_default') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.sidebarCollapsedDefault).toBe(true);
    });

    it('sidebarCollapsedDefault falls back to default on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'sidebar_collapsed_default') return Promise.resolve({ value: 'maybe' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.sidebarCollapsedDefault).toBe(false);
    });

    // D1.4.1.2 — show_keyboard_shortcuts
    it('showKeyboardShortcuts defaults to true when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.showKeyboardShortcuts).toBe(true);
    });

    it('showKeyboardShortcuts returns false when OWNER stores "false"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'show_keyboard_shortcuts') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.showKeyboardShortcuts).toBe(false);
    });

    it('showKeyboardShortcuts falls back to default on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'show_keyboard_shortcuts') return Promise.resolve({ value: 'maybe' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.showKeyboardShortcuts).toBe(true);
    });

    // D1.4.1.3 — animation_enabled
    it('animationEnabled defaults to true when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.animationEnabled).toBe(true);
    });

    it('animationEnabled returns false when OWNER stores "false"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'animation_enabled') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.animationEnabled).toBe(false);
    });

    it('animationEnabled falls back to default on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'animation_enabled') return Promise.resolve({ value: 'maybe' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.animationEnabled).toBe(true);
    });

    // D1.4.1.4 — dark_mode_default
    it('darkModeDefault defaults to "system" when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.darkModeDefault).toBe('system');
    });

    it('darkModeDefault returns "light" when OWNER stores "light"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'dark_mode_default') return Promise.resolve({ value: 'light' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.darkModeDefault).toBe('light');
    });

    it('darkModeDefault returns "dark" when OWNER stores "dark"', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'dark_mode_default') return Promise.resolve({ value: 'dark' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.darkModeDefault).toBe('dark');
    });

    it('darkModeDefault falls back to "system" on unparseable value', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'dark_mode_default') return Promise.resolve({ value: 'rainbow' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.darkModeDefault).toBe('system');
    });

    // D1.4.2.1 — query_timeout_seconds
    it('queryTimeoutSeconds defaults to 30 when SystemConfig missing', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockResolvedValue(null);
      const flags = await service.getUiFlags();
      expect(flags.queryTimeoutSeconds).toBe(30);
    });

    it('queryTimeoutSeconds accepts valid 5-300 range', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'query_timeout_seconds') return Promise.resolve({ value: '120' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.queryTimeoutSeconds).toBe(120);
    });

    it('queryTimeoutSeconds clamps out-of-range values back to 30', async () => {
      prisma.systemConfig.findFirst = jest.fn().mockImplementation((args: { where: { key: string } }) => {
        if (args.where.key === 'query_timeout_seconds') return Promise.resolve({ value: '600' });
        return Promise.resolve(null);
      });
      const flags = await service.getUiFlags();
      expect(flags.queryTimeoutSeconds).toBe(30);
    });
  });
});
