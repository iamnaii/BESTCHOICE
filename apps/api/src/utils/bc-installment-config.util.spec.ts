import { Prisma } from '@prisma/client';
import { resolveBcConfigForCategory, toBcConfig } from './bc-installment-config.util';

const makePrisma = (cfg: unknown) =>
  ({ interestConfig: { findFirst: jest.fn().mockResolvedValue(cfg) } }) as never;

const baseCfg = {
  id: 'ic-1',
  minDownPaymentPct: new Prisma.Decimal('0.20'),
  storeCommissionPct: new Prisma.Decimal('0.05'),
  vatPct: new Prisma.Decimal('0.07'),
  interestRate: new Prisma.Decimal('0.10'),
  minInstallmentMonths: 6,
  maxInstallmentMonths: 8,
  rates: [] as { months: number; ratePct: Prisma.Decimal }[],
};

describe('resolveBcConfigForCategory', () => {
  it('ค้นด้วย productCategories (ตรงกับ sale-writer / contract-lifecycle / installment-preview)', async () => {
    const prisma = makePrisma(baseCfg);
    await resolveBcConfigForCategory(prisma, 'PHONE_USED');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((prisma as any).interestConfig.findFirst as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({
      productCategories: { has: 'PHONE_USED' },
      deletedAt: null,
      isActive: true,
    });
    // deterministic: config เก่าสุดชนะ — ตรงกับ ProductQuoteService ของ B2
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('ไม่พบ config → found=false', async () => {
    expect(await resolveBcConfigForCategory(makePrisma(null), 'PHONE_NEW')).toEqual({ found: false });
  });

  it('มี InterestConfigRate → ใช้ ratePct ต่อ term ตรง ๆ', async () => {
    const r = await resolveBcConfigForCategory(
      makePrisma({
        ...baseCfg,
        rates: [
          { months: 6, ratePct: new Prisma.Decimal('0.45') },
          { months: 12, ratePct: new Prisma.Decimal('0.90') },
        ],
      }),
      'PHONE_NEW',
    );
    expect(r.config!.allowedMonths).toEqual([6, 12]);
    expect(r.config!.ratePctByMonths.get(12)!.toString()).toBe('0.9');
  });

  it('ไม่มี rate rows → สังเคราะห์จาก interestRate × months ตามช่วง min..max (parity กับ preview)', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    expect(r.config!.allowedMonths).toEqual([6, 7, 8]);
    expect(r.config!.ratePctByMonths.get(6)!.toString()).toBe('0.6');
    expect(r.config!.ratePctByMonths.get(8)!.toString()).toBe('0.8');
  });

  it('ส่ง minDownPct / commissionPct / vatPct ต่อออกมาครบ', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    expect(r.config!.minDownPct.toString()).toBe('0.2');
    expect(r.config!.commissionPct.toString()).toBe('0.05');
    expect(r.config!.vatPct.toString()).toBe('0.07');
  });
});

describe('toBcConfig — ตัว map ที่ทุกผู้อ่านต้องใช้ร่วมกัน (B3 Task 14)', () => {
  it('มี rate rows → allowedMonths/ratePctByMonths มาจากตารางตรง ๆ', () => {
    const c = toBcConfig({
      ...baseCfg,
      rates: [
        { months: 6, ratePct: new Prisma.Decimal('0.45') },
        { months: 12, ratePct: new Prisma.Decimal('0.90') },
      ],
    });
    expect(c.allowedMonths).toEqual([6, 12]);
    expect(c.ratePctByMonths.get(12)!.toString()).toBe('0.9');
  });

  it('ไม่มี rate rows → สังเคราะห์ interestRate × m ตามช่วง min..max', () => {
    const c = toBcConfig(baseCfg);
    expect(c.allowedMonths).toEqual([6, 7, 8]);
    expect(c.ratePctByMonths.get(8)!.toString()).toBe('0.8');
  });

  it('resolveBcConfigForCategory คืนผลเท่ากับ toBcConfig ของแถวเดียวกัน (ไม่มีตรรกะซ้อน)', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(baseCfg), 'PHONE_NEW');
    const direct = toBcConfig(baseCfg);
    expect(r.config!.allowedMonths).toEqual(direct.allowedMonths);
    expect(r.config!.minDownPct.toString()).toBe(direct.minDownPct.toString());
    expect([...r.config!.ratePctByMonths.entries()].map(([m, v]) => [m, v.toString()])).toEqual(
      [...direct.ratePctByMonths.entries()].map(([m, v]) => [m, v.toString()]),
    );
  });
});
