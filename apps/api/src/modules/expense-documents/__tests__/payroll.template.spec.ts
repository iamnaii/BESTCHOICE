import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';

describe('PayrollTemplate', () => {
  let template: PayrollTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let roles: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let companyResolver: any;

  const docId = 'pr-1';

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-PR-001', id: 'je-pr-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-PR-001' }),
      },
    };
    // AccountRoleService mock — same defaults the seed migrations ship
    // (20260919000000 FINANCE set + 20260990000000 shop_* set).
    const roleMap: Record<string, string> = {
      payroll_expense: '53-1101',
      payroll_sso_expense: '53-1102',
      wht_payroll: '21-3101',
      sso_employee: '21-3105',
      sso_employer: '21-3106',
      shop_payroll_expense: 'S52-1201',
      shop_payroll_sso_expense: 'S52-1205',
      shop_wht_payroll: 'S21-3101',
      shop_sso_employee: 'S21-3105',
      shop_sso_employer: 'S21-3106',
    };
    roles = { code: jest.fn((r: string) => roleMap[r] ?? `__missing_${r}`) };
    companyResolver = {
      getShopCompanyId: jest.fn().mockResolvedValue('shop-co-1'),
      getFinanceCompanyId: jest.fn().mockResolvedValue('fin-co-1'),
    };
    template = new PayrollTemplate(journal, prisma, roles, companyResolver);
  });

  const sumDrCr = (lines: Array<{ dr: Decimal; cr: Decimal }>) => ({
    dr: lines.reduce((s, l) => s.plus(l.dr), new Decimal(0)),
    cr: lines.reduce((s, l) => s.plus(l.cr), new Decimal(0)),
  });

  it('SHOP scope (default — คำสั่งเจ้าของ 2026-08-06): Dr S52-1201 + Dr S52-1205 / Cr S21-3101 + S21-3105 + S21-3106 + Cr S11-1202, companyId=SHOP', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-2608-001',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-08-05'),
      totalAmount: new Decimal('25000.00'),
      depositAccountCode: 'S11-1202',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-08',
        entityScope: 'SHOP',
        lines: [
          { id: '1', baseSalary: new Decimal('10000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('9250.00') },
          { id: '2', baseSalary: new Decimal('15000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('300.00'), netPaid: new Decimal('13950.00') },
        ],
      },
    });

    const result = await template.execute(docId);

    expect(result.entryNo).toBe('JE-PR-001');
    const [args] = journal.createAndPost.mock.calls[0];

    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S52-1201').dr).toEqual(new Decimal('25000'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S52-1205').dr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S21-3101').cr).toEqual(new Decimal('300'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S21-3105').cr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S21-3106').cr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S11-1202').cr).toEqual(new Decimal('23200'));

    // ห้ามมีรหัสผัง FINANCE ปนใน SHOP-scope JE (B2 anti-regression)
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes.every((c: string) => c.startsWith('S'))).toBe(true);

    // companyId = SHOP → รายงาน scope=SHOP เห็น JE นี้ (code S + companyId ตรงกัน)
    expect(args.companyId).toBe('shop-co-1');
    expect(companyResolver.getFinanceCompanyId).not.toHaveBeenCalled();

    // DB-level idempotency + scope stamped in metadata
    expect(args.metadata.idempotencyKey).toBe(`expense-payroll:${docId}`);
    expect(args.metadata.flow).toBe('expense-payroll');
    expect(args.metadata.entityScope).toBe('SHOP');

    const { dr, cr } = sumDrCr(args.lines);
    expect(dr.toString()).toBe('26500');
    expect(cr.toString()).toBe('26500');
  });

  it('FINANCE scope: legacy codes 53-1101/53-1102/21-31XX but companyId=FINANCE (B2 fix — เดิม post SHOP companyId)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0001',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('25000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-05',
        entityScope: 'FINANCE',
        lines: [
          { id: '1', baseSalary: new Decimal('10000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('9250.00') },
          { id: '2', baseSalary: new Decimal('15000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('300.00'), netPaid: new Decimal('13950.00') },
        ],
      },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];

    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '53-1101').dr).toEqual(new Decimal('25000'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '53-1102').dr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3101').cr).toEqual(new Decimal('300'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3105').cr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3106').cr).toEqual(new Decimal('1500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1101').cr).toEqual(new Decimal('23200'));
    // Old placeholder must NOT appear (Fix Report P0-3 anti-regression)
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-1104')).toBeUndefined();

    expect(args.companyId).toBe('fin-co-1');
    expect(companyResolver.getShopCompanyId).not.toHaveBeenCalled();

    const { dr, cr } = sumDrCr(args.lines);
    expect(dr.toString()).toBe('26500');
    expect(cr.toString()).toBe('26500');
  });

  it('custom income (OT S52-1202) Dr + custom deduction Cr land in the JE and it balances (C2.5 — เทสต์ที่เคยขาดจนบั๊ก B1 ซ่อนอยู่ได้)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-2608-002',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-08-05'),
      totalAmount: new Decimal('12000.00'),
      depositAccountCode: 'S11-1202',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-08',
        entityScope: 'SHOP',
        lines: [
          {
            id: '1',
            baseSalary: new Decimal('12000.00'),
            ssoEmployee: new Decimal('600.00'),
            whtAmount: new Decimal('0.00'),
            // 12000 + 1000 (OT) − 600 (SSO) − 500 (หักคืนเงินยืม) = 11900
            netPaid: new Decimal('11900.00'),
            customIncome: [
              { accountCode: 'S52-1202', name: 'OT', amount: new Decimal('1000.00'), isTaxable: true },
            ],
            customDeduction: [
              { accountCode: 'S11-3001', name: 'คืนเงินยืม', amount: new Decimal('500.00') },
            ],
          },
        ],
      },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];

    const drOt = args.lines.find((l: { accountCode: string }) => l.accountCode === 'S52-1202');
    expect(drOt.dr).toEqual(new Decimal('1000'));
    const crDeduction = args.lines.find((l: { accountCode: string }) => l.accountCode === 'S11-3001');
    expect(crDeduction.cr).toEqual(new Decimal('500'));
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === 'S11-1202').cr).toEqual(new Decimal('11900'));

    // Dr 12000 + 600 + 1000 = Cr 600 + 600 + 500 + 11900 = 13600
    const { dr, cr } = sumDrCr(args.lines);
    expect(dr.toString()).toBe('13600');
    expect(cr.toString()).toBe('13600');
  });

  // คำตัดสินเจ้าของ 2026-10-29 — หัก ณ ที่จ่ายค่าคอม 3% (COMMISSION_WHT) Cr บัญชี ภ.ง.ด.1 ตาม role ตอนลงบัญชี (เหมือนภาษีเงินเดือน —
  // ไม่ใช่รหัสที่เก็บตอนบันทึก) บรรทัดของตัวเอง แยกจากภาษีเงินเดือนและจากรายการหักมือบนบัญชีเดียวกัน
  it('COMMISSION_WHT credits the wht role code at post on its own line (separate from salary WHT and a MANUAL S21-3101 row) and the JE balances', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-2611-003',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-12-01'),
      totalAmount: new Decimal('16000.00'),
      depositAccountCode: 'S11-1202',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-11',
        entityScope: 'SHOP',
        lines: [
          {
            id: '1',
            baseSalary: new Decimal('15000.00'),
            ssoEmployee: new Decimal('750.00'),
            whtAmount: new Decimal('100.00'),
            // 15,000 + 1,000 − 750 − 100 − 300 − 21 − 50 = 14,779
            netPaid: new Decimal('14779.00'),
            customIncome: [{ accountCode: 'S51-1101', name: 'ค่าคอม', amount: new Decimal('1000.00'), isTaxable: true, source: 'COMMISSION' }],
            customDeduction: [
              { accountCode: 'S51-1101', name: 'หักคืนค่าคอม (1 รายการ)', amount: new Decimal('300.00'), source: 'COMMISSION_CLAWBACK' },
              // รหัสที่เก็บตอนบันทึก (role ถูกย้ายทีหลัง) — JE ต้องใช้รหัส role ปัจจุบัน S21-3101
              { accountCode: 'S21-9999', name: 'หัก ณ ที่จ่ายค่าคอม 3%', amount: new Decimal('21.00'), source: 'COMMISSION_WHT' },
              { accountCode: 'S21-3101', name: 'หักภาษีงวดก่อน (กรอกเอง)', amount: new Decimal('50.00'), source: 'MANUAL' },
            ],
          },
        ],
      },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const onWht = args.lines.filter((l: { accountCode: string }) => l.accountCode === 'S21-3101');
    expect(onWht.map((l: { cr: Decimal; description: string }) => [l.cr.toString(), l.description])).toEqual([
      ['100', 'หัก ณ ที่จ่าย ภงด.1'],
      ['21', 'หัก ณ ที่จ่ายค่าคอม 3% งวด 2026-11'],
      ['50', 'รายการหัก S21-3101 งวด 2026-11'],
    ]);
    expect(args.lines.some((l: { accountCode: string }) => l.accountCode === 'S21-9999')).toBe(false);
    const { dr, cr } = sumDrCr(args.lines);
    expect(dr.toString()).toBe(cr.toString());
  });

  it('rejects a SHOP-scope doc whose deposit account is a FINANCE code (scope-mismatch defense in depth)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-2608-003',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-08-05'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-08',
        entityScope: 'SHOP',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await expect(template.execute(docId)).rejects.toThrow(BadRequestException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('idempotent: returns existing entryNo when journalEntryId set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      journalEntryId: 'je-existing-uuid',
      payroll: { payrollPeriod: '2569-05', entityScope: 'FINANCE', lines: [] },
    });
    prisma.journalEntry.findUnique.mockResolvedValueOnce({ entryNumber: 'JE-EXISTING' });

    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('updates document status=POSTED + paidAt + journalEntryId after post', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0002',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-05',
        entityScope: 'FINANCE',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await template.execute(docId);

    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          journalEntryId: 'je-pr-1',
        }),
      }),
    );
  });

  it('skips Cr lines when their sum is 0 (single employee with sso=0, wht=0)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0003',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-05',
        entityScope: 'FINANCE',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).not.toContain('21-3101');
    expect(codes).not.toContain('21-3105');
    expect(codes).not.toContain('21-3106');
    expect(codes).not.toContain('53-1102');
    expect(codes).not.toContain('21-1104');
    expect(codes).toContain('53-1101');
    expect(codes).toContain('11-1101');
  });

  it('requires depositAccountCode (throws BadRequestException when missing)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0004',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: null,
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-05',
        entityScope: 'FINANCE',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await expect(template.execute(docId)).rejects.toThrow(BadRequestException);
  });

  it('JE is identical whether payroll lines carry a userId or not (PR-C anti-regression)', async () => {
    const baseLine = {
      baseSalary: new Decimal('15000.00'),
      ssoEmployee: new Decimal('750.00'),
      whtAmount: new Decimal('0.00'),
      netPaid: new Decimal('14250.00'),
      customIncome: [],
      customDeduction: [],
    };
    const docOf = (userId: string | null) => ({
      id: docId,
      number: 'PR-20260601-0001',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-06-01'),
      totalAmount: new Decimal('15000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2026-06',
        entityScope: 'FINANCE',
        lines: [{ ...baseLine, userId, employeeName: 'สมชาย', employeeTaxId: '1234567890123' }],
      },
    });

    // Run WITHOUT userId
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue(docOf(null));
    await template.execute(docId);
    const legacyLines = journal.createAndPost.mock.calls[0][0].lines;

    // Reset + run WITH userId
    journal.createAndPost.mockClear();
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue(docOf('user-emp-1'));
    await template.execute(docId);
    const linkedLines = journal.createAndPost.mock.calls[0][0].lines;

    expect(JSON.stringify(linkedLines)).toEqual(JSON.stringify(legacyLines));
  });
});
