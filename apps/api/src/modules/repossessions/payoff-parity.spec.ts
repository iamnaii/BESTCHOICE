import { Prisma } from '@prisma/client';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { RepossessionsService } from './repossessions.service';

/**
 * Cross-service parity test (owner rule 2026-07-20):
 * ยอดปิดสัญญาตอนยึดคืน (RepossessionsService.previewCalculation) ต้องเท่ากับ
 * ยอดชำระปิดยอดก่อนกำหนด (ContractPaymentService.getEarlyPayoffQuote)
 * ของสัญญาเดียวกัน + ส่วนลดเดียวกัน เสมอ
 *
 * ทั้งคู่เรียก computePayoffQuote ร่วมกันอยู่แล้ว — test นี้ปักหมุด "input
 * assembly" ของแต่ละ service (การนับงวดคงเหลือ: EP นับจาก installmentSchedule
 * ที่ไม่มี Payment PAID ครอบ vs ยึดคืนนับจาก payments ที่ status !== PAID,
 * การส่ง creditBalance/partial/ค่าปรับ) ไม่ให้ drift จากกันในอนาคต
 * แม้จะมีคนแก้ฝั่งใดฝั่งหนึ่งโดยไม่รู้ว่าอีกฝั่งต้องตรงกัน
 */
describe('Payoff parity: repossession closingAmount === early-payoff totalPayoff', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  // สัญญา 12 งวด แนวเดียวกับเคสจริง 2026-07-20: งวดละ 3,671 (รวม VAT),
  // ต้นทุน (ยอดจัด + คอม) = 19,690 — แต่งเคสให้ยากขึ้น: มีงวด PARTIALLY_PAID
  // + ค่าปรับ 2 งวด (1 งวด waived) เพื่อ exercise ทุก seam ของ input assembly
  function makeContract(overrides: Partial<Record<string, unknown>> = {}) {
    const payments = Array.from({ length: 12 }, (_, i) => {
      const no = i + 1;
      if (no === 1) {
        return {
          installmentNo: no,
          status: 'OVERDUE',
          amountDue: dec('3671'),
          amountPaid: dec('0'),
          lateFee: dec('100'),
          lateFeeWaived: false,
        };
      }
      if (no === 2) {
        return {
          installmentNo: no,
          status: 'PARTIALLY_PAID',
          amountDue: dec('3671'),
          amountPaid: dec('1000'),
          lateFee: dec('50'),
          lateFeeWaived: true, // waived → ต้องไม่ติดไปในยอดปิดทั้งสอง flow
        };
      }
      return {
        installmentNo: no,
        status: 'PENDING',
        amountDue: dec('3671'),
        amountPaid: dec('0'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      };
    });

    return {
      id: 'contract-parity-1',
      contractNumber: 'BC-202607-0001',
      status: 'DEFAULT', // valid ทั้งสอง flow (EP: ACTIVE/OVERDUE/DEFAULT, ยึดคืน: TERMINATED/DEFAULT/OVERDUE)
      deletedAt: null,
      totalMonths: 12,
      monthlyPayment: dec('3671'),
      creditBalance: dec('500'),
      vatPct: dec('0.07'),
      sellingPrice: dec('22190'),
      downPayment: dec('3000'),
      storeCommission: dec('500'),
      // JE-preview inputs (EP เท่านั้น — ไม่กระทบยอดปิด แต่ต้องมีให้ .toString())
      financedAmount: dec('19190'),
      interestTotal: dec('2000'),
      vatAmount: dec('2882'),
      productId: 'product-1',
      product: {
        id: 'product-1',
        name: 'iPhone 15',
        brand: 'Apple',
        model: 'iPhone 15',
        costPrice: dec('18000'),
        status: 'INSTALLMENT',
      },
      customer: { id: 'cust-1', name: 'ลูกค้าทดสอบ', phone: '0812345678' },
      payments,
      ...overrides,
    };
  }

  function makeServices(contract: ReturnType<typeof makeContract>) {
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ installmentNo: i + 1 }))),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const ep = new ContractPaymentService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // collaborators ไม่ถูกเรียกโดย getEarlyPayoffQuote
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    const repo = new RepossessionsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );
    return { ep, repo };
  }

  it.each([50, 30, 0])(
    'discount %i%%: closingAmount ยึดคืน = totalPayoff ปิดยอดก่อนกำหนด',
    async (discountPct) => {
      const contract = makeContract();
      const { ep, repo } = makeServices(contract);

      const epQuote = await ep.getEarlyPayoffQuote(contract.id, discountPct);
      const repoPreview = await repo.previewCalculation(contract.id, { discountPct });

      expect(repoPreview.calculation.closingAmount).toBe(epQuote.totalPayoff);
      expect(repoPreview.calculation.discountAmount).toBe(epQuote.discountAmount);
      expect(repoPreview.calculation.unpaidLateFees).toBe(epQuote.unpaidLateFees);
      expect(repoPreview.calculation.outstandingBalance).toBe(epQuote.remainingBalance);
      expect(repoPreview.calculation.principalExVat).toBe(epQuote.remainingExVat);
      expect(repoPreview.calculation.remainingCost).toBe(epQuote.remainingCost);
      expect(repoPreview.calculation.remainingMonths).toBe(epQuote.remainingMonths);
    },
  );

  it('เคสจริง 2026-07-20 (ไม่มี advance): ทั้งสอง flow ได้ 33,411.96', async () => {
    // ตัดงวด PARTIALLY_PAID + creditBalance ออก → ตรง screenshot ที่ owner รายงาน
    const contract = makeContract({ creditBalance: dec('0') });
    contract.payments[1] = {
      installmentNo: 2,
      status: 'PENDING',
      amountDue: dec('3671'),
      amountPaid: dec('0'),
      lateFee: dec('0'),
      lateFeeWaived: false,
    };
    const { ep, repo } = makeServices(contract);

    const epQuote = await ep.getEarlyPayoffQuote(contract.id, 50);
    const repoPreview = await repo.previewCalculation(contract.id, { discountPct: 50 });

    expect(epQuote.totalPayoff).toBe(33411.96);
    expect(repoPreview.calculation.closingAmount).toBe(33411.96);
  });
});
