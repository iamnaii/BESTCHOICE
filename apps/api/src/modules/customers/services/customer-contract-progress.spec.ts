import { buildContractProgress, type ProgressContractRow, type ProgressPaymentRow } from './customer-contract-progress';

const NOW = new Date('2026-09-15T05:00:00.000Z');

const contract: ProgressContractRow = {
  id: 'k1',
  contractNumber: 'CT-2569-0042',
  status: 'OVERDUE',
  monthlyPayment: '4200.00',
  totalMonths: 12,
  createdAt: new Date('2026-03-05T03:00:00.000Z'),
  mdmLockedAt: null,
  shopWarrantyEndDate: null,
  branch: { name: 'สำนักงานใหญ่' },
  product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB', imeiSerial: '351234567890123', warrantyExpireDate: new Date('2027-03-05T00:00:00.000Z') },
};

function pay(installmentNo: number, status: string, dueIso: string, amountPaid = '0'): ProgressPaymentRow {
  return { contractId: 'k1', installmentNo, status, dueDate: new Date(dueIso), amountDue: '4200.00', amountPaid };
}

// งวด 1-6 จ่ายแล้ว (ครบกำหนดเดือน มี.ค.-ส.ค.) · งวด 7 ครบกำหนด 05/09 ยังไม่จ่าย ⇒ ค้าง ณ NOW · งวด 8-12 ยังไม่ถึงกำหนด
const PAID_DUE_DAYS = ['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'];
const schedule: ProgressPaymentRow[] = [
  ...PAID_DUE_DAYS.map((day, i) => pay(i + 1, 'PAID', `${day}T00:00:00.000Z`, '4200.00')),
  pay(7, 'OVERDUE', '2026-09-05T00:00:00.000Z'),
  pay(8, 'PENDING', '2026-10-05T00:00:00.000Z'),
  pay(9, 'PENDING', '2026-11-05T00:00:00.000Z'),
  pay(10, 'PENDING', '2026-12-05T00:00:00.000Z'),
  pay(11, 'PENDING', '2027-01-05T00:00:00.000Z'),
  pay(12, 'PENDING', '2027-02-05T00:00:00.000Z'),
];

describe('buildContractProgress', () => {
  it('นับงวดจ่ายแล้ว/ค้าง/เหลือ + ยอดคงค้าง + งวดถัดไปที่ยังไม่ถึงกำหนด + งวดค้างงวดแรก', () => {
    const [p] = buildContractProgress({ contracts: [contract], payments: schedule, lastCalls: [], now: NOW });
    expect(p).toMatchObject({
      id: 'k1',
      contractNumber: 'CT-2569-0042',
      status: 'OVERDUE',
      productLabel: 'Apple iPhone 15 128GB',
      imeiSerial: '351234567890123',
      branchName: 'สำนักงานใหญ่',
      startedAt: '2026-03-05T03:00:00.000Z',
      monthlyPayment: 4200,
      totalInstallments: 12,
      paidInstallments: 6,
      remainingInstallments: 6,
      overdueInstallments: 1,
      overdueAmount: 4200,
      outstanding: 25200,
      nextDueDate: '2026-10-05T00:00:00.000Z',
      nextAmountDue: 4200,
      firstOverdueInstallmentNo: 7,
      firstOverdueDueDate: '2026-09-05T00:00:00.000Z',
      mdmLocked: false,
      shopWarrantyEndDate: null,
      centerWarrantyEndDate: '2027-03-05T00:00:00.000Z',
      lastCall: null,
    });
  });

  it('งวดค้างที่จ่ายมาบางส่วน → ยอดค้างหักส่วนที่จ่ายแล้ว', () => {
    const partial = schedule.map((row) => (row.installmentNo === 7 ? { ...row, status: 'PARTIALLY_PAID', amountPaid: '1000.00' } : row));
    const [p] = buildContractProgress({ contracts: [contract], payments: partial, lastCalls: [], now: NOW });
    expect(p.overdueAmount).toBe(3200);
    expect(p.outstanding).toBe(24200);
  });

  it('ปรับโครงสร้างหนี้แล้วตารางงวดยาวกว่า totalMonths → จำนวนงวดทั้งหมดนับจากแถวจริง ผ่อนแล้ว + เหลือ = ทั้งหมด', () => {
    // สัญญาเดิม 12 งวด แตกงวด 7-12 เป็น 8 งวดใหม่ ⇒ ตาราง 14 แถว แต่ totalMonths ยังเป็น 12
    const rescheduled: ProgressPaymentRow[] = [
      ...schedule.filter((row) => row.status === 'PAID'),
      ...Array.from({ length: 8 }, (_, i) => pay(7 + i, 'PENDING', `2026-${String(10 + (i % 3)).padStart(2, '0')}-05T00:00:00.000Z`)),
    ];
    const [p] = buildContractProgress({ contracts: [contract], payments: rescheduled, lastCalls: [], now: NOW });
    expect(p.totalInstallments).toBe(14);
    expect(p.paidInstallments + p.remainingInstallments).toBe(p.totalInstallments);
    expect(p).toMatchObject({ paidInstallments: 6, remainingInstallments: 8 });
  });

  it('ยังไม่มีตารางงวด → ใช้ totalMonths ของสัญญา', () => {
    const [p] = buildContractProgress({ contracts: [contract], payments: [], lastCalls: [], now: NOW });
    expect(p.totalInstallments).toBe(12);
  });

  it('โทรล่าสุด + เครื่องล็อก + ไม่มีตารางงวด → ศูนย์และ null ไม่พัง', () => {
    const [p] = buildContractProgress({
      contracts: [{ ...contract, mdmLockedAt: new Date('2026-09-10T02:00:00.000Z'), product: null, branch: null }],
      payments: [],
      lastCalls: [{ contractId: 'k1', calledAt: new Date('2026-09-10T07:32:00.000Z'), result: 'PROMISED', notes: 'จะจ่ายวันที่ 15', caller: { name: 'แนน' } }],
      now: NOW,
    });
    expect(p).toMatchObject({
      productLabel: '',
      imeiSerial: null,
      branchName: null,
      paidInstallments: 0,
      remainingInstallments: 0,
      overdueInstallments: 0,
      overdueAmount: 0,
      outstanding: 0,
      nextDueDate: null,
      nextAmountDue: null,
      firstOverdueInstallmentNo: null,
      mdmLocked: true,
      centerWarrantyEndDate: null,
      lastCall: { calledAt: '2026-09-10T07:32:00.000Z', result: 'PROMISED', notes: 'จะจ่ายวันที่ 15', callerName: 'แนน' },
    });
  });
});
