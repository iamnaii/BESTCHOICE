import { Prisma } from '@prisma/client';
import { InterestConfigService } from './interest-config.service';
import { resolveBcConfig } from './resolve-bc-config';
import { resolveBcConfigForCategory, toBcConfig } from '../../utils/bc-installment-config.util';
import { resolveInstallmentParams, resolveInstallmentVat } from '../../utils/config.util';

/**
 * Owner decision #22 (2026-10-31): the VAT of the interest settings is read from the FINANCE company only
 * (`company_info.vat_rate` / `vat_registered` of `company_code = 'FINANCE'`). `interest_configs.vat_pct` stays in the
 * table (no destructive migration) but nobody reads it to calculate and the API never writes it.
 *
 * Every fixture row carries vat_pct 0.10 on purpose — a value no FINANCE row has — so a reader that still uses the
 * column is caught.
 */
const ROW_VAT = new Prisma.Decimal('0.10');
const configRow = {
  id: 'ic-1',
  name: 'มือ 1',
  productCategories: ['PHONE_NEW'],
  interestRate: new Prisma.Decimal('0.03'),
  minDownPaymentPct: new Prisma.Decimal('0.15'),
  storeCommissionPct: new Prisma.Decimal('0.10'),
  vatPct: ROW_VAT,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  isActive: true,
  rates: [{ months: 6, ratePct: new Prisma.Decimal('0.18') }],
};

type Finance = { vatRegistered: boolean; vatRate: Prisma.Decimal | null } | null;
const financeRegistered: Finance = { vatRegistered: true, vatRate: new Prisma.Decimal('0.0700') };

function makePrisma(finance: Finance, systemVat: string | null = null) {
  return {
    interestConfig: {
      findFirst: jest.fn().mockResolvedValue(configRow),
      findMany: jest.fn().mockResolvedValue([configRow]),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...configRow, ...args.data }),
      ),
      update: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...configRow, ...args.data }),
      ),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue(finance) },
    systemConfig: {
      findMany: jest
        .fn()
        .mockResolvedValue(systemVat == null ? [] : [{ key: 'VAT_RATE', value: systemVat }]),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  };
}

describe('resolveInstallmentVat — FINANCE first, then the system VAT setting (never interest_configs.vat_pct)', () => {
  it('FINANCE registered with a rate → that rate', async () => {
    await expect(resolveInstallmentVat(makePrisma(financeRegistered) as never)).resolves.toEqual({
      vatPct: 0.07,
      source: 'FINANCE_COMPANY',
    });
  });

  it('FINANCE not VAT-registered → 0', async () => {
    const prisma = makePrisma({ vatRegistered: false, vatRate: null });
    await expect(resolveInstallmentVat(prisma as never)).resolves.toEqual({
      vatPct: 0,
      source: 'FINANCE_COMPANY',
    });
    expect(prisma.systemConfig.findMany).not.toHaveBeenCalled();
  });

  it('no FINANCE row → system VAT_RATE (Settings › บัญชี & ภาษี › VAT)', async () => {
    await expect(resolveInstallmentVat(makePrisma(null, '8') as never)).resolves.toEqual({
      vatPct: 0.08,
      source: 'CONFIG_FALLBACK',
    });
  });
});

describe('#22 readers use the FINANCE VAT, not interest_configs.vat_pct', () => {
  it('resolveInstallmentParams no longer returns a VAT (contract quote reads FINANCE)', () => {
    const params = resolveInstallmentParams(
      configRow,
      {
        interestRate: 0.08,
        minDownPaymentPct: 0.15,
        minInstallmentMonths: 6,
        maxInstallmentMonths: 12,
        storeCommissionPct: 0.1,
        vatPct: 0.07,
      },
      undefined,
    );
    expect(params).not.toHaveProperty('vatPct');
  });

  it('toBcConfig takes the VAT from its caller (bot · web shop · chat product cards)', () => {
    expect(toBcConfig(configRow, 0.07).vatPct.toString()).toBe('0.07');
  });

  it('resolveBcConfigForCategory → FINANCE VAT', async () => {
    const r = await resolveBcConfigForCategory(makePrisma(financeRegistered) as never, 'PHONE_NEW');
    expect(r.config!.vatPct.toString()).toBe('0.07');
  });

  it('resolveBcConfig (GET /interest-configs/resolved · stock sort) → FINANCE VAT, also when no config matches', async () => {
    const prisma = makePrisma({ vatRegistered: true, vatRate: new Prisma.Decimal('0.05') });
    expect((await resolveBcConfig(prisma as never, 'PHONE_NEW')).vatPct).toBe(0.05);
    prisma.interestConfig.findFirst.mockResolvedValue(null);
    expect((await resolveBcConfig(prisma as never, 'PHONE_NEW')).vatPct).toBe(0.05);
  });
});

describe('#22 InterestConfigService — vatPct in responses is the FINANCE VAT; writes never touch vat_pct', () => {
  const service = (prisma: ReturnType<typeof makePrisma>) => {
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(prisma));
    return new InterestConfigService(prisma as never);
  };

  it('findAll / findOne / findByCategory replace vatPct with the FINANCE VAT', async () => {
    const prisma = makePrisma(financeRegistered);
    const svc = service(prisma);
    const [all] = await svc.findAll();
    expect(Number(all.vatPct)).toBe(0.07);
    expect(Number((await svc.findOne('ic-1')).vatPct)).toBe(0.07);
    expect(Number((await svc.findByCategory('PHONE_NEW'))!.vatPct)).toBe(0.07);
  });

  it('create / update drop a vatPct sent by an old client', async () => {
    const prisma = makePrisma(financeRegistered);
    const svc = service(prisma);
    await svc.create({
      name: 'มือ 2',
      productCategories: ['PHONE_USED'],
      interestRate: 0.03,
      minDownPaymentPct: 0.15,
      minInstallmentMonths: 6,
      maxInstallmentMonths: 12,
      vatPct: 0.1,
    } as never);
    expect(prisma.interestConfig.create.mock.calls[0][0].data).not.toHaveProperty('vatPct');

    await svc.update('ic-1', { vatPct: 0.1, name: 'มือ 1 ใหม่' } as never);
    expect(prisma.interestConfig.update.mock.calls[0][0].data).toEqual({ name: 'มือ 1 ใหม่' });
  });
});
