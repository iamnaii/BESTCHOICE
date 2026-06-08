import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Characterization tests for the flag-normalisation slice of
 * `SettingsService.getUiFlags`, locking the behaviour preserved by the
 * Wave-4 extraction of pickEnum / clampInt / clampFloat / parseStringArray
 * into `settings-flag-parsers.util`. Sub-readers (getKey / readNumber /
 * readBoolean) and the non-flag sub-builders are stubbed so the assertions
 * target the normalisation, not the SystemConfig I/O.
 */
describe('SettingsService.getUiFlags — flag normalisation', () => {
  let service: SettingsService;
  let keyMap: Record<string, string | null>;
  let numMap: Record<string, number>;

  beforeEach(async () => {
    keyMap = {};
    numMap = {};
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();
    service = mod.get(SettingsService);

    jest.spyOn(service, 'getKey').mockImplementation(async (k: string) => keyMap[k] ?? null);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    jest
      .spyOn(service as any, 'readNumber')
      .mockImplementation(async (...args: any[]) => (args[0] in numMap ? numMap[args[0]] : args[1]));
    jest.spyOn(service as any, 'readBoolean').mockImplementation(async (...args: any[]) => args[1]);
    jest.spyOn(service as any, 'getReverseReasons').mockResolvedValue([]);
    jest.spyOn(service as any, 'getDocPrefixMap').mockResolvedValue({});
    jest.spyOn(service as any, 'getWhtRates').mockResolvedValue([]);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it('returns documented defaults when every SystemConfig key is unset', async () => {
    const f = await service.getUiFlags();
    expect(f.language).toBe('th');
    expect(f.settlementDefaultTick).toBe('overdue_only');
    expect(f.dataExportFormat).toBe('JSON');
    expect(f.voucherPrintMode).toBe('multi');
    expect(f.thousandsSeparator).toBe('comma');
    expect(f.dateFormat).toBe('BE');
    expect(f.defaultTimeRange).toBe('this_month');
    expect(f.summaryDefaultRange).toBe('this_month');
    expect(f.darkModeDefault).toBe('system');
    expect(f.emailProvider).toBe('smtp');
    expect(f.settingsAccessRole).toBe('OWNER');
    expect(f.postPermission).toBe('OWNER+FINANCE_MANAGER+ACCOUNTANT');
    expect(f.reversePermission).toBe('OWNER+FINANCE_MANAGER');
    expect(f.decimalPlaces).toBe(2);
    expect(f.paginationSize).toBe(50);
    expect(f.smartSwitchThresholdDays).toBe(0);
    expect(f.settlementMaxBillsPerDoc).toBe(100);
    expect(f.queryTimeoutSeconds).toBe(30);
    expect(f.cacheTtlDashboard).toBe(60);
    expect(f.cacheTtlReports).toBe(300);
    expect(f.approversList).toEqual([]);
    expect(f.approvalRequiredDocTypes).toEqual(['PAYROLL']);
  });

  it('passes through valid whitelisted / in-range overrides', async () => {
    keyMap = {
      language: 'en',
      data_export_format: 'XLSX',
      dark_mode_default: 'dark',
      post_permission: 'OWNER_ONLY',
      approvers_list: '["u1","u2"]',
      approval_required_doc_types: '["EXPENSE"]',
    };
    numMap = { decimal_places: 4, pagination_size: 200, query_timeout_seconds: 120.7 };
    const f = await service.getUiFlags();
    expect(f.language).toBe('en');
    expect(f.dataExportFormat).toBe('XLSX');
    expect(f.darkModeDefault).toBe('dark');
    expect(f.postPermission).toBe('OWNER_ONLY');
    expect(f.approversList).toEqual(['u1', 'u2']);
    expect(f.approvalRequiredDocTypes).toEqual(['EXPENSE']);
    expect(f.decimalPlaces).toBe(4);
    expect(f.paginationSize).toBe(200);
    expect(f.queryTimeoutSeconds).toBe(120); // clampFloat floors
  });

  it('falls back when overrides are invalid / out of range', async () => {
    keyMap = {
      language: 'fr',
      settlement_default_tick: 'bogus',
      approval_required_doc_types: '[]',
    };
    numMap = { decimal_places: 9, smart_switch_threshold_days: -1, pagination_size: 5 };
    const f = await service.getUiFlags();
    expect(f.language).toBe('th');
    expect(f.settlementDefaultTick).toBe('overdue_only');
    expect(f.approvalRequiredDocTypes).toEqual(['PAYROLL']); // empty array → requireNonEmpty fallback
    expect(f.decimalPlaces).toBe(2);
    expect(f.smartSwitchThresholdDays).toBe(0);
    expect(f.paginationSize).toBe(50);
  });
});
