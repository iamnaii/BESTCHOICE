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
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      expenseDocument: { findMany: jest.fn().mockResolvedValue([]) },
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

  // ---- mapping v5 · เจ้าของ 2026-10-20 "ทำรหัสย่อยได้เลย": per-line contact sub-codes ----
  describe('contact sub-codes resolved per line', () => {
    const je = (metadata: Record<string, unknown>) => ({
      entryNumber: 'JE-9', entryDate: new Date('2026-10-20'), description: 'd', referenceType: null, referenceId: null, metadata,
    });
    function mapped(rows: Array<{ code: string; peakCode: string; peakSubCode?: string | null; peakSubCodeSource: string }>) {
      prisma.chartOfAccount.findMany
        .mockResolvedValueOnce(rows.map((r) => ({ name: r.code, peakSubCode: null, ...r })))
        .mockResolvedValueOnce(rows.map((r) => ({ code: r.code, name: r.code })));
    }

    it('receivable lines take the PEAK contact code of the contract\'s customer', async () => {
      mapped([
        { code: '11-2101', peakCode: '113101', peakSubCodeSource: 'contact' },
        { code: '21-1103', peakCode: '212103', peakSubCodeSource: 'contact' },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { accountCode: '11-2101', debit: '100', credit: '0', description: null, journalEntry: je({ contractId: 'ct-1' }) },
        { accountCode: '21-1103', debit: '0', credit: '100', description: null, journalEntry: je({ contractId: 'ct-2' }) },
      ]);
      prisma.contract.findMany.mockResolvedValue([
        { id: 'ct-1', customer: { contact: { peakContactCode: 'C00790' } } },
        { id: 'ct-2', customer: { contact: { peakContactCode: 'C00801' } } },
      ]);
      const res = await service.exportJournalWithPeakCodes(new Date('2026-10-01'), new Date('2026-10-31'));
      const lines = res.csv.replace(/^\uFEFF/, '').split('\n');
      expect(lines[1]).toBe('2026-10-20,JE-9,113101,C00790,11-2101,11-2101,100,0,d,');
      expect(lines[2]).toBe('2026-10-20,JE-9,212103,C00801,21-1103,21-1103,0,100,d,');
      expect(res.unresolvedSubCodeCount).toBe(0);
      // One batched lookup for both contracts
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['ct-1', 'ct-2'] } } }),
      );
    });

    it('vendor payable lines take the PEAK contact code of the expense document\'s supplier', async () => {
      mapped([{ code: '21-1104', peakCode: '212311', peakSubCodeSource: 'contact' }]);
      prisma.journalLine.findMany.mockResolvedValue([
        { accountCode: '21-1104', debit: '0', credit: '50', description: null, journalEntry: je({ documentId: 'doc-1', flow: 'expense-accrual' }) },
      ]);
      prisma.expenseDocument.findMany.mockResolvedValue([
        { id: 'doc-1', vendorSupplier: { contact: { peakContactCode: 'C00123' } } },
      ]);
      const res = await service.exportJournalWithPeakCodes(new Date('2026-10-01'), new Date('2026-10-31'));
      const lines = res.csv.replace(/^\uFEFF/, '').split('\n');
      expect(lines[1]).toBe('2026-10-20,JE-9,212311,C00123,21-1104,21-1104,0,50,d,');
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
      expect(res.unresolvedSubCodeCount).toBe(0);
    });

    it('counts a contact-source line as unresolved when no PEAK contact code can be found', async () => {
      mapped([
        { code: '11-2101', peakCode: '113101', peakSubCodeSource: 'contact' },
        // SHOP payable: the file says "contact = SHOP" — not the contract's customer, so it
        // stays blank until the owner maps the row as fixed with SHOP's PEAK contact code.
        { code: '21-1101', peakCode: '212101', peakSubCodeSource: 'contact' },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        { accountCode: '11-2101', debit: '100', credit: '0', description: null, journalEntry: je({ contractId: 'ct-no-code' }) },
        { accountCode: '11-2101', debit: '5', credit: '0', description: null, journalEntry: je({}) }, // manual JE, no contract
        { accountCode: '21-1101', debit: '0', credit: '105', description: null, journalEntry: je({ contractId: 'ct-no-code' }) },
      ]);
      prisma.contract.findMany.mockResolvedValue([{ id: 'ct-no-code', customer: { contact: { peakContactCode: null } } }]);
      const res = await service.exportJournalWithPeakCodes(new Date('2026-10-01'), new Date('2026-10-31'));
      const lines = res.csv.replace(/^\uFEFF/, '').split('\n');
      expect(lines[1]).toBe('2026-10-20,JE-9,113101,,11-2101,11-2101,100,0,d,');
      expect(lines[3]).toBe('2026-10-20,JE-9,212101,,21-1101,21-1101,0,105,d,');
      expect(res.rowCount).toBe(3);
      expect(res.unresolvedSubCodeCount).toBe(3);
    });

    it('a fixed mapping wins over per-line resolution and never counts as unresolved', async () => {
      mapped([{ code: '21-1101', peakCode: '212101', peakSubCode: 'C00001', peakSubCodeSource: 'fixed' }]);
      prisma.journalLine.findMany.mockResolvedValue([
        { accountCode: '21-1101', debit: '0', credit: '9', description: null, journalEntry: je({ contractId: 'ct-1' }) },
      ]);
      const res = await service.exportJournalWithPeakCodes(new Date('2026-10-01'), new Date('2026-10-31'));
      expect(res.csv).toContain('212101,C00001,21-1101');
      expect(res.unresolvedSubCodeCount).toBe(0);
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });
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
