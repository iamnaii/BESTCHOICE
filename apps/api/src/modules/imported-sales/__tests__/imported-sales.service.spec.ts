import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportedSalesService } from '../imported-sales.service';
import { QueryImportedSalesDto } from '../dto/query-imported-sales.dto';

function mkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    source: 'TOOLTIFY',
    importBatch: 'legacy-batch',
    barcode: '012345678901234',
    orderNumber: 'BILL-123',
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
  function summaryService(findMany: jest.Mock) {
    const db = {
      importedSale: { findMany, count: jest.fn().mockResolvedValue(0) },
      tooltifyImportItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new ImportedSalesService({
      ...db,
      $transaction: (work: ((tx: typeof db) => unknown) | Promise<unknown>[]) =>
        Array.isArray(work) ? Promise.all(work) : work(db),
    } as never);
  }

  it('list() returns paginated shape with soldAt range where-clause', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: '1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      importedSale: { findMany, count },
    } as never;
    const svc = new ImportedSalesService(prisma);
    const q = Object.assign(new QueryImportedSalesDto(), {
      page: 2,
      limit: 10,
      startDate: '2026-07-01',
      endDate: '2026-08-31',
      saleChannel: 'CASH',
      barcode: '012345678901234',
      orderNumber: 'BILL-12',
    });
    const res = await svc.list(q);
    expect(res).toEqual({ data: [{ id: '1' }], total: 1, page: 2, limit: 10 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
    expect(arg.where.saleChannel).toBe('CASH');
    expect(arg.where.barcode).toBe('012345678901234');
    expect(arg.where.orderNumber).toEqual({ contains: 'BILL-12' });
    expect(arg.orderBy).toEqual([{ soldAt: 'desc' }, { id: 'desc' }]);
    expect(arg.where.soldAt.gte).toBeInstanceOf(Date);
    expect(arg.where.soldAt.lte).toBeInstanceOf(Date);
  });

  it('summary() aggregates totals + groups in JS as strings', async () => {
    const rows = [
      mkRow(),
      mkRow({
        id: '2',
        orderNumber: 'BILL-124',
        saleChannel: 'CASH',
        category: 'Accessories',
        salePrice: new Prisma.Decimal('0'),
        profit: new Prisma.Decimal('-35'),
      }),
    ];
    const svc = summaryService(jest.fn().mockResolvedValue(rows));
    const res = await svc.summary(new QueryImportedSalesDto());
    expect(res.totals).toEqual({
      billCount: 2,
      lineCount: 2,
      count: 2,
      sales: '40063',
      profit: '2128',
      cost: '75800',
    });
    expect(res.byChannel).toEqual(
      expect.arrayContaining([
        { key: 'EXTERNAL_FINANCE', count: 1, sales: '40063', profit: '2163' },
        { key: 'CASH', count: 1, sales: '0', profit: '-35' },
      ]),
    );
    expect(res.byMonth).toEqual([{ key: '2026-08', count: 2, sales: '40063', profit: '2128' }]);
  });

  it('distinguishes_bill_and_line_counts', async () => {
    const service = summaryService(
      jest.fn().mockResolvedValue([mkRow(), mkRow({ id: '2', barcode: '012345678901235' })]),
    );
    const query = new QueryImportedSalesDto();
    expect((await service.summary(query)).totals).toMatchObject({
      billCount: 1,
      lineCount: 2,
      count: 2,
    });
  });

  it('list(): startDate/endDate เป็นวันตามปฏิทินไทย — เริ่ม 00:00 น. · สิ้นสุด 23:59:59.999 น.', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      importedSale: { findMany, count },
    } as never;
    const svc = new ImportedSalesService(prisma);
    const q = Object.assign(new QueryImportedSalesDto(), {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    await svc.list(q);

    const { gte, lte } = findMany.mock.calls[0][0].where.soldAt;
    expect(gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-08-31T16:59:59.999Z');
    // ขอบ: ขาย 00:00 น. ไทยของวันที่ 1 อยู่ในช่วง · 00:00 น. ของวันที่ 1 เดือนถัดไปอยู่นอกช่วง
    const first = new Date('2026-08-01T00:00:00+07:00').getTime();
    const next = new Date('2026-09-01T00:00:00+07:00').getTime();
    expect(first >= gte.getTime() && first <= lte.getTime()).toBe(true);
    expect(next <= lte.getTime()).toBe(false);
  });

  it('summary(): ใช้ช่วงวันที่ชุดเดียวกับ list()', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = summaryService(findMany);

    await svc.summary(
      Object.assign(new QueryImportedSalesDto(), {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      }),
    );

    const { gte, lte } = findMany.mock.calls[0][0].where.soldAt;
    expect(gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-08-31T16:59:59.999Z');
  });

  it('summary(): byMonth นับเดือนตามปฏิทินไทย — ขาย 00:30 น. ของวันที่ 1 อยู่เดือนใหม่', async () => {
    const rows = [
      mkRow({ soldAt: new Date('2026-08-31T17:30:00.000Z') }), // 2026-09-01 00:30 น. ไทย
      mkRow({ soldAt: new Date('2026-08-31T16:59:59.999Z') }), // 2026-08-31 23:59:59.999 น. ไทย
    ];
    const svc = summaryService(jest.fn().mockResolvedValue(rows));

    const res = await svc.summary(new QueryImportedSalesDto());

    expect(res.byMonth.map((b) => [b.key, b.count])).toEqual([
      ['2026-08', 1],
      ['2026-09', 1],
    ]);
  });

  it.each(['list', 'summary'] as const)(
    '%s rejects a reversed Bangkok date range',
    async (method) => {
      const svc = summaryService(jest.fn().mockResolvedValue([]));
      const query = plainToInstance(QueryImportedSalesDto, {
        startDate: '2026-11-02',
        endDate: '2026-11-01',
      });
      await expect(svc[method](query)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

describe('QueryImportedSalesDto', () => {
  it('trims search terms without changing leading IMEI zeroes', async () => {
    const query = plainToInstance(QueryImportedSalesDto, {
      barcode: '  012345678901234  ',
      orderNumber: `  ${'B'.repeat(100)}  `,
    });
    expect(await validate(query, { whitelist: true })).toEqual([]);
    expect(query).toMatchObject({ barcode: '012345678901234', orderNumber: 'B'.repeat(100) });
  });

  it.each([
    ['barcode', '1'.repeat(101)],
    ['orderNumber', 'B'.repeat(101)],
    ['barcode', ['12', '34']],
    ['orderNumber', ['BILL-1', 'BILL-2']],
    ['startDate', '2026-02-30'],
    ['endDate', 'invalid'],
    ['page', '0'],
    ['limit', '201'],
  ])('rejects an invalid %s', async (key, value) => {
    const query = plainToInstance(QueryImportedSalesDto, { [key]: value });
    const errors = await validate(query, { whitelist: true });
    expect(errors.map(({ property }) => property)).toEqual([key]);
  });
});
