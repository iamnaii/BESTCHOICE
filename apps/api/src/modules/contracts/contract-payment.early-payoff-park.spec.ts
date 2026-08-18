import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';

/**
 * Review finding C-3 — ปิดสัญญาก่อนกำหนด (JP4) กับ "ถังพักงวดสุดท้าย"
 * (`Contract.rescheduleAdvanceBalance`, GL 21-1103).
 *
 * บั๊กที่ spec นี้ปักหมุด: `computePayoffQuote` หักถังพักออกจากยอดที่ลูกค้าต้องจ่าย
 * (advancePayment) แต่ JE ที่ post จริงคำนวณแยกกันโดยสิ้นเชิง — `Dr เงินสด =
 * settlement + lateFees` ไม่มีขา 21-1103 เลย และไม่มีใครตัดคอลัมน์ถังพัก. ผล:
 *   1) Dr เงินสด > เงินที่ลูกค้าจ่ายจริง เท่ายอดที่ถังพักดูดซับ
 *   2) เครดิตผี 21-1103 ค้างบนสัญญาที่ปิดไปแล้วตลอดกาล
 *
 * รูปแบบที่แก้: `Dr เงินสด = totalCash − parkRelief` + `Dr 21-1103 = parkRelief`
 * → ยอด Dr รวมเท่าเดิม ทุกขา Cr ไม่ขยับ JE ยัง balanced + ตัดคอลัมน์ใน tx เดียวกัน.
 *
 * ── Fixture (ตั้งใจให้ฐานเงินสดของ JE = ยอดปิดของ quote พอดี) ────────────────
 *   totalMonths 12 · monthlyPayment 1926 (รวม VAT) · 6 งวดจ่ายแล้ว / 6 งวดค้าง
 *   financedAmount 18000 · storeCommission 1800 · interestTotal 1800 · vat 1512
 *   sellingPrice 20000 · downPayment 2000 · creditBalance 0 · ค่าปรับ 0 · ส่วนลด 50%
 *
 *   ไม่มีถังพัก:  JE settlement = 10800 − 450 + 756 = 11106.00
 *                 quote.totalPayoff = 11556 − 450       = 11106.00   ← ตรงกันพอดี
 *   ถังพัก 354:   quote → remainingBalance 11202 → exVat 10469.16 → กำไร 569.16
 *                 → ส่วนลด 284.58 → totalPayoff 10917.42
 *                 ยอดที่ดูดซับจริง = 11106.00 − 10917.42 = 188.58
 *                 (ไม่ใช่ 354 เต็ม เพราะถังพักลดฐานกำไร ส่วนลดจึงลดตาม —
 *                  ส่วนที่เหลือ 165.42 ต้องค้างในถัง ห้ามปลดหนี้เกิน)
 */
