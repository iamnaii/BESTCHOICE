import { Test } from '@nestjs/testing';
import { PeakExportService } from './peak-export.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

describe('PeakExportService', () => {
  let service: PeakExportService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        PeakExportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CompanyResolverService,
          useValue: { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id') },
        },
      ],
    }).compile();
    service = mod.get(PeakExportService);
  });

  it('emits peakSubCode only for fixed-source accounts (mapping v5)', async () => {
    prisma.chartOfAccount.findMany
      // 1st call: mapped accounts
      .mockResolvedValueOnce([
        { code: '11-6101', name: 'ภาษีจ่ายแทน SHOP - ภ.พ.30', peakCode: '212203', peakSubCode: 'ADV001', peakSubCodeSource: 'fixed' },
        { code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ', peakCode: '113101', peakSubCode: null, peakSubCodeSource: 'contact' },
      ])
      // 2nd call: all accounts (names)
      .mockResolvedValueOnce([
        { code: '11-6101', name: 'ภาษีจ่ายแทน SHOP - ภ.พ.30' },
        { code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ' },
        { code: '11-2106', name: 'รายได้รอตัดบัญชี-ดอกเบี้ย' },
      ]);
    const je = { entryNumber: 'JE-1', entryDate: new Date('2026-10-20'), description: 'd', referenceType: null, referenceId: null };
    prisma.journalLine.findMany.mockResolvedValue([
      { accountCode: '11-6101', debit: '100.00', credit: '0', description: null, journalEntry: je },
      { accountCode: '11-2101', debit: '0', credit: '100.00', description: null, journalEntry: je },
      { accountCode: '11-2106', debit: '0', credit: '1.00', description: null, journalEntry: je }, // unmapped → skipped
    ]);
    const res = await service.exportJournalWithPeakCodes(new Date('2026-10-01'), new Date('2026-10-31'));
    const lines = res.csv.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('entryDate,entryNumber,peakCode,peakSubCode,accountCode,accountName,debit,credit,description,reference');
    expect(lines[1]).toBe('2026-10-20,JE-1,212203,ADV001,11-6101,ภาษีจ่ายแทน SHOP - ภ.พ.30,100,0,d,');
    expect(lines[2]).toBe('2026-10-20,JE-1,113101,,11-2101,ลูกหนี้ผ่อนชำระ,0,100,d,');
    expect(res.rowCount).toBe(2);
    expect(res.skippedLineCount).toBe(1);
  });

  it('scopes the export to FINANCE company (X5)', async () => {
    await service.exportJournalWithPeakCodes(new Date('2026-06-01'), new Date('2026-06-30'));
    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journalEntry: expect.objectContaining({ companyId: 'finance-co-id' }),
        }),
      }),
    );
  });
});
