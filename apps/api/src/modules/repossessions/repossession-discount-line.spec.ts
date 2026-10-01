import { Prisma } from '@prisma/client';
import { RepossessionsService } from './repossessions.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';

/**
 * ตัวอย่างข้อ 5 ของฝ่ายบัญชี (เอกสารฉบับรวม 29/09/2569 — ตอบ 30/09/2569 "แบบ (ก) ลงส่วนลดแยกที่ 52-1106")
 * ผ่านเส้นทางของหน้าจอยึดคืนจริง: `RepossessionsService.previewCalculation` → `computePayoffQuote` (ตัวเลขบนจอ)
 * → `RepossessionJP5Template.previewJe` (buildJe ตัวเดียวกับที่ลงบัญชี). ไม่ต่อฐาน — ยอดในบัญชีจำลองผ่าน mock
 *
 * สัญญา 12 งวด งวดละ 1,515.83 (17,000/12 · VAT 1,190) จ่ายแล้ว 4 งวด (ตั้งลูกหนี้งวดและรับเงินครบ) · ราคาประเมิน
 * 7,000.00 · ส่วนลด 50% — ยอดในบัญชีของ 8 งวดที่เหลือ 11-2101 11,333.36 + 11-2105 793.32 = 12,126.68
 * (งวดสุดท้ายรับเศษของสัญญา) · 11-2106 4,000.00 · 21-2102 793.32
 */
describe('หน้าจอยึดคืน — ตัวอย่างข้อ 5 ของฝ่ายบัญชี: ส่วนลดบนจอ = บรรทัด 52-1106 ของ JP5 (แบบ ก)', () => {
  const dec = (v: string) => new Prisma.Decimal(v);

  function build() {
    const payments = Array.from({ length: 12 }, (_, i) => ({
      id: `pay-${i + 1}`,
      installmentNo: i + 1,
      status: i < 4 ? 'PAID' : 'PENDING',
      amountDue: dec('1515.83'),
      amountPaid: dec(i < 4 ? '1515.83' : '0'),
      lateFee: dec('0'),
      lateFeeWaived: false,
      dueDate: new Date(Date.UTC(2026, i, 1)),
    }));
    const contract = {
      id: 'contract-17k',
      contractNumber: 'CT-17K',
      status: 'TERMINATED',
      deletedAt: null,
      branchId: 'branch-1',
      totalMonths: 12,
      monthlyPayment: dec('1515.83'),
      sellingPrice: dec('12000'),
      downPayment: dec('2000'),
      financedAmount: dec('10000'),
      storeCommission: dec('1000'),
      interestTotal: dec('6000'),
      vatAmount: dec('1190'),
      vatPct: dec('0.07'),
      creditBalance: dec('0'),
      advanceBalance: dec('0'),
      rescheduleAdvanceBalance: dec('0'),
      productId: 'product-1',
      product: {
        id: 'product-1',
        name: 'iPhone 15',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        costPrice: dec('6000'),
        status: 'SOLD_INSTALLMENT',
      },
      customer: { id: 'cust-1', name: 'ลูกค้าทดสอบ', phone: '0800000000' },
      payments,
    };
    const installments = Array.from({ length: 12 }, (_, i) => ({
      id: `inst-${i + 1}`,
      installmentNo: i + 1,
      dueDate: new Date(Date.UTC(2026, i, 1)),
      accrualJournalEntryId: i < 4 ? `je-2a-${i + 1}` : null,
    }));
    const gl: Record<string, { debit: string; credit: string }> = {
      '11-2101': { debit: '11333.36', credit: '0' },
      '11-2105': { debit: '793.32', credit: '0' },
      '11-2106': { debit: '0', credit: '4000.00' },
      '21-2102': { debit: '0', credit: '793.32' },
    };
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      repossession: { findFirst: jest.fn().mockResolvedValue(null) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installments) },
      payment: {
        findMany: jest.fn().mockResolvedValue(payments.filter((p) => p.status === 'PAID')),
      },
      journalLine: {
        findMany: jest.fn(async (args: { where: { accountCode: string } }) => {
          const g = gl[args.where.accountCode];
          return g ? [{ debit: dec(g.debit), credit: dec(g.credit) }] : [];
        }),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const template = new RepossessionJP5Template({} as never, prisma as never);
    const service = new RepossessionsService(
      prisma as never,
      {} as never,
      template,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service };
  }

  it('บนจอ: ยอดค้าง 12,126.64 · ส่วนลด 1,999.99 · ยอดปิด 10,126.65 · ส่วนต่าง −3,126.65 — JP5: ตารางแบบ (ก) ทุกบรรทัด', async () => {
    const { service } = build();

    const preview = await service.previewCalculation('contract-17k', { appraisalPrice: 7000 });

    expect(preview.calculation).toMatchObject({
      remainingMonths: 8,
      outstandingBalance: 12126.64,
      discountPct: 50,
      discountAmount: 1999.99,
      closingAmount: 10126.65,
      marketValue: 7000,
      profitLoss: -3126.65,
    });
    expect(preview.journalPreview).not.toBeNull();
    const jp5 = preview.journalPreview!;
    expect(jp5.lines.map((l) => `${l.accountCode} ${l.debit} ${l.credit}`)).toEqual([
      '11-2107 7000.00 0.00',
      '11-2106 4000.00 0.00',
      '21-2102 793.32 0.00',
      '11-2101 0.00 11333.36',
      '11-2105 0.00 793.32',
      '21-2101 0.00 793.32',
      '41-1101 0.00 4000.00',
      '52-1106 1999.99 0.00',
      '51-1102 3126.69 0.00',
    ]);
    expect(jp5.totalDebit).toBe('16920.00');
    expect(jp5.totalCredit).toBe('16920.00');
    expect(jp5.isBalanced).toBe(true);
    // ขาดทุนในบัญชี 3,126.69 ต่างจากบนจอ 3,126.65 เท่าเศษของงวดสุดท้าย 0.04 (12,126.68 − 12,126.64) — ตามตาราง (ก)
    const ledgerLoss = dec(jp5.lines.find((l) => l.accountCode === '51-1102')!.debit);
    expect(ledgerLoss.minus(dec('3126.65')).toFixed(2)).toBe('0.04');
  });

  it('ส่วนลด 0% → ไม่มีบรรทัด 52-1106 และขาดทุนในบัญชี 5,126.68 (ยอดปิด = ยอดค้างบนจอ)', async () => {
    const { service } = build();

    const preview = await service.previewCalculation('contract-17k', {
      appraisalPrice: 7000,
      discountPct: 0,
    });

    expect(preview.calculation.discountAmount).toBe(0);
    const lines = preview.journalPreview!.lines;
    expect(lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    expect(lines.find((l) => l.accountCode === '51-1102')?.debit).toBe('5126.68');
  });
});
