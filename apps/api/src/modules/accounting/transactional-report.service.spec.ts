import { Test, TestingModule } from '@nestjs/testing';
import { TransactionalReportService } from './transactional-report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

/**
 * Task 4 (void-sale): รายงานที่อ่านตาราง `Sale` ตรง ๆ ต้องไม่นับใบที่ยกเลิก
 * (void = soft delete). `getMonthlyPLSummary` เคยเป็นช่องว่างจริงสองจุด —
 * sale.findMany ของ revenue และของ productSales (COGS) ไม่มี `deletedAt: null`.
 */
describe('TransactionalReportService — getMonthlyPLSummary', () => {
  let service: TransactionalReportService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      financeReceivable: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionalReportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CompanyResolverService,
          useValue: { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') },
        },
      ],
    }).compile();

    service = module.get<TransactionalReportService>(TransactionalReportService);
  });

  it('ไม่นับใบขายที่ยกเลิก — sale.findMany ทุกจุด (ทั้ง revenue และ COGS) กรอง deletedAt: null', async () => {
    await service.getMonthlyPLSummary(2026);

    const saleCalls = prisma.sale.findMany.mock.calls;
    // สองจุด: sales (revenue) + productSales (COGS)
    expect(saleCalls.length).toBeGreaterThanOrEqual(2);
    for (const [arg] of saleCalls) {
      expect(arg.where.deletedAt).toBeNull();
    }
  });
});
