import { Prisma } from '@prisma/client';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { RepossessionsService } from './repossessions.service';

/**
 * Payoff parity เมื่อมี "ถังพักงวดสุดท้าย" (`Contract.rescheduleAdvanceBalance`)
 * — ส่วนขยายของกฎเจ้าของ 2026-07-20 ("ยอดปิดยึดคืน = ยอดปิดก่อนกำหนดเสมอ")
 * ให้ครอบคลุมของใหม่จาก finding C-3: ทั้ง JP4 และ JP5 ต้อง
 *   1) ได้ยอดปิดเท่ากันเป๊ะ ๆ ทั้งที่มีและไม่มีถังพัก
 *   2) ปลดหนี้ 21-1103 ด้วย "ยอดที่ยอดปิดดูดซับจริง" ก้อนเดียวกัน
 *      (ห้ามฝั่งใดฝั่งหนึ่งปลดเต็มถังแล้วอีกฝั่งปลดบางส่วน)
 *
 * spec เดิม `payoff-parity.spec.ts` ยังยืนอยู่โดยไม่ถูกแก้ — ไฟล์นี้เพิ่มมิติถังพัก
 * ล้วน ๆ ไม่ทับเคสเดิม
 */
describe('Payoff parity (ถังพักงวดสุดท้าย): JP4 quote === JP5 preview + ยอดปลดหนี้ 21-1103 ก้อนเดียวกัน', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  function makeContract(park: string) {
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
      id: 'contract-parity-park-1',
      contractNumber: 'BC-202608-0001',
      status: 'DEFAULT',
      deletedAt: null,
      branchId: 'branch-1',
      totalMonths: 12,
      monthlyPayment: dec('3671'),
      creditBalance: dec('0'),
      rescheduleAdvanceBalance: dec(park),
      vatPct: dec('0.07'),
      sellingPrice: dec('22190'),
      downPayment: dec('3000'),
      storeCommission: dec('500'),
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

    // จับ input ที่ RepossessionsService ส่งเข้า JP5 — ยอด parkRelief ที่ส่งคือ
    // ยอดที่จะกลายเป็นขา Dr 21-1103 ใน JE จริง
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

  it.each([50, 0])(
    'ส่วนลด %i%% + ถังพัก 354: ยอดปิดเท่ากัน และ parkRelief ที่ JP5 ใช้ = rescheduleAdvanceApplied ของ JP4',
    async (discountPct) => {
      const contract = makeContract('354');
      const { ep, repo, previewJe } = makeServices(contract);

      const epQuote = await ep.getEarlyPayoffQuote(contract.id, discountPct);
      const repoPreview = await repo.previewCalculation(contract.id, { discountPct });

      expect(repoPreview.calculation.closingAmount).toBe(epQuote.totalPayoff);
      expect(repoPreview.calculation.outstandingBalance).toBe(epQuote.remainingBalance);
      expect(repoPreview.calculation.discountAmount).toBe(epQuote.discountAmount);

      // ยอดปลดหนี้ 21-1103 ต้องเป็นก้อนเดียวกันทั้งสองเส้นทาง
      expect(previewJe).toHaveBeenCalledTimes(1);
      const jp5Input = previewJe.mock.calls[0][0] as { parkRelief?: Prisma.Decimal };
      expect(jp5Input.parkRelief).toBeDefined();
      expect(jp5Input.parkRelief!.toFixed(2)).toBe(epQuote.rescheduleAdvanceApplied.toFixed(2));

      // และต้องตรงกับขา Dr 21-1103 ที่ JP4 preview แสดง
      const jp4ParkLine = epQuote.journalPreview.lines.find((l) => l.accountCode === '21-1103');
      expect(jp4ParkLine?.debit).toBe(epQuote.rescheduleAdvanceApplied.toFixed(2));
    },
  );

  it('ไม่มีถังพัก → ทั้งสองเส้นทางไม่ส่ง parkRelief และไม่มีขา 21-1103 (พฤติกรรมเดิมทุกประการ)', async () => {
    const contract = makeContract('0');
    const { ep, repo, previewJe } = makeServices(contract);

    const epQuote = await ep.getEarlyPayoffQuote(contract.id, 50);
    const repoPreview = await repo.previewCalculation(contract.id, { discountPct: 50 });

    expect(repoPreview.calculation.closingAmount).toBe(epQuote.totalPayoff);
    expect(epQuote.totalPayoff).toBe(33411.96); // golden เดิม 2026-07-20
    expect(epQuote.rescheduleAdvanceApplied).toBe(0);
    expect(epQuote.journalPreview.lines.find((l) => l.accountCode === '21-1103')).toBeUndefined();
    expect(
      (previewJe.mock.calls[0][0] as { parkRelief?: Prisma.Decimal }).parkRelief,
    ).toBeUndefined();
  });
});
