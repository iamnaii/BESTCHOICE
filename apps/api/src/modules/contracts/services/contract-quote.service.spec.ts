import { Prisma } from '@prisma/client';
import { ContractQuoteService } from './contract-quote.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';

const D = Prisma.Decimal;
describe('ContractQuoteService effective configuration and amounts', () => {
  const input = { customerId: 'customer', productId: 'product', branchId: 'branch', sellingPrice: 10000,
    downPayment: 2000, totalMonths: 6, paymentDueDay: 31 };
  const actor = { id: 'staff', role: 'SALES', branchId: 'branch' };
  let service: ContractQuoteService;
  let db: ReturnType<typeof makeDb>;
  const previousFlag = process.env.USE_NEW_RATE_LOOKUP;
  const config = { id: 'config-oldest', interestRate: new D('.01'), minDownPaymentPct: new D('.15'),
    storeCommissionPct: new D('.10'), vatPct: new D('.07'), minInstallmentMonths: 6, maxInstallmentMonths: 12, deletedAt: null };
  const makeDb = () => ({
    product: { findUnique: jest.fn().mockResolvedValue({ id: 'product', branchId: 'branch', category: 'PHONE_NEW', deletedAt: null, costPrice: new D(6000) }) },
    interestConfig: { findFirst: jest.fn().mockResolvedValue(config), findUnique: jest.fn().mockResolvedValue(config) },
    interestConfigRate: { findUnique: jest.fn().mockResolvedValue({ ratePct: new D('.12'), deletedAt: null }) },
    systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
    branch: { findUnique: jest.fn().mockResolvedValue({ id: 'branch', deletedAt: null, company: { vatRegistered: false, vatRate: new D('.07') } }) },
    $transaction: jest.fn(),
  });
  beforeEach(() => {
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    jest.useFakeTimers().setSystemTime(new Date('2026-01-31T16:30:00.000Z'));
    db = makeDb(); service = new ContractQuoteService(db as unknown as PrismaService);
  });
  afterEach(() => {
    jest.useRealTimers(); jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.USE_NEW_RATE_LOOKUP; else process.env.USE_NEW_RATE_LOOKUP = previousFlag;
  });
  it.each([false, true])('matches branch VAT registration=%s and the actual schedule residual', async registered => {
    db.branch.findUnique.mockResolvedValue({ id: 'branch', deletedAt: null, company: { vatRegistered: registered, vatRate: new D('.07') } });
    const quote = await service.resolve(input, actor);
    expect(quote.effectiveVatPct).toBe(registered ? '0.0700' : '0.0000');
    expect(quote.vatSource).toBe('BRANCH_COMPANY');
    expect(quote.monthlyPayment).toBe(registered ? '1654.93' : '1546.66');
    expect(quote.lastPayment).toBe(registered ? '1654.95' : '1546.70');
    expect(quote.firstDueDate).toBe('2026-02-27T17:00:00.000Z');
    expect(quote.schedule.reduce((sum, row) => sum.plus(row.amountDue), new D(0)).toFixed(2)).toBe(quote.totalPayable);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    { price: 25000, down: 5000, months: 12, interest: '.015', principal: '20000.00', total: '27392.00', monthly: '2282.66' },
    { price: 30000, down: 6000, months: 24, interest: '.015', principal: '24000.00', total: '37492.80', monthly: '1562.20' },
    { price: 10000, down: 0, months: 10, interest: '0', principal: '10000.00', total: '11770.00', monthly: '1177.00' },
  ])('calculates the actual persisted policy for $price / $down / $months', async row => {
    const selected = { ...config, interestRate: new D(row.interest), minDownPaymentPct: new D(0), maxInstallmentMonths: 24 };
    db.interestConfig.findFirst.mockResolvedValue(selected); db.interestConfig.findUnique.mockResolvedValue(selected);
    db.branch.findUnique.mockResolvedValue({ id: 'branch', deletedAt: null, company: { vatRegistered: true, vatRate: new D('.07') } });
    const quote = await service.resolve({ ...input, sellingPrice: row.price, downPayment: row.down, totalMonths: row.months }, actor);
    expect(quote.principal).toBe(row.principal); expect(quote.totalPayable).toBe(row.total); expect(quote.monthlyPayment).toBe(row.monthly);
  });

  it('selects a deterministic oldest config and respects the per-term rate flag', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    const quote = await service.resolve(input, actor);
    expect(quote.interestTotal).toBe('960.00');
    expect(db.interestConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    expect(db.interestConfigRate.findUnique).toHaveBeenCalledWith({ where: { configId_months: { configId: 'config-oldest', months: 6 } } });
  });
  it('fails closed when the enabled rate table lacks the requested term', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true'; db.interestConfigRate.findUnique.mockResolvedValue(null);
    await expect(service.resolve(input, actor)).rejects.toThrow(/ไม่พบอัตราดอกเบี้ย/);
  });
  it('keeps fingerprints stable within a Thai calendar month and invalidates changed effective config', async () => {
    const first = await service.resolve(input, actor);
    jest.setSystemTime(new Date('2026-01-31T16:59:59.000Z'));
    expect((await service.resolve(input, actor)).fingerprint).toBe(first.fingerprint);
    db.branch.findUnique.mockResolvedValue({ id: 'branch', deletedAt: null, company: { vatRegistered: true, vatRate: new D('.07') } });
    expect((await service.resolve(input, actor)).fingerprint).not.toBe(first.fingerprint);
  });
  it.each([{ ...actor, branchId: 'other' }, { id: 'staff', role: 'SALES' }])('rejects out-of-scope actors before reading configuration', async scopedActor => {
    await expect(service.resolve(input, scopedActor)).rejects.toThrow();
    expect(db.interestConfig.findFirst).not.toHaveBeenCalled();
  });
  it('normalizes amounts before computing principal and fingerprints', async () => {
    const quote = await service.resolve({ ...input, sellingPrice: 10000.004, downPayment: 2000.005 }, actor);
    expect(quote.sellingPrice).toBe('10000.00'); expect(quote.downPayment).toBe('2000.01');
    expect(quote.principal).toBe('7999.99');
    expect(quote.fingerprint).toBe((await service.resolve({ ...input, sellingPrice: 10000, downPayment: 2000.01 }, actor)).fingerprint);
  });
  it('reports the rate actually charged when an old caller supplies an unused scalar override', async () => {
    const quote = await service.resolve({ ...input, interestRate: .02 }, actor);
    expect(quote.ratePct).toBe('0.06000000'); expect(quote.interestRate).toBe('0.0100');
    expect(quote.interestTotal).toBe('480.00');
  });
  it('applies trade-in bonus and base once while keeping new cash down separate', async () => {
    jest.spyOn(TradeInCreditService.prototype, 'quote').mockResolvedValue({ base: new D(1000), bonus: new D(500), net: new D(9500) } as never);
    const quote = await service.resolve({ ...input, tradeInCreditId: 'trade' }, { ...actor, role: 'OWNER' });
    expect(quote.sellingPrice).toBe('9500.00'); expect(quote.downPayment).toBe('3000.00');
    expect(quote.cashDownPayment).toBe('2000.00'); expect(quote.tradeInCreditAmount).toBe('1000.00');
    expect(quote.principal).toBe('6500.00');
  });
});
