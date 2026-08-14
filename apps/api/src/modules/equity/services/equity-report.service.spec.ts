import { Prisma } from '@prisma/client';
import { EquityReportService } from './equity-report.service';

const D = Prisma.Decimal;

describe('EquityReportService.dividendRegister', () => {
  const prisma = { equityDocument: { findMany: jest.fn() } };
  const service = new EquityReportService(prisma as never);

  it('aggregate ต่อผู้ถือหุ้นข้ามหลายใบ + totals', async () => {
    prisma.equityDocument.findMany.mockResolvedValue([
      {
        docNumber: 'EQ-20260410-0001',
        txnDate: new Date('2026-04-10'),
        lines: [
          {
            shareholderId: 'a',
            shareholderName: 'ก',
            amount: new D(100000),
            wht: new D(10000),
            shareholder: { taxId: '111', type: 'INDIVIDUAL' },
          },
          {
            shareholderId: 'b',
            shareholderName: 'ข',
            amount: new D(60000),
            wht: new D(0),
            shareholder: { taxId: '222', type: 'JURISTIC_TH' },
          },
        ],
      },
      {
        docNumber: 'EQ-20260810-0002',
        txnDate: new Date('2026-08-10'),
        lines: [
          {
            shareholderId: 'a',
            shareholderName: 'ก',
            amount: new D(50000),
            wht: new D(5000),
            shareholder: { taxId: '111', type: 'INDIVIDUAL' },
          },
        ],
      },
    ]);
    const r = await service.dividendRegister(2026);
    const a = r.rows.find((x) => x.shareholderId === 'a')!;
    expect(a.payCount).toBe(2);
    expect(a.gross).toBe('150000.00');
    expect(a.wht).toBe('15000.00');
    expect(a.net).toBe('135000.00');
    expect(a.docNumbers).toEqual(['EQ-20260410-0001', 'EQ-20260810-0002']);
    expect(r.totals.gross).toBe('210000.00');
    expect(r.totals.wht).toBe('15000.00');
  });
});
