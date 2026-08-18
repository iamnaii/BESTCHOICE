import { Prisma } from '@prisma/client';
import { ImportedSalesService } from '../imported-sales.service';
import { QueryImportedSalesDto } from '../dto/query-imported-sales.dto';

function mkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    soldAt: new Date('2026-08-18T06:46:40.000Z'),
    saleChannel: 'EXTERNAL_FINANCE',
    salespersonName: 'หมวย',
    category: 'iPhone มือ 2',
    salePrice: new Prisma.Decimal('40063'),
    profit: new Prisma.Decimal('2163'),
    costTotal: new Prisma.Decimal('37900'),
    ...over,
  };
}

describe('ImportedSalesService', () => {
  it('list() returns paginated shape with soldAt range where-clause', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: '1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      importedSale: { findMany, count },
    } as never;
    const svc = new ImportedSalesService(prisma);
    const q = Object.assign(new QueryImportedSalesDto(), {
      page: 2, limit: 10, startDate: '2026-07-01', endDate: '2026-08-31', saleChannel: 'CASH',
    });
    const res = await svc.list(q);
    expect(res).toEqual({ data: [{ id: '1' }], total: 1, page: 2, limit: 10 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
    expect(arg.where.saleChannel).toBe('CASH');
    expect(arg.where.soldAt.gte).toBeInstanceOf(Date);
    expect(arg.where.soldAt.lte).toBeInstanceOf(Date);
  });

  it('summary() aggregates totals + groups in JS as strings', async () => {
    const rows = [
      mkRow(),
      mkRow({ saleChannel: 'CASH', category: 'Accessories', salePrice: new Prisma.Decimal('0'), profit: new Prisma.Decimal('-35') }),
    ];
    const prisma = { importedSale: { findMany: jest.fn().mockResolvedValue(rows) } } as never;
    const svc = new ImportedSalesService(prisma);
    const res = await svc.summary(new QueryImportedSalesDto());
    expect(res.totals).toEqual({ count: 2, sales: '40063', profit: '2128', cost: '75800' });
    expect(res.byChannel).toEqual(
      expect.arrayContaining([
        { key: 'EXTERNAL_FINANCE', count: 1, sales: '40063', profit: '2163' },
        { key: 'CASH', count: 1, sales: '0', profit: '-35' },
      ]),
    );
    expect(res.byMonth).toEqual([{ key: '2026-08', count: 2, sales: '40063', profit: '2128' }]);
  });
});
