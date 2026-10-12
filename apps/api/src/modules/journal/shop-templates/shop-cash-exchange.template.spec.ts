import { Prisma } from '@prisma/client';
import { ShopCashExchangeTemplate } from '../cpa-templates/shop-cash-exchange.template';
import {
  makeMockCompanyResolver,
  makeMockJournalAuto,
  makeMockPrisma,
  seedExistingJournalEntry,
} from './test-helpers';

const USED = {
  inventoryAccountCode: 'S11-2002',
  cogsAccountCode: 'S50-1102',
  revenueAccountCode: 'S41-1102',
};
const base = {
  afterSalesCaseId: 'as-1',
  caseNumber: 'AS-20261012-0001',
  saleId: 'sale-1',
  saleNumber: 'SL-0001',
  oldProductId: 'p-old',
  newProductId: 'p-new',
  oldAccounts: USED,
  newAccounts: USED,
};

describe('ShopCashExchangeTemplate (PR 5 — คำตอบฝ่ายบัญชีข้อ 10)', () => {
  function build() {
    const journal = makeMockJournalAuto();
    const prisma = makeMockPrisma();
    const resolver = makeMockCompanyResolver();
    return {
      template: new ShopCashExchangeTemplate(journal.service, prisma.prisma, resolver),
      journal,
      prisma,
    };
  }

  it('ตัวอย่างข้อ 10: ต้นทุนเดิม 10,700 / ใหม่ 10,500 → 4 บรรทัด สมดุล · ไม่แตะรายได้/เงินสด', async () => {
    const { template, journal } = build();
    const r = await template.execute({
      ...base,
      oldCost: new Prisma.Decimal('10700.00'),
      newCost: new Prisma.Decimal('10500.00'),
    });
    expect(r).toEqual({ entryNo: 'JE-je-1', journalEntryId: 'je-1' });
    const lines = journal.state.lastInput!.lines;
    expect(lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['S11-2002', '10700.00', '0.00'],
      ['S50-1102', '0.00', '10700.00'],
      ['S50-1102', '10500.00', '0.00'],
      ['S11-2002', '0.00', '10500.00'],
    ]);
    expect(
      lines.some(
        (l) =>
          l.accountCode.startsWith('S41') ||
          l.accountCode.startsWith('S11-11') ||
          l.accountCode.startsWith('S11-12'),
      ),
    ).toBe(false);
    const input = (journal.service.createAndPost as jest.Mock).mock.calls[0][0];
    expect(input.reference).toBe('sale:sale-1:exchange:as-1');
    expect(input.metadata).toMatchObject({
      tag: 'SHOP_CASH_EXCHANGE',
      flow: 'shop-cash-exchange',
      idempotencyKey: 'shop-cash-exchange:as-1',
      saleId: 'sale-1',
      afterSalesCaseId: 'as-1',
      oldProductId: 'p-old',
      newProductId: 'p-new',
      oldCost: '10700.00',
      newCost: '10500.00',
      companyCode: 'SHOP',
    });
    expect(input.metadata).not.toHaveProperty('contractId');
    expect(input.companyId).toBe('shop-co-id');
  });

  it('ต้นทุนเดิม 0 (ไม่เคยลงตอนขาย) → ลงเฉพาะคู่ของเครื่องทดแทน (2 บรรทัด)', async () => {
    const { template, journal } = build();
    await template.execute({
      ...base,
      oldCost: new Prisma.Decimal(0),
      newCost: new Prisma.Decimal('10500.00'),
    });
    expect(journal.state.lastInput!.lines).toHaveLength(2);
  });

  it('ทั้งสองเป็น 0 → ไม่โพสต์ คืน null', async () => {
    const { template, journal } = build();
    const r = await template.execute({
      ...base,
      oldCost: new Prisma.Decimal(0),
      newCost: new Prisma.Decimal(0),
    });
    expect(r).toBeNull();
    expect(journal.state.callCount).toBe(0);
  });

  it('ต้นทุนติดลบ → BadRequest ไม่โพสต์', async () => {
    const { template, journal } = build();
    await expect(
      template.execute({ ...base, oldCost: new Prisma.Decimal('-1'), newCost: new Prisma.Decimal(1) }),
    ).rejects.toThrow();
    expect(journal.state.callCount).toBe(0);
  });

  it('idempotent: มี JE flow+key เดิมแล้ว → คืนของเดิม ไม่โพสต์ซ้ำ', async () => {
    const { template, journal, prisma } = build();
    seedExistingJournalEntry(
      prisma.state,
      'shop-cash-exchange',
      'shop-cash-exchange:as-1',
      'je-old',
      'JE-OLD',
    );
    const r = await template.execute({
      ...base,
      oldCost: new Prisma.Decimal(1),
      newCost: new Prisma.Decimal(1),
    });
    expect(r).toEqual({ entryNo: 'JE-OLD', journalEntryId: 'je-old' });
    expect(journal.state.callCount).toBe(0);
  });
});
