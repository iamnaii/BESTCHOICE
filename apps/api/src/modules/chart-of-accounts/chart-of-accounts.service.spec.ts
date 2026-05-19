import { Test, TestingModule } from '@nestjs/testing';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';

interface FakePrisma {
  chartOfAccount: {
    findMany: jest.Mock;
    update?: jest.Mock;
  };
  auditLog?: { create: jest.Mock };
  $transaction?: jest.Mock;
}

describe('ChartOfAccountsService.findGrouped', () => {
  let service: ChartOfAccountsService;
  let prisma: FakePrisma;

  beforeEach(async () => {
    prisma = { chartOfAccount: { findMany: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartOfAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ChartOfAccountsService>(ChartOfAccountsService);
  });

  it('groups accounts by category, sorted by code', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '53-1101', name: 'เงินเดือน', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null },
      { code: '53-1102', name: 'ประกันสังคม', normalBalance: 'Dr', category: 'OpEx-บุคลากร', vatApplicable: false, notes: null },
      { code: '53-1201', name: 'วัสดุสำนักงาน', normalBalance: 'Dr', category: 'OpEx-วัสดุ', vatApplicable: false, notes: null },
    ]);

    const result = await service.findGrouped({ type: 'ค่าใช้จ่าย' });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].category).toBe('OpEx-บุคลากร');
    expect(result.groups[0].accounts).toHaveLength(2);
    expect(result.groups[0].accounts[0].code).toBe('53-1101');
    expect(result.groups[1].category).toBe('OpEx-วัสดุ');
  });

  it('filters by codePrefix', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '12-2101', name: 'อุปกรณ์สำนักงาน', normalBalance: 'Dr', category: 'สินทรัพย์ถาวร', vatApplicable: false, notes: null },
    ]);

    await service.findGrouped({ codePrefix: '12-21' });

    expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: { startsWith: '12-21' } }),
      }),
    );
  });

  it('groups uncategorized accounts under "อื่นๆ"', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '99-9999', name: 'test', normalBalance: 'Dr', category: null, vatApplicable: false, notes: null },
    ]);

    const result = await service.findGrouped({});

    expect(result.groups[0].category).toBe('อื่นๆ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P3-SP3: PEAK code mapping
// ═══════════════════════════════════════════════════════════════════════════
describe('ChartOfAccountsService — PEAK mapping', () => {
  let service: ChartOfAccountsService;
  let prisma: FakePrisma;

  const buildPrisma = (): FakePrisma => {
    const cao = {
      findMany: jest.fn(),
      update: jest.fn(),
    };
    const audit = { create: jest.fn() };
    return {
      chartOfAccount: cao,
      auditLog: audit,
      $transaction: jest.fn().mockImplementation(async (fn: (tx: FakePrisma) => unknown) => {
        if (typeof fn === 'function') {
          return fn({ chartOfAccount: cao, auditLog: audit });
        }
        return undefined;
      }),
    };
  };

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartOfAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ChartOfAccountsService>(ChartOfAccountsService);
  });

  describe('getPeakMapping', () => {
    it('returns active accounts with mapping info', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { id: 'a1', code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', peakCode: '1110-01' },
        { id: 'a2', code: '11-2103', name: 'ลูกหนี้', type: 'สินทรัพย์', peakCode: null },
      ]);
      const rows = await service.getPeakMapping();
      expect(rows).toHaveLength(2);
      expect(rows[0].peakCode).toBe('1110-01');
      expect(rows[1].peakCode).toBeNull();
      // Verifies it filters to active + non-deleted accounts
      expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null, status: 'ใช้งาน' }),
        }),
      );
    });
  });

  describe('updatePeakMapping', () => {
    it('writes audit log + updates rows that actually changed', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { id: 'a1', code: '11-1101', peakCode: null },
        { id: 'a2', code: '11-1102', peakCode: '1110-02' }, // unchanged
      ]);
      prisma.chartOfAccount.update!.mockResolvedValue({});
      prisma.auditLog!.create.mockResolvedValue({});

      const result = await service.updatePeakMapping(
        {
          mappings: [
            { id: 'a1', peakCode: '1110-01' },
            { id: 'a2', peakCode: '1110-02' }, // no diff
          ],
        },
        'user-1',
      );

      expect(result.updated).toBe(1);
      // Only the changed row triggers update
      expect(prisma.chartOfAccount.update).toHaveBeenCalledTimes(1);
      expect(prisma.chartOfAccount.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { peakCode: '1110-01' },
      });
      // Audit log captures before/after
      expect(prisma.auditLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PEAK_MAPPING_UPDATED',
            entity: 'chart_of_account',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('normalises empty-string peakCode to null', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { id: 'a1', code: '11-1101', peakCode: 'OLD' },
      ]);
      prisma.chartOfAccount.update!.mockResolvedValue({});
      prisma.auditLog!.create.mockResolvedValue({});

      const result = await service.updatePeakMapping(
        { mappings: [{ id: 'a1', peakCode: '  ' }] },
        'user-1',
      );

      expect(result.updated).toBe(1);
      expect(prisma.chartOfAccount.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { peakCode: null },
      });
    });

    it('rejects unknown account IDs', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([]);
      await expect(
        service.updatePeakMapping({ mappings: [{ id: 'no-such-id', peakCode: 'X' }] }, 'user-1'),
      ).rejects.toThrow(/ไม่พบบัญชี/);
    });

    it('skips audit log + no transaction work when nothing changed', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { id: 'a1', code: '11-1101', peakCode: '1110-01' },
      ]);
      const result = await service.updatePeakMapping(
        { mappings: [{ id: 'a1', peakCode: '1110-01' }] },
        'user-1',
      );
      expect(result.updated).toBe(0);
      expect(prisma.auditLog!.create).not.toHaveBeenCalled();
    });
  });

  describe('exportPeakMappingCsv', () => {
    it('returns CSV with header + UTF-8 BOM + escaped Thai names', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([
        { id: 'a1', code: '11-1101', name: 'เงินสด, สาขา A', type: 'สินทรัพย์', peakCode: '1110-01' },
        { id: 'a2', code: '11-1102', name: 'เงินสด', type: 'สินทรัพย์', peakCode: null },
      ]);
      const csv = await service.exportPeakMappingCsv();
      const lines = csv.split('\n');
      // BOM in header line
      expect(lines[0]).toContain('code,name,peakCode');
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      // Quoted because name contains comma
      expect(lines[1]).toContain('"เงินสด, สาขา A"');
      expect(lines[1]).toContain('1110-01');
      // Unmapped row has empty peakCode column
      expect(lines[2]).toBe('11-1102,เงินสด,');
    });
  });
});
