import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollRemittanceTemplate } from '../../journal/cpa-templates/payroll-remittance.template';

/**
 * นำส่ง ปกส. (สปส.1-10) + ภ.ง.ด.1 — payroll round 2 (2026-08-06).
 * Golden: per-book remittance (design D1) — แต่ละฝั่งล้างเจ้าหนี้ตัวเองจากธนาคารตัวเอง.
 */
describe('PayrollRemittanceTemplate', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let roles: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let companyResolver: any;
  let template: PayrollRemittanceTemplate;

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-REMIT-001', id: 'je-r-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      payrollLine: {
        // 2 insured employees: 750 + 875
        findMany: jest.fn().mockResolvedValue([
          { ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('0.00') },
          { ssoEmployee: new Decimal('875.00'), whtAmount: new Decimal('150.00') },
        ]),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      journalLine: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { credit: new Decimal('5000.00'), debit: new Decimal('0.00') },
        }),
      },
      // validatePeriodOpen reads accountingPeriod (+ systemConfig grace days)
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const roleMap: Record<string, string> = {
      sso_employee: '21-3105',
      sso_employer: '21-3106',
      wht_payroll: '21-3101',
      shop_sso_employee: 'S21-3105',
      shop_sso_employer: 'S21-3106',
      shop_wht_payroll: 'S21-3101',
    };
    roles = { code: jest.fn((r: string) => roleMap[r] ?? `__missing_${r}`) };
    companyResolver = {
      getShopCompanyId: jest.fn().mockResolvedValue('shop-co-1'),
      getFinanceCompanyId: jest.fn().mockResolvedValue('fin-co-1'),
    };
    template = new PayrollRemittanceTemplate(journal, prisma, roles, companyResolver);
  });

  it('SSO SHOP golden: Dr S21-3105 1,625 + Dr S21-3106 1,625 / Cr S11-1202 3,250 — companyId SHOP + idempotency key', async () => {
    const result = await template.executeSso({
      scope: 'SHOP',
      period: '2026-08',
      depositAccountCode: 'S11-1202',
    });

    expect(result.entryNo).toBe('JE-REMIT-001');
    expect(result.amountPerSide).toBe('1625.00');
    expect(result.total).toBe('3250.00');
    expect(result.employeeCount).toBe(2);

    const [args] = journal.createAndPost.mock.calls[0];
    const byCode = new Map(args.lines.map((l: { accountCode: string }) => [l.accountCode, l]));
    expect((byCode.get('S21-3105') as { dr: Decimal }).dr.toString()).toBe('1625');
    expect((byCode.get('S21-3106') as { dr: Decimal }).dr.toString()).toBe('1625');
    expect((byCode.get('S11-1202') as { cr: Decimal }).cr.toString()).toBe('3250');
    expect(args.companyId).toBe('shop-co-1');
    expect(args.metadata.flow).toBe('sso-remittance');
    expect(args.metadata.idempotencyKey).toBe('sso-remit:SHOP:2026-08');
    expect(args.metadata.entityScope).toBe('SHOP');

    // Balance
    const sumDr = args.lines.reduce(
      (s: Decimal, l: { dr: Decimal }) => s.plus(l.dr),
      new Decimal(0),
    );
    const sumCr = args.lines.reduce(
      (s: Decimal, l: { cr: Decimal }) => s.plus(l.cr),
      new Decimal(0),
    );
    expect(sumDr.toString()).toBe(sumCr.toString());
  });

  it('PND1 FINANCE golden: Dr 21-3101 150 / Cr 11-1201 150 — companyId FINANCE', async () => {
    const result = await template.executePnd1({
      scope: 'FINANCE',
      period: '2026-08',
      depositAccountCode: '11-1201',
    });

    expect(result.total).toBe('150.00');
    const [args] = journal.createAndPost.mock.calls[0];
    const byCode = new Map(args.lines.map((l: { accountCode: string }) => [l.accountCode, l]));
    expect((byCode.get('21-3101') as { dr: Decimal }).dr.toString()).toBe('150');
    expect((byCode.get('11-1201') as { cr: Decimal }).cr.toString()).toBe('150');
    expect(args.companyId).toBe('fin-co-1');
    expect(args.metadata.idempotencyKey).toBe('pnd1-remit:FINANCE:2026-08');
  });

  it('rejects when the period has already been remitted (idempotency pre-check)', async () => {
    prisma.journalEntry.findFirst.mockResolvedValue({ entryNumber: 'JE-OLD-001' });
    await expect(
      template.executeSso({ scope: 'SHOP', period: '2026-08', depositAccountCode: 'S11-1202' }),
    ).rejects.toThrow(/นำส่งไปแล้ว/);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects when the GL payable balance does not cover the remit amount', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({
      _sum: { credit: new Decimal('100.00'), debit: new Decimal('0.00') },
    });
    await expect(
      template.executeSso({ scope: 'SHOP', period: '2026-08', depositAccountCode: 'S11-1202' }),
    ).rejects.toThrow(/น้อยกว่ายอดนำส่ง/);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('rejects a deposit account from the wrong book (SHOP scope + FINANCE bank)', async () => {
    await expect(
      template.executeSso({ scope: 'SHOP', period: '2026-08', depositAccountCode: '11-1201' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.payrollLine.findMany).not.toHaveBeenCalled();
  });

  it('rejects when the period has no posted payroll (sum = 0)', async () => {
    prisma.payrollLine.findMany.mockResolvedValue([]);
    await expect(
      template.executePnd1({ scope: 'SHOP', period: '2026-09', depositAccountCode: 'S11-1202' }),
    ).rejects.toThrow(/ไม่มียอดภาษี/);
  });

  it('sums only POSTED docs of the requested period+scope (query shape)', async () => {
    await template.executeSso({ scope: 'SHOP', period: '2026-08', depositAccountCode: 'S11-1202' });
    const call = prisma.payrollLine.findMany.mock.calls[0][0];
    expect(call.where.payroll).toEqual(
      expect.objectContaining({
        payrollPeriod: '2026-08',
        entityScope: 'SHOP',
        document: expect.objectContaining({ status: 'POSTED', deletedAt: null }),
      }),
    );
  });
});
