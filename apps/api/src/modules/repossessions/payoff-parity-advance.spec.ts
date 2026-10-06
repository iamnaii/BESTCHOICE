import { Prisma } from '@prisma/client';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { RepossessionsService } from './repossessions.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { ledgerLines } from '../journal/__tests__/ledger-lines-mock';

/**
 * Payoff parity เมื่อมี "เงินรับล่วงหน้าถังรวม" (`Contract.advanceBalance`) — PR5ข (เจ้าของเคาะ 01/10/2569 หักแบบเดียวกับ
 * เงินพักค่าปรับดิว) ต่อจากกฎเจ้าของ 2026-07-20 ("ยอดปิดยึดคืน = ยอดปิดก่อนกำหนดเสมอ"):
 *   1) หน้าปิดยอด (JP4) และหน้ายึดคืน (JP5) ได้ยอดปิด / ยอดค้าง / ส่วนลด / ถังรวมที่หักเท่ากัน
 *   2) ส่วนลดที่ JP5 ลง 52-1106 = ส่วนลดของใบเสนอปิดยอด (ถังรวมหักก่อนคิดส่วนลด)
 *   3) บรรทัดเงินพักของ JP5 (`parkRelief`) เป็นเงินพักอย่างเดียว — ถังรวมไม่ปนเข้ามา (JP5 ล้าง 21-1103 ทั้งยอดในบัญชีอยู่แล้ว)
 *
 * สัญญาตัวอย่างของฝ่ายบัญชี 17,000/12 งวดละ 1,515.83 ยังไม่จ่ายเลย (ตัวอย่างที่เจ้าของเคาะ: เครดิต 300 + ถังรวม 500)
 */