describe('ContractPaymentService.earlyPayoff — ถังพักงวดสุดท้าย (Dr 21-1103, finding C-3)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const makeQuoteContract = (park: string) => ({
    id: 'contract-ep-park-1',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-park-1',
    totalMonths: 12,
    monthlyPayment: dec('1926.00'),
    creditBalance: dec('0'),
    rescheduleAdvanceBalance: dec(park),
    vatPct: dec('0.07'),
    sellingPrice: dec('20000'),
    downPayment: dec('2000'),
    storeCommission: dec('1800'),
    financedAmount: dec('18000'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        status: 'PAID',
        amountPaid: dec('1926.00'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 7,
        status: 'PENDING',
        amountPaid: dec('0'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    ],
  });

  type CapturedLine = { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal };
  type CapturedJe = { metadata: Record<string, unknown>; lines: CapturedLine[] };

  type Harness = {
    service: ContractPaymentService;
    createAndPost: jest.Mock;
    contractUpdates: Array<Record<string, unknown>>;
    auditRows: Array<Record<string, unknown>>;
  };

  const build = (park: string): Harness => {
    const contract = makeQuoteContract(park);
    const contractUpdates: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];

    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-ep-park', entryNumber: 'JE-EP-PARK-0001' });

    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          contractNumber: 'CT-EP-PARK-001',
          branchId: 'branch-1',
        }),
        // ฉบับสดใน tx — ต้องมีคอลัมน์ถังพัก (clamp ชั้นที่สองอ่านจากตัวนี้)
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: contract.id,
          totalMonths: 12,
          financedAmount: dec('18000'),
          storeCommission: dec('1800'),
          interestTotal: dec('1800'),
          vatAmount: dec('1512.00'),
          rescheduleAdvanceBalance: dec(park),
        }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          contractUpdates.push(data);
          return Promise.resolve({ productId: contract.productId });
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 6 }, (_, i) => ({
            id: `pay-${i + 7}`,
            installmentNo: i + 7,
            status: 'PENDING',
            amountDue: dec('1926.00'),
            amountPaid: dec('0'),
            monthlyPrincipal: dec('1500'),
            monthlyInterest: dec('150'),
            monthlyCommission: dec('150'),
            vatAmount: dec('126'),
            lateFee: dec('0'),
            lateFeeWaived: false,
            evidenceUrl: null,
            gatewayRef: null,
          })),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return Promise.resolve(data);
        }),
      },
      // R-3 (re-review 2026-08-18): JP4 now clamps `parkRelief` by the LIVE GL
      // balance of 21-1103 for this contract — the same policy JP5 already used —
      // so the ledger has to BACK the column here or the relief clamps to zero.
      // That is exactly right: the 6a/6b fee JE credited 21-1103 by the parked
      // amount, so a contract whose column says `park` has a matching Cr balance.
      // Scoped by accountCode so other journalLine reads on this path stay empty.
      journalLine: {
        findMany: jest
          .fn()
          .mockImplementation((args: { where?: { accountCode?: string } }) =>
            Promise.resolve(
              args?.where?.accountCode === '21-1103'
                ? [{ debit: dec('0'), credit: dec(park) }]
                : [],
            ),
          ),
      },
      badDebtProvision: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }))),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      companyInfo: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: { companyCode: string } }) =>
            Promise.resolve({ id: `co-${args.where.companyCode}` }),
          ),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };

    const service = new ContractPaymentService(
      prisma as never,
      { transferOwnership: jest.fn().mockResolvedValue(undefined) } as never,
      { createAndPost } as never,
      {} as never,
      {} as never,
      { generateReceipt: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-ECL-1' }) } as never,
    );

    return { service, createAndPost, contractUpdates, auditRows };
  };

  const baseDto: EarlyPayoffDto = { paymentMethod: 'CASH' };
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);
  const totals = (je: CapturedJe) => ({
    dr: je.lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0)).toFixed(2),
    cr: je.lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0)).toFixed(2),
  });

  it('ถังพัก 354 → Dr เงินสด = ยอดที่ลูกค้าจ่ายจริง (10,917.42) + Dr 21-1103 = 188.58 · JE ยัง balanced', async () => {
    const h = build('354');
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-park-1');
    expect(quote.totalPayoff).toBe(10917.42);
    expect(quote.rescheduleAdvanceApplied).toBe(188.58);

    await h.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;

    // C-3 หัวใจ: ขาเงินสดต้องเท่าเงินที่ลูกค้าหยิบมาจ่ายจริง (fixture นี้ตั้งให้
    // ฐานเงินสดของ JE = ยอดปิดของ quote พอดี จึงเทียบตรง ๆ ได้)
    expect(lineFor(je, '11-1201')!.dr.toFixed(2)).toBe('10917.42');
    expect(lineFor(je, '11-1201')!.dr.toFixed(2)).toBe(quote.totalPayoff.toFixed(2));

    // ขาปลดหนี้ถังพัก
    expect(lineFor(je, '21-1103')!.dr.toFixed(2)).toBe('188.58');
    expect(lineFor(je, '21-1103')!.cr.toFixed(2)).toBe('0.00');
    expect(je.metadata.parkRelief).toBe('188.58');

    // ยอด Dr รวมเท่าเดิม (10917.42 + 188.58 = 11106.00) → balanced เหมือนเดิม
    expect(totals(je).dr).toBe(totals(je).cr);
    expect(totals(je).dr).toBe('13212.00');
  });

  it('ทุกขา Cr เหมือนเคสไม่มีถังพักทุกบาท — ขาที่ขยับมีแค่เงินสด (ลด) + 21-1103 (เพิ่ม)', async () => {
    const withPark = build('354');
    await withPark.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const jeWith = withPark.createAndPost.mock.calls[0][0] as CapturedJe;

    const noPark = build('0');
    await noPark.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const jeWithout = noPark.createAndPost.mock.calls[0][0] as CapturedJe;

    const crSig = (je: CapturedJe) =>
      je.lines.filter((l) => l.cr.gt(0)).map((l) => `${l.accountCode}:${l.cr.toFixed(2)}`);
    expect(crSig(jeWith)).toEqual(crSig(jeWithout));

    // ขาเงินสดลดลงเท่ากับยอดปลดหนี้เป๊ะ ๆ (invariant เชิงส่วนเพิ่มของ C-3)
    const cashWith = lineFor(jeWith, '11-1201')!.dr;
    const cashWithout = lineFor(jeWithout, '11-1201')!.dr;
    expect(cashWithout.minus(cashWith).toFixed(2)).toBe('188.58');
    expect(lineFor(jeWithout, '21-1103')).toBeUndefined();
  });

  it('ตัดคอลัมน์ถังพักด้วยยอดที่ปลดหนี้จริง ใน $transaction เดียวกับ JE + เขียน AuditLog', async () => {
    const h = build('354');
    await h.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);

    const parkUpdate = h.contractUpdates.find((d) => 'rescheduleAdvanceBalance' in d);
    expect(parkUpdate).toBeDefined();
    expect(
      (parkUpdate!.rescheduleAdvanceBalance as { decrement: Prisma.Decimal }).decrement.toFixed(2),
    ).toBe('188.58');

    // ส่วนที่ยอดปิดดูดซับไม่หมด (354 − 188.58 = 165.42) ต้องค้างในถังตามเดิม
    const audit = h.auditRows.find((r) => r.action === 'RESCHEDULE_ADVANCE_CONSUMED');
    expect(audit).toBeDefined();
    expect(audit!.entity).toBe('contract');
    expect(audit!.entityId).toBe('contract-ep-park-1');
    const newValue = audit!.newValue as Record<string, string>;
    expect(newValue.parkRelief).toBe('188.58');
    expect(newValue.beforeParkBalance).toBe('354.00');
    expect(newValue.afterParkBalance).toBe('165.42');
    expect(newValue.source).toBe('EARLY_PAYOFF_PARK_RELIEF');

    // สัญญายังถูกปิดตามปกติ (ขา update เดิมไม่หาย)
    expect(h.contractUpdates.some((d) => d.status === 'EARLY_PAYOFF')).toBe(true);
  });

  it('ไม่มีถังพัก → ไม่มีบรรทัด 21-1103, ไม่แตะคอลัมน์, ไม่มี audit row (JE เดิมไม่ขยับ)', async () => {
    const h = build('0');
    await h.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;

    expect(lineFor(je, '21-1103')).toBeUndefined();
    expect(je.metadata.parkRelief).toBeUndefined();
    expect(lineFor(je, '11-1201')!.dr.toFixed(2)).toBe('11106.00'); // golden เดิม
    expect(h.contractUpdates.some((d) => 'rescheduleAdvanceBalance' in d)).toBe(false);
    expect(h.auditRows.some((r) => r.action === 'RESCHEDULE_ADVANCE_CONSUMED')).toBe(false);
  });

  it('preview (getEarlyPayoffQuote) แสดงขา 21-1103 ตรงกับที่ post จริง — preview === posted', async () => {
    const h = build('354');
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-park-1');

    const previewPark = quote.journalPreview.lines.find((l) => l.accountCode === '21-1103');
    expect(previewPark?.debit).toBe('188.58');
    const previewCash = quote.journalPreview.lines.find((l) => l.accountCode === '11-1201');
    expect(previewCash?.debit).toBe('10917.42');
    expect(quote.journalPreview.isBalanced).toBe(true);

    await h.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;
    for (const l of quote.journalPreview.lines) {
      const posted = lineFor(je, l.accountCode)!;
      expect(`${l.accountCode}:${posted.dr.toFixed(2)}/${posted.cr.toFixed(2)}`).toBe(
        `${l.accountCode}:${l.debit}/${l.credit}`,
      );
    }
  });

  it('ถังพักใหญ่กว่าที่ยอดปิดดูดซับได้ → ปลดหนี้เท่าที่ดูดซับ, Dr เงินสดไม่ติดลบ, ที่เหลือค้างในถัง', async () => {
    // ถัง 50,000 บนสัญญาที่ค้างแค่ 11,556 → quote ชน max(0,…) ที่ 0
    const h = build('50000');
    const quote = await h.service.getEarlyPayoffQuote('contract-ep-park-1');
    expect(quote.totalPayoff).toBe(0);
    // ดูดซับได้แค่ยอดปิดเดิม (11,106.00 = 11,556 − ส่วนลด 450) ไม่ใช่ 50,000
    expect(quote.rescheduleAdvanceApplied).toBe(11106);

    await h.service.earlyPayoff('contract-ep-park-1', 'user-1', baseDto);
    const je = h.createAndPost.mock.calls[0][0] as CapturedJe;

    // totalCash ของ JE = 11106.00 → clamp ทำให้ปลดได้แค่ 11106.00, เงินสด = 0.00
    expect(lineFor(je, '11-1201')!.dr.toFixed(2)).toBe('0.00');
    expect(lineFor(je, '21-1103')!.dr.toFixed(2)).toBe('11106.00');
    expect(totals(je).dr).toBe(totals(je).cr);

    const parkUpdate = h.contractUpdates.find((d) => 'rescheduleAdvanceBalance' in d);
    expect(
      (parkUpdate!.rescheduleAdvanceBalance as { decrement: Prisma.Decimal }).decrement.toFixed(2),
    ).toBe('11106.00');
    const audit = h.auditRows.find((r) => r.action === 'RESCHEDULE_ADVANCE_CONSUMED');
    expect((audit!.newValue as Record<string, string>).afterParkBalance).toBe('38894.00');
  });
});
