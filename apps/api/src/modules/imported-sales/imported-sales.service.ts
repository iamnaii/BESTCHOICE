import { currentDomainAccess, domainAccessClient } from '../employee-access/access-execution-context';
import { assertImportedSource, importedCompanyAllows } from '../employee-access/access-imported-source';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

export interface Bucket { key: string; count: number; sales: string; profit: string | null }

@Injectable()
export class ImportedSalesService {
  constructor(private readonly basePrisma: PrismaService) {}
  private get prisma() { return domainAccessClient(this.basePrisma); }

  private buildWhere(q: QueryImportedSalesDto): Prisma.ImportedSaleWhereInput {
    const where: Prisma.ImportedSaleWhereInput = currentDomainAccess() ? { source: 'TOOLTIFY' } : {};
    if (q.saleChannel) where.saleChannel = q.saleChannel;
    if (q.category) where.category = q.category;
    if (q.salespersonName) where.salespersonName = { contains: q.salespersonName };
    if (q.startDate || q.endDate) {
      where.soldAt = {};
      if (q.startDate) where.soldAt.gte = new Date(q.startDate);
      if (q.endDate) where.soldAt.lte = new Date(q.endDate);
    }
    return where;
  }

  async list(q: QueryImportedSalesDto) {
    if (currentDomainAccess()) await assertImportedSource();
    const where = this.buildWhere(q);
    const operations = (db: Pick<PrismaService, 'importedSale'>) => [
      db.importedSale.findMany({
        where,
        orderBy: { soldAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      db.importedSale.count({ where }),
    ] as const;
    const [data, total] = currentDomainAccess()
      ? await this.prisma.$transaction(tx => Promise.all(operations(tx)))
      : await this.basePrisma.$transaction([...operations(this.basePrisma)]);
    const cost = !currentDomainAccess() || importedCompanyAllows('sensitive.cost.read');
    const profit = cost && (!currentDomainAccess() || importedCompanyAllows('sensitive.profit.read'));
    return { data: currentDomainAccess() ? data.map(row => ({ ...row, costTotal: cost ? row.costTotal : null, profit: profit ? row.profit : null })) : data, total, page: q.page, limit: q.limit };
  }

  async summary(q: QueryImportedSalesDto) {
    if (currentDomainAccess()) await assertImportedSource();
    const where = this.buildWhere(q);
    const rows = await this.prisma.importedSale.findMany({
      where,
      select: { soldAt: true, saleChannel: true, salespersonName: true, category: true, salePrice: true, profit: true, costTotal: true },
    });

    const cost = !currentDomainAccess() || importedCompanyAllows('sensitive.cost.read');
    const profit = cost && (!currentDomainAccess() || importedCompanyAllows('sensitive.profit.read'));
    const bucket = (keyOf: (r: (typeof rows)[number]) => string): Bucket[] => {
      const m = new Map<string, { count: number; sales: Prisma.Decimal; profit: Prisma.Decimal }>();
      for (const r of rows) {
        const k = keyOf(r);
        const acc = m.get(k) ?? { count: 0, sales: new Prisma.Decimal(0), profit: new Prisma.Decimal(0) };
        acc.count += 1;
        acc.sales = acc.sales.plus(r.salePrice);
        acc.profit = acc.profit.plus(r.profit);
        m.set(k, acc);
      }
      return [...m.entries()].map(([key, v]) => ({ key, count: v.count, sales: v.sales.toString(), profit: profit ? v.profit.toString() : null }));
    };

    const totalSales = rows.reduce((a, r) => a.plus(r.salePrice), new Prisma.Decimal(0));
    const totalProfit = rows.reduce((a, r) => a.plus(r.profit), new Prisma.Decimal(0));
    const totalCost = rows.reduce((a, r) => a.plus(r.costTotal), new Prisma.Decimal(0));

    const monthKey = (r: (typeof rows)[number]) => {
      const d = r.soldAt;
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    return {
      totals: { count: rows.length, sales: totalSales.toString(), profit: profit ? totalProfit.toString() : null, cost: cost ? totalCost.toString() : null },
      byMonth: bucket(monthKey).sort((a, b) => a.key.localeCompare(b.key)),
      byChannel: bucket((r) => r.saleChannel),
      bySalesperson: bucket((r) => r.salespersonName),
      byCategory: bucket((r) => r.category),
    };
  }
}