describe('Payoff parity (เงินรับล่วงหน้าถังรวม — PR5ข): JP4 quote === JP5 preview', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  function makeContract(cols: { credit: string; advance: string; park: string }) {
    return {
      id: 'contract-parity-advance-1',
      contractNumber: 'BC-202610-0001',
      status: 'DEFAULT',
      deletedAt: null,
      branchId: 'branch-1',
      totalMonths: 12,
      monthlyPayment: dec('1515.83'),
      creditBalance: dec(cols.credit),
      advanceBalance: dec(cols.advance),
      rescheduleAdvanceBalance: dec(cols.park),
      vatPct: dec('0.07'),
      sellingPrice: dec('12000'),
      downPayment: dec('2000'),
      storeCommission: dec('1000'),
      financedAmount: dec('17000'),
      interestTotal: dec('6000'),
      vatAmount: dec('1190'),
      productId: 'product-1',
      product: {
        id: 'product-1',
        name: 'iPhone 15',
        brand: 'Apple',
        model: 'iPhone 15',
        costPrice: dec('10000'),
        status: 'INSTALLMENT',
      },
      customer: { id: 'cust-1', name: 'ลูกค้าทดสอบ', phone: '0812345678' },
      payments: Array.from({ length: 12 }, (_, i) => ({
        installmentNo: i + 1,
        status: i === 0 ? 'OVERDUE' : 'PENDING',
        amountDue: dec('1515.83'),
        amountPaid: dec('0'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    };
  }

  function makeServices(contract: ReturnType<typeof makeContract>) {
    const prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      repossession: { findFirst: jest.fn().mockResolvedValue(null) },
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }))),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      // preview ของ JP4 อ่านยอดในบัญชี — เงินของลูกค้ามีในบัญชีเท่าคอลัมน์
      journalLine: {
        findMany: jest.fn(
          ledgerLines({
            '11-2101': '17000.00',
            '11-2105': '1190.00',
            '11-2106': '6000.00',
            '21-2102': '1190.00',
            '21-1103': contract.advanceBalance.plus(contract.rescheduleAdvanceBalance).toFixed(2),
            '21-5101': contract.creditBalance.toFixed(2),
          }),
        ),
      },
    };
    const previewJe = jest.fn().mockResolvedValue({
      lines: [],
      totalDebit: '0.00',
      totalCredit: '0.00',
      isBalanced: true,
    });
    const ep = new ContractPaymentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const repo = new RepossessionsService(
      prisma as never,
      {} as never,
      { previewJe } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { ep, repo, previewJe };
  }

  it.each([
    [50, 14612.63, 2777.33],
    [0, 17389.96, 0],
  ])(
    'ส่วนลด %i%% + เครดิต 300 + ถังรวม 500: ยอดปิด %d เท่ากันทั้งสองหน้า · ถังรวมที่หัก 500 · ส่วนลดที่ JP5 ลง = ส่วนลดของใบเสนอ · ไม่มีบรรทัดเงินพัก',
    async (discountPct, totalPayoff, discountAmount) => {
      const contract = makeContract({ credit: '300', advance: '500', park: '0' });
      const { ep, repo, previewJe } = makeServices(contract);

      const epQuote = await ep.getEarlyPayoffQuote(contract.id, discountPct);
      const repoPreview = await repo.previewCalculation(contract.id, { discountPct });

      expect(epQuote.totalPayoff).toBe(totalPayoff);
      expect(epQuote.discountAmount).toBe(discountAmount);
      expect(repoPreview.calculation.closingAmount).toBe(epQuote.totalPayoff);
      expect(repoPreview.calculation.outstandingBalance).toBe(epQuote.remainingBalance);
      expect(repoPreview.calculation.discountAmount).toBe(epQuote.discountAmount);
      expect(repoPreview.calculation.advancePayment).toBe(300);
      expect(repoPreview.calculation.advanceBalanceApplied).toBe(500);
      expect(epQuote.advanceBalanceApplied).toBe(500);

      const jp5Input = previewJe.mock.calls[0][0] as {
        parkRelief?: Prisma.Decimal;
        discount?: Prisma.Decimal;
      };
      expect(jp5Input.parkRelief).toBeUndefined();
      expect(jp5Input.discount?.toFixed(2)).toBe(
        discountAmount > 0 ? discountAmount.toFixed(2) : undefined,
      );
    },
  );

  it('เงินพัก 354 + ถังรวม 500 → บรรทัดเงินพักของ JP5 = 354 (ไม่รวมถังรวม) · JP4 preview มี 21-1103 สองบรรทัด 354.00 / 500.00 · ยอดปิดเท่ากัน 14,476.83', async () => {
    const contract = makeContract({ credit: '0', advance: '500', park: '354' });
    const { ep, repo, previewJe } = makeServices(contract);

    const epQuote = await ep.getEarlyPayoffQuote(contract.id, 50);
    const repoPreview = await repo.previewCalculation(contract.id, { discountPct: 50 });

    expect(epQuote.totalPayoff).toBe(14476.83);
    expect(repoPreview.calculation.closingAmount).toBe(epQuote.totalPayoff);
    expect(repoPreview.calculation.rescheduleAdvanceApplied).toBe(354);
    expect(repoPreview.calculation.advanceBalanceApplied).toBe(500);
    const jp5Input = previewJe.mock.calls[0][0] as { parkRelief?: Prisma.Decimal };
    expect(jp5Input.parkRelief!.toFixed(2)).toBe('354.00');
    expect(
      epQuote.journalPreview.lines.filter((l) => l.accountCode === '21-1103').map((l) => l.debit),
    ).toEqual(['354.00', '500.00']);
  });

  // JP5 ของจริง (buildJe ตัวเดียวกับที่ลงบัญชี) ผ่านหน้ายึดคืน — ราคาประเมิน 7,000 · ไม่มีงวดที่ตั้งลูกหนี้แล้ว · ไม่มีค่าเผื่อฯ
  it('หน้ายึดคืน (JP5 ของจริง) ราคาประเมิน 7,000: ยอดปิด 14,612.63 (เดิม 15,030.17) · 52-1106 2,777.33 (เดิม 2,859.79) · 51-1102 7,612.67 (เดิม 7,530.21) · ส่วนต่างบนจอ −7,612.63 ต่างจากบัญชีแค่เศษงวดสุดท้าย 0.04 (เดิมต่าง 499.96)', async () => {
    const contract = {
      ...makeContract({ credit: '300', advance: '500', park: '0' }),
      status: 'TERMINATED',
    };
    const prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      repossession: { findFirst: jest.fn().mockResolvedValue(null) },
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
      },
      installmentSchedule: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 12 }, (_, i) => ({
            id: `inst-${i + 1}`,
            installmentNo: i + 1,
            dueDate: new Date(Date.UTC(2026, 9 + i, 1)),
            accrualJournalEntryId: null,
          })),
        ),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: {
        findMany: jest.fn(
          ledgerLines({
            '11-2101': '17000.00',
            '11-2105': '1190.00',
            '11-2106': '6000.00',
            '21-2102': '1190.00',
            '21-1103': '500.00',
            '21-5101': '300.00',
          }),
        ),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repo = new RepossessionsService(
      prisma as never,
      {} as never,
      new RepossessionJP5Template({} as never, prisma as never),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const preview = await repo.previewCalculation(contract.id, { appraisalPrice: 7000 });

    expect(preview.calculation).toMatchObject({
      totalRemaining: 18189.96,
      advancePayment: 300,
      rescheduleAdvanceApplied: 0,
      advanceBalanceApplied: 500,
      outstandingBalance: 17389.96,
      discountAmount: 2777.33,
      closingAmount: 14612.63,
      profitLoss: -7612.63,
    });
    const jp5 = preview.journalPreview!;
    expect(jp5.lines.map((l) => `${l.accountCode} ${l.debit} ${l.credit}`)).toEqual([
      '11-2107 7000.00 0.00',
      '11-2106 6000.00 0.00',
      '21-2102 1190.00 0.00',
      '11-2101 0.00 17000.00',
      '11-2105 0.00 1190.00',
      '21-2101 0.00 1190.00',
      '41-1101 0.00 6000.00',
      '21-1103 500.00 0.00',
      '21-5101 300.00 0.00',
      '52-1106 2777.33 0.00',
      '51-1102 7612.67 0.00',
    ]);
    expect(jp5.isBalanced).toBe(true);
    expect(jp5.totalDebit).toBe('25380.00');
  });
});
