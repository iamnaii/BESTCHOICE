import { Decimal } from '@prisma/client/runtime/library';
import { remainingInstallmentVat } from './early-payoff-receipt-vat';

/**
 * ภาษีคงเหลือของงวดที่ใบปิดยอดก่อนกำหนดปิด — กติกา PR3 ต่องวด (ใบที่ทำให้ครบรับส่วนที่เหลือ · งวดสุดท้ายรับเศษ):
 * rest = remainingAccrualPortion(basis, documentedSoFar(basis, priorClearings ของรายการก่อนหน้าของงวด))
 */
const D = (v: string | number) => new Decimal(v);

/** สัญญามาตรฐาน 17,000/12: ค่างวด 1,416.66 + ภาษี 99.17 = 1,515.83 · งวด 12 = 1,416.74 + 99.13 */
const CONTRACT = {
  id: 'c1',
  financedAmount: D('10000'),
  storeCommission: D('1000'),
  interestTotal: D('6000'),
  vatAmount: D('1190'),
  totalMonths: 12,
};

type Entry = { metadata: Record<string, unknown>; lines: Array<{ accountCode: string; debit: Decimal; credit: Decimal }> };

function client(opts: { schedules?: Array<{ id: string; installmentNo: number }>; entries?: Entry[] } = {}) {
  const schedules =
    opts.schedules ?? Array.from({ length: 12 }, (_, i) => ({ id: `is-${i + 1}`, installmentNo: i + 1 }));
  return {
    installmentSchedule: {
      findMany: jest.fn(async (args: { where: { installmentNo?: { in: number[] } } }) =>
        schedules.filter((s) => !args.where.installmentNo || args.where.installmentNo.in.includes(s.installmentNo)),
      ),
    },
    journalEntry: {
      // reconstructPriorCleared: where.AND[1].metadata.equals = installmentScheduleId
      findMany: jest.fn(async (args: { where: { AND: Array<{ metadata?: { equals?: string } }> } }) =>
        (opts.entries ?? []).filter((e) => e.metadata.installmentScheduleId === args.where.AND[1].metadata?.equals),
      ),
    },
  };
}

describe('remainingInstallmentVat — ภาษี/ยอดคงเหลือของงวดที่ใบปิดยอดปิด', () => {
  it('12 งวดไม่มีรายการก่อน → ภาษี 1,190.00 · ยอด 18,190.00 · งวด 12 รับเศษ (99.13 / 1,515.87)', async () => {
    const r = await remainingInstallmentVat(client() as any, CONTRACT, Array.from({ length: 12 }, (_, i) => i + 1));
    expect(r.vat.toFixed(2)).toBe('1190.00');
    expect(r.total.toFixed(2)).toBe('18190.00');
    expect(r.perInstallment.at(-1)).toMatchObject({ installmentNo: 12 });
    expect(r.perInstallment.at(-1)!.vat.toFixed(2)).toBe('99.13');
    expect(r.perInstallment.at(-1)!.total.toFixed(2)).toBe('1515.87');
  });

  it('งวด 5–12 (จ่ายแล้ว 4) → ภาษี 793.32 · ยอด 12,126.68', async () => {
    const r = await remainingInstallmentVat(client() as any, CONTRACT, [5, 6, 7, 8, 9, 10, 11, 12]);
    expect([r.vat.toFixed(2), r.total.toFixed(2)]).toEqual(['793.32', '12126.68']);
  });

  it('งวด 7 มีใบรับบางส่วน 500 ก่อนปิดยอด → ภาษีของงวด = 99.17 − 32.71 (ที่ใบบางส่วนแสดงแล้ว) = 66.46 · ยอด 1,015.83', async () => {
    const c = client({
      entries: [
        {
          metadata: { tag: 'receipt', installmentScheduleId: 'is-7' },
          lines: [{ accountCode: '11-2103', debit: D(0), credit: D('500') }],
        },
      ],
    });
    const r = await remainingInstallmentVat(c as any, CONTRACT, [7]);
    expect([r.vat.toFixed(2), r.total.toFixed(2)]).toEqual(['66.46', '1015.83']);
  });

  it('ไม่มีแถวตารางงวด (ข้อมูล legacy) → ไม่อ่านรายการก่อน · ภาษีเต็มงวด', async () => {
    const c = client({ schedules: [] });
    const r = await remainingInstallmentVat(c as any, CONTRACT, [3]);
    expect(r.vat.toFixed(2)).toBe('99.17');
    expect(c.journalEntry.findMany).not.toHaveBeenCalled();
  });

  it('ไม่มีงวด → ศูนย์', async () => {
    const r = await remainingInstallmentVat(client() as any, CONTRACT, []);
    expect([r.vat.toFixed(2), r.total.toFixed(2), r.perInstallment.length]).toEqual(['0.00', '0.00', 0]);
  });
});
