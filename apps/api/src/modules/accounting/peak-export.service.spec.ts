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
