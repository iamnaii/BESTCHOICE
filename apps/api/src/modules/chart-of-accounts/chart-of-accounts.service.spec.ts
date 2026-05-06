import { Test, TestingModule } from '@nestjs/testing';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChartOfAccountsService.findGrouped', () => {
  let service: ChartOfAccountsService;
  let prisma: { chartOfAccount: { findMany: jest.Mock } };

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
