import { PrismaClient } from '@prisma/client';
import { CustomerPiiService } from '../src/modules/customers/customer-pii.service';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { readExportSnapshot } from '../src/common/helpers/export-snapshot';
import { CustomerQueryService } from '../src/modules/customers/services/customer-query.service';
import { CustomerTierService } from '../src/modules/customers/customer-tier.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use isolated tools/test-chat-credit.sh');

describe('Server export snapshot and 10,000-customer benchmark', () => {
  const db = new PrismaService();
  const prefix = `ISOLATED-EXPORT-${randomUUID()}`;
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => { await db.$disconnect(); });

  it('keeps row values consistent across a concurrent same-count update and prohibits writes', async () => {
    const customer = await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId: randomUUID() } });
    const result = await readExportSnapshot(db, async tx => {
      const first = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
      await db.customer.update({ where: { id: customer.id }, data: { name: `${prefix}-CHANGED` } });
      const second = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(second.name).toBe(first.name);
      return { data: [second], total: 1 };
    });
    expect(result.data[0].name).toBe(prefix);
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe(`${prefix}-CHANGED`);
    await expect(readExportSnapshot(db, async tx => {
      await tx.customer.update({ where: { id: customer.id }, data: { name: 'SHOULD NOT WRITE' } });
      return { data: [], total: 0 };
    })).rejects.toThrow();
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe(`${prefix}-CHANGED`);
  });

  it('exports 10,000 customer histories in one tier pass and rejects an oversized dataset', async () => {
    const label = `${prefix}-BENCH`;
    const branch = await db.branch.create({ data: { name: label } });
    const user = await db.user.create({ data: { name: label, email: `${prefix}@example.invalid`, password: 'unused', role: 'OWNER' } });
    const product = await db.product.create({ data: { name: label, brand: 'TEST', model: 'TEST', category: 'PHONE_NEW', branchId: branch.id, costPrice: 1 } });
    for (let offset = 0; offset < 10_000; offset += 500) {
      const ids = Array.from({ length: 500 }, () => ({ customer: randomUUID(), contract: randomUUID() }));
      await db.customer.createMany({ data: ids.map((id, i) => ({ id: id.customer, name: `${label}-${offset + i}`, nationalId: id.customer, phone: '0800000000' })) });
      await db.contract.createMany({ data: ids.map((id, i) => ({ id: id.contract, contractNumber: `${label}-${offset + i}`, customerId: id.customer, productId: product.id,
        branchId: branch.id, salespersonId: user.id, planType: 'STORE_DIRECT', status: 'COMPLETED', sellingPrice: 10, downPayment: 0,
        interestRate: 0, totalMonths: 1, interestTotal: 0, financedAmount: 10, monthlyPayment: 10 })) });
      await db.payment.createMany({ data: ids.map(id => ({ contractId: id.contract, installmentNo: 1, dueDate: new Date('2026-01-01T00:00:00Z'), amountDue: 10, amountPaid: 10, status: 'PAID', paidAt: new Date('2026-01-01T00:00:00Z') })) });
    }
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('connection_limit', '1'); url.searchParams.set('pool_timeout', '2');
    const exportDb = new PrismaClient({ datasourceUrl: url.toString() }) as unknown as PrismaService;
    const tiers = new CustomerTierService(exportDb);
    const tierSpy = jest.spyOn(tiers, 'getCustomerTiers');
    const query = new CustomerQueryService(exportDb, tiers, new CustomerPiiService(exportDb));
    const started = performance.now();
    const result = await query.exportRows(label, 1, 50, undefined, false, undefined, undefined, 'name', 'asc', 'GOOD');
    const elapsedMs = Math.round(performance.now() - started);
    expect(result.data).toHaveLength(10_000);
    expect(new Set(result.data.map(row => row.id)).size).toBe(10_000);
    expect(tierSpy).toHaveBeenCalledTimes(1);
    expect(result.data.every(row => row.tier === 'GOOD')).toBe(true);
    console.info(JSON.stringify({ benchmark: 'synthetic-customer-export', customers: 10_000, contracts: 10_000, payments: 10_000, elapsedMs, payloadBytes: Buffer.byteLength(JSON.stringify(result)) }));
    await db.customer.create({ data: { name: `${label}-OVER`, nationalId: randomUUID(), phone: '0800000000' } });
    try { await expect(query.exportRows(label)).rejects.toThrow('ไม่เกิน 10,000'); } finally { await exportDb.$disconnect(); }
  }, 120_000);
});
