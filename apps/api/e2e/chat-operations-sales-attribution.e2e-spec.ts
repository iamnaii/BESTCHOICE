import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { ChatAnalyticsV2Service } from '../src/modules/chat-analytics/chat-analytics-v2.service';
import { ChatSalesAttributionService } from '../src/modules/chat-analytics/chat-sales-attribution.service';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use disposable harness');
describe('Scoped canonical chat-linked sales and current evidence funnel', () => {
  const db = new PrismaService();
  const svc = new ChatSalesAttributionService(
    db,
    new ChatAnalyticsV2Service(db, new ChatWorkAccessService(db)),
  );
  let owner: ChatWorkActor,
    seller: ChatWorkActor,
    finance: ChatWorkActor,
    branchId: string,
    otherBranch: string,
    customerId: string,
    aliasId: string,
    productId: string,
    contractId: string;
  const at = new Date('2026-10-05T05:00:00Z'),
    observed = new Date('2026-10-07T05:00:00Z');
  const q = () => ({
    company: 'SHOP' as const,
    branchId,
    from: '2026-10-05T00:00:00+07:00',
    to: '2026-10-06T00:00:00+07:00',
    page: 1,
    limit: 20,
  });
  const staff = async (role: 'OWNER' | 'SALES' | 'FINANCE_MANAGER', companies: string[]) =>
    db.user.create({
      data: {
        role,
        branchId,
        name: role,
        email: `${randomUUID()}@sales-analytics.invalid`,
        password: 'unused',
        accessibleCompanies: companies,
      },
    });
  const room = async (
    customer = customerId,
    channel: 'FACEBOOK' | 'LINE_FINANCE' = 'FACEBOOK',
    date = new Date('2026-10-05T03:00:00Z'),
  ) => {
    const r = await db.chatRoom.create({
      data: { channel, customerId: customer, assignedToId: seller.id },
    });
    await db.chatMessage.create({
      data: { roomId: r.id, role: 'CUSTOMER', text: 'proof', createdAt: date },
    });
    return r;
  };
  const sale = async (customer = customerId, options: Record<string, unknown> = {}) =>
    db.sale.create({
      data: {
        saleNumber: `analytics-${randomUUID()}`,
        saleType: 'CASH',
        customerId: customer,
        productId,
        branchId,
        salespersonId: seller.id,
        sellingPrice: '100.10',
        netAmount: '100.10',
        createdAt: at,
        ...options,
      },
    });
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Sales analytics' } })).id;
    otherBranch = (await db.branch.create({ data: { name: 'Foreign sales analytics' } })).id;
    owner = await staff('OWNER', ['SHOP', 'FINANCE']);
    seller = await staff('SALES', ['SHOP']);
    finance = await staff('FINANCE_MANAGER', ['FINANCE']);
    customerId = (await db.customer.create({ data: { name: 'Canonical buyer' } })).id;
    aliasId = (
      await db.customer.create({
        data: { name: 'Absorbed lead', mergedIntoId: customerId, deletedAt: at },
      })
    ).id;
    productId = (
      await db.product.create({
        data: {
          name: 'Analytics phone',
          brand: 'Apple',
          model: 'Phone',
          category: 'PHONE_USED',
          branchId,
          costPrice: 1,
        },
      })
    ).id;
    contractId = (
      await db.contract.create({
        data: {
          contractNumber: `analytics-${randomUUID()}`,
          customerId,
          productId,
          branchId,
          salespersonId: seller.id,
          status: 'ACTIVE',
          planType: 'STORE_DIRECT',
          sellingPrice: '200.20',
          downPayment: '50',
          financedAmount: '150.20',
          interestRate: 0.02,
          interestTotal: 10,
          totalMonths: 10,
          monthlyPayment: 16.02,
          createdAt: at,
        },
      })
    ).id;
    await db.systemConfig.upsert({
      where: { key: 'chat_analytics_v2_enabled' },
      create: { key: 'chat_analytics_v2_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
    await room(aliasId);
    await room();
    await sale(aliasId);
    await sale(customerId, {
      saleType: 'INSTALLMENT',
      contractId,
      netAmount: '200.20',
      sellingPrice: '200.20',
    });
  });
  afterAll(async () => {
    await db.user.updateMany({
      where: { id: { in: [owner.id, seller.id, finance.id] } },
      data: { isActive: false },
    });
    await db.$disconnect();
  });
  it('deduplicates canonical aliases and sale-contract links, keeps Decimal and actual salesperson', async () => {
    const result = await svc.sales(q(), owner, observed);
    expect(result).toMatchObject({
      amount: '300.30',
      documentCount: 2,
      customerCount: 1,
      unmatchedCount: 0,
    });
    expect(result.data).toHaveLength(2);
    expect(new Set(result.data.map((x) => x.businessSaleKey)).size).toBe(2);
    expect(
      result.data.every((x) => x.salespersonId === seller.id && x.customerId === customerId),
    ).toBe(true);
    expect((await svc.sales({ ...q(), staffId: owner.id }, owner, observed)).documentCount).toBe(0);
    const paged = await svc.sales({ ...q(), limit: 1, page: 2 }, owner, observed);
    expect(paged.total).toBe(2);
    expect(paged.data).toHaveLength(1);
    const exported = await svc.exportSales(q(), owner, observed);
    expect(exported.total).toBe(2);
    expect(exported.data.map((x) => x.id).sort()).toEqual(result.data.map((x) => x.id).sort());
  });
  it('uses current scoped journey, records skipped credit for cash and keeps lost in denominator', async () => {
    const cash = (await db.customer.create({ data: { name: 'Cash path' } })).id;
    await room(cash);
    await sale(cash);
    const lost = (await db.customer.create({ data: { name: 'Lost lead' } })).id;
    const r = await room(lost);
    await db.customerJourneyEntry.create({
      data: {
        customerId: lost,
        originCustomerId: lost,
        origin: 'MANUAL',
        kind: 'MARKED_LOST',
        actorType: 'STAFF',
        actorUserId: seller.id,
        roomId: r.id,
        occurredAt: at,
        lostReason: 'NOT_INTERESTED',
      },
    });
    const f = await svc.funnel(q(), owner, observed);
    expect(f.customerCount).toBe(3);
    expect(f.steps.find((x) => x.stage === 'PURCHASED')).toMatchObject({ reached: 2 });
    expect(f.steps.find((x) => x.stage === 'CREDIT')!.skipped).toBeGreaterThanOrEqual(1);
    expect(f.lossReasons).toContainEqual({ reason: 'NOT_INTERESTED', count: 1 });
    const detail = await svc.funnelDetails(
      { ...q(), stage: 'PURCHASED', state: 'reached' },
      owner,
      observed,
    );
    expect(detail.total).toBe(2);
  });
  it('does not count voids, draft contracts, other branch or chat after sale; separates FINANCE principal', async () => {
    const stranger = (await db.customer.create({ data: { name: 'No prior chat' } })).id;
    await sale(stranger);
    await room(stranger, 'FACEBOOK', new Date('2026-10-05T06:00:00Z'));
    const draft = await db.contract.create({
      data: {
        contractNumber: `draft-${randomUUID()}`,
        customerId,
        productId,
        branchId,
        salespersonId: seller.id,
        status: 'DRAFT',
        planType: 'STORE_DIRECT',
        sellingPrice: 999,
        downPayment: 0,
        financedAmount: 999,
        interestRate: 0.02,
        interestTotal: 0,
        totalMonths: 10,
        monthlyPayment: 99.9,
        createdAt: at,
      },
    });
    await sale(customerId, { saleType: 'INSTALLMENT', contractId: draft.id, netAmount: 999 });
    await sale(customerId, { deletedAt: at });
    await sale(customerId, { branchId: otherBranch });
    const all = await svc.sales(q(), owner, observed);
    expect(all.documentCount).toBe(3);
    expect(all.unmatchedCount).toBe(1);
    expect(all.amount).toBe('400.40');
    await expect(svc.sales({ ...q(), branchId: otherBranch }, seller, observed)).rejects.toThrow();
    await expect(svc.sales(q(), finance, observed)).rejects.toThrow();
    const fq = { ...q(), company: 'FINANCE' as const };
    expect((await svc.sales(fq, finance, observed)).documentCount).toBe(0);
    await room(customerId, 'LINE_FINANCE');
    const fin = await svc.sales(fq, finance, observed);
    expect(fin).toMatchObject({ amount: '150.20', documentCount: 1 });
    expect(fin.basis).toContain('เงินต้น');
    const ff = await svc.funnel(fq, finance, observed);
    expect(ff.customerCount).toBe(1);
    expect(ff.steps.find((x) => x.stage === 'PURCHASED')!.reached).toBe(1);
    await db.user.update({ where: { id: finance.id }, data: { accessibleCompanies: ['SHOP'] } });
    await expect(svc.sales(fq, finance, observed)).rejects.toThrow();
  });
  it('does not move an earlier cohort forward, invent inbound from room creation, or leak another branch purchase', async () => {
    const earlier = (await db.customer.create({ data: { name: 'Earlier inbound' } })).id;
    await room(earlier, 'FACEBOOK', new Date('2026-10-01T03:00:00Z'));
    await room(earlier);
    const unproven = (await db.customer.create({ data: { name: 'Imported unknown' } })).id;
    await db.chatRoom.create({
      data: { channel: 'FACEBOOK', customerId: unproven, assignedToId: seller.id, createdAt: at },
    });
    const foreignCustomer = (await db.customer.create({ data: { name: 'Branch evidence' } })).id;
    await room(foreignCustomer);
    await sale(foreignCustomer, { branchId: otherBranch });
    const rows = await svc.funnelDetails(
      { ...q(), stage: 'CONTACTED', state: 'all' },
      owner,
      observed,
    );
    expect(rows.data.some((r) => r.customerId === earlier || r.customerId === unproven)).toBe(
      false,
    );
    expect(rows.data.find((r) => r.customerId === foreignCustomer)!.stage).toBe('CONTACTED');
    const empty = await svc.sales(
      { ...q(), from: '2025-01-01T00:00:00Z', to: '2025-01-02T00:00:00Z' },
      owner,
      observed,
    );
    expect(empty).toMatchObject({ amount: '0.00', documentCount: 0, total: 0 });
    await db.user.update({ where: { id: seller.id }, data: { role: 'BRANCH_MANAGER' } });
    await expect(svc.sales({ ...q(), branchId: otherBranch }, seller, observed)).rejects.toThrow();
  });
});
