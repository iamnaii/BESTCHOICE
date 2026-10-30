import { Prisma } from '@prisma/client';
import type {
  LegacyContract,
  LegacyFileKind,
  LegacyInstallment,
  LegacyReceipt,
} from '../legacy-book';
import { applyPeakBalance } from '../money';
import { mapContractDocuments, mapPayments, type PaymentDraft } from '../payments';
import { legacyOutstanding } from '../peak-recon';

/**
 * แปลงการรับเงิน / หลักฐาน / เอกสารของสัญญาระบบเก่า — ข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-* ยอดกลม ๆ)
 *
 * ค่างวด 1,000 ครบกำหนดวันที่ 5 ทุกเดือน · วันตัด 2026-11-30 23:59:59 กรุงเทพ
 */

const D = (value: string) => new Prisma.Decimal(value);
const CUTOFF = new Date('2026-11-30T23:59:59+07:00');
const day = (date: string) => new Date(`${date}T00:00:00+07:00`);
/** ป้ายใน notes ของงวดที่ยอดจ่ายมาจากบันทึกงวด (ins_paid / ปรับตาม PEAK) ไม่ใช่ผลรวมใบรับเงิน */
const UNBACKED_NOTE = 'ยอดจ่ายตามบันทึกงวดของระบบเก่าหรือยอดที่ปรับตาม PEAK ไม่ใช่ผลรวมใบรับเงิน';

function inst(legacyId: string, due: string, paid = '0', amount = '1000'): LegacyInstallment {
  return {
    legacyId,
    legacyCode: `TEST-I-${legacyId}`,
    dueDate: day(due),
    amount: D(amount),
    paid: D(paid),
    balance: D(amount).minus(paid),
    statusCode: '0',
  };
}

/** ใบรับเงินค่างวด — `installment` = ยอดที่ตัดงวด · `amount` = ยอดในสลิป (ค่างวด + ค่าปรับ − ส่วนลด) */
function receipt(
  legacyId: string,
  installmentLegacyId: string | null,
  date: string,
  installment: string,
  over: Partial<LegacyReceipt> = {},
): LegacyReceipt {
  const mulct = over.mulct ?? D('0');
  const discount = over.discount ?? D('0');
  return {
    legacyId,
    kind: 'INSTALLMENT',
    installmentLegacyId,
    closeLegacyId: null,
    date: day(date),
    amount: D(installment).plus(mulct).minus(discount),
    installment: D(installment),
    mulct,
    discount,
    slipPath: `slip/TEST-R-${legacyId}.jpg`,
    createdAt: new Date(`${date}T10:00:00+07:00`),
    ...over,
  };
}

/** ใบรับเงินปิดบัญชีก่อนกำหนด (`type = '1'`) — `ref_installmemnt` ชี้แถว `contract_close` */
function payoffReceipt(legacyId: string, date: string, amount: string): LegacyReceipt {
  return {
    ...receipt(legacyId, null, date, amount),
    kind: 'EARLY_PAYOFF',
    closeLegacyId: '77',
    amount: D(amount),
  };
}

function contract(over: Partial<LegacyContract>): LegacyContract {
  return {
    contractId: '1',
    code: 'TEST-C-0001',
    statusCode: '2',
    createdAt: new Date('2026-01-05T10:00:00+07:00'),
    order: {},
    detail: {},
    installments: [],
    receipts: [],
    close: null,
    files: [],
    ...over,
  };
}

/** ค่าเงินเป็นข้อความทศนิยม 2 ตำแหน่ง — อ่านผลง่ายและไม่ขึ้นกับรูปของ Decimal */
function summary(p: PaymentDraft) {
  return {
    installmentNo: p.installmentNo,
    amountDue: p.amountDue.toFixed(2),
    amountPaid: p.amountPaid.toFixed(2),
    status: p.status,
    paidDate: p.paidDate,
    lateFee: p.lateFee.toFixed(2),
    lateFeePaid: p.lateFeePaid.toFixed(2),
  };
}

describe('mapPayments', () => {
  it('รวมใบรับเงิน 400 + 600 ของงวดเดียวเป็น 1 งวด PAID · paidDate = ใบล่าสุด · หลักฐาน 2 ใบ', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000')],
      // ใบที่โอนทีหลังอยู่ก่อนในอาร์เรย์ — paidDate ต้องเป็นวันล่าสุด ไม่ใช่ใบสุดท้ายของอาร์เรย์
      receipts: [
        receipt('902', '11', '2026-02-10', '600'),
        receipt('901', '11', '2026-02-03', '400'),
      ],
    });

    const { payments, evidences, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

    expect(payments.map(summary)).toEqual([
      {
        installmentNo: 1,
        amountDue: '1000.00',
        amountPaid: '1000.00',
        status: 'PAID',
        paidDate: day('2026-02-10'),
        lateFee: '0.00',
        lateFeePaid: '0.00',
      },
    ]);
    expect(payments[0].dueDate).toEqual(day('2026-02-05'));
    expect(payments[0].legacyInstallmentCode).toBe('TEST-I-11');
    expect(evidences.map((e) => [e.installmentNo, e.slipPath, e.amount.toFixed(2)])).toEqual([
      [1, 'slip/TEST-R-902.jpg', '600.00'],
      [1, 'slip/TEST-R-901.jpg', '400.00'],
    ]);
    expect(evidences.map((e) => [e.legacyReceiptId, e.date])).toEqual([
      ['902', day('2026-02-10')],
      ['901', day('2026-02-03')],
    ]);
    expect(warnings).toEqual([]);
  });

  it('สถานะ: ค้างและครบกำหนดก่อนวันตัด = OVERDUE · จ่ายบางส่วน = PARTIALLY_PAID · ยังไม่ถึงกำหนด = PENDING', () => {
    const c = contract({
      installments: [
        inst('11', '2026-10-05', '0'),
        inst('12', '2026-11-05', '300'),
        inst('13', '2026-12-05', '0'),
        inst('14', '2027-01-05', '200'),
      ],
      receipts: [
        receipt('901', '12', '2026-11-04', '300'),
        receipt('902', '14', '2026-11-20', '200'),
      ],
    });

    const { payments } = mapPayments(c, 'ACTIVE', CUTOFF);

    expect(
      payments.map((p) => [p.installmentNo, p.status, p.amountPaid.toFixed(2), p.paidDate]),
    ).toEqual([
      [1, 'OVERDUE', '0.00', null],
      [2, 'PARTIALLY_PAID', '300.00', null],
      [3, 'PENDING', '0.00', null],
      [4, 'PARTIALLY_PAID', '200.00', null],
    ]);
  });

  it('ขอบวันตัด: ครบกำหนด 30 พ.ย. (เที่ยงคืนกรุงเทพ) ค้าง = OVERDUE · 1 ธ.ค. = PENDING (เหมือน classify.ts)', () => {
    const c = contract({
      installments: [inst('11', '2026-11-30'), inst('12', '2026-12-01')],
    });

    expect(mapPayments(c, 'ACTIVE', CUTOFF).payments.map((p) => p.status)).toEqual([
      'OVERDUE',
      'PENDING',
    ]);
  });

  it('ยอดเป็น Decimal ไม่ใช่ float — 333.33 + 333.33 + 333.34 = 1000.00 พอดี', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000')],
      receipts: [
        receipt('901', '11', '2026-02-01', '333.33'),
        receipt('902', '11', '2026-02-02', '333.33'),
        receipt('903', '11', '2026-02-03', '333.34'),
      ],
    });

    const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

    expect(payment.amountPaid).toBeInstanceOf(Prisma.Decimal);
    expect(payment.amountPaid.equals(D('1000'))).toBe(true);
    expect(payment.status).toBe('PAID');
  });

  it("kind 'HISTORY' คืนเฉพาะงวดที่ amountPaid > 0 และคงเลขงวดเดิม (สเปก 5.7)", () => {
    const c = contract({
      statusCode: '4',
      installments: [
        inst('11', '2026-02-05', '1000'),
        inst('12', '2026-03-05', '0'),
        inst('13', '2026-04-05', '400'),
        inst('14', '2026-05-05', '0'),
      ],
      receipts: [
        receipt('901', '11', '2026-02-05', '1000'),
        receipt('902', '13', '2026-04-05', '400'),
      ],
    });

    const history = mapPayments(c, 'HISTORY', CUTOFF);
    const active = mapPayments(c, 'ACTIVE', CUTOFF);

    expect(history.payments.map((p) => [p.installmentNo, p.status])).toEqual([
      [1, 'PAID'],
      [3, 'PARTIALLY_PAID'],
    ]);
    expect(active.payments).toHaveLength(4);
    expect(history.evidences.map((e) => e.installmentNo)).toEqual([1, 3]);
  });

  it('ค่าปรับที่เก็บแล้วในระบบเก่า → lateFeePaid = Σ mulct · lateFee = 0 เสมอ · notes มียอด', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000'), inst('12', '2026-03-05', '0')],
      receipts: [
        receipt('901', '11', '2026-02-10', '400', { mulct: D('50') }),
        receipt('902', '11', '2026-02-20', '600', { mulct: D('100') }),
      ],
    });

    const { payments, evidences } = mapPayments(c, 'ACTIVE', CUTOFF);

    expect(payments.map((p) => [p.lateFee.toFixed(2), p.lateFeePaid.toFixed(2)])).toEqual([
      ['0.00', '150.00'],
      ['0.00', '0.00'],
    ]);
    expect(payments[0].notes).toContain('ค่าปรับที่เก็บแล้วในระบบเก่า 150.00');
    expect(payments[1].notes).not.toContain('ค่าปรับ');
    // หลักฐานใช้ยอดในสลิป (ค่างวด + ค่าปรับ)
    expect(evidences.map((e) => e.amount.toFixed(2))).toEqual(['450.00', '700.00']);
  });

  it('งวดจ่ายบางส่วนที่มีค่าปรับ: lateFee = 0 (ยอดค้าง = ค่างวด − ยอดจ่าย ไม่เรียกค่าปรับซ้ำ) · amountPaid ไม่รวมค่าปรับ', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '300')],
      receipts: [receipt('901', '11', '2026-02-10', '300', { mulct: D('50') })],
    });

    const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

    expect(summary(payment)).toEqual({
      installmentNo: 1,
      amountDue: '1000.00',
      amountPaid: '300.00',
      status: 'PARTIALLY_PAID',
      paidDate: null,
      lateFee: '0.00',
      lateFeePaid: '50.00',
    });
    expect(payment.notes).toContain('ค่าปรับที่เก็บแล้วในระบบเก่า 50.00');
    expect(payment.amountDue.plus(payment.lateFee).minus(payment.amountPaid).toFixed(2)).toBe(
      '700.00',
    );
  });

  it('paidDate = วันของใบล่าสุดที่จ่ายค่างวด (ใบที่จ่ายแต่ค่าปรับไม่นับ)', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000')],
      receipts: [
        receipt('901', '11', '2026-02-05', '1000'),
        receipt('902', '11', '2026-02-20', '0', { mulct: D('50') }),
      ],
    });

    const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

    expect([payment.status, payment.paidDate, payment.lateFeePaid.toFixed(2)]).toEqual([
      'PAID',
      day('2026-02-05'),
      '50.00',
    ]);
  });

  it('notes ขึ้นต้นด้วย "ยกมาจากระบบเก่า" และมีรหัสงวดเดิม + รหัสใบรับเงินเดิม', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000'), inst('12', '2026-03-05', '0')],
      receipts: [
        receipt('901', '11', '2026-02-05', '400'),
        receipt('902', '11', '2026-02-06', '600'),
      ],
    });

    const { payments } = mapPayments(c, 'ACTIVE', CUTOFF);

    for (const p of payments) {
      expect(p.notes.startsWith('ยกมาจากระบบเก่า')).toBe(true);
      expect(p.notes).toContain(p.legacyInstallmentCode);
    }
    expect(payments[0].notes).toContain('901');
    expect(payments[0].notes).toContain('902');
  });

  it('ส่วนลดในใบรับเงินเก็บไว้ใน notes (สเปก 5.5) โดยไม่นับเป็นยอดจ่าย', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '900')],
      receipts: [receipt('901', '11', '2026-02-05', '900', { discount: D('100') })],
    });

    const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

    expect(payment.amountPaid.toFixed(2)).toBe('900.00');
    expect(payment.status).toBe('PARTIALLY_PAID');
    expect(payment.notes).toContain('ส่วนลด 100.00');
  });

  describe('ปิดบัญชีก่อนกำหนด (EARLY_PAYOFF)', () => {
    /**
     * สัญญา 4 งวด: งวด 1 จ่ายครบด้วยสลิป · งวด 2 จ่าย 300 แล้วปิดบัญชี · งวด 3–4 ปิดด้วยยอดปิดบัญชี
     * ระบบเก่ากระจายยอดปิดบัญชีลง `ins_paid` ของงวดที่ปิด (`ins_type = 1`) → งวด 2–4 มี paid เกินสลิป
     */
    const payoff = () =>
      contract({
        statusCode: '3',
        close: { amount: D('2500'), discount: D('200'), createdAt: day('2026-03-20') },
        installments: [
          inst('11', '2026-02-05', '1000'),
          inst('12', '2026-03-05', '1000'),
          inst('13', '2026-04-05', '1000'),
          inst('14', '2026-05-05', '800'),
        ],
        receipts: [
          receipt('901', '11', '2026-02-05', '1000', { mulct: D('50') }),
          receipt('902', '12', '2026-03-01', '300'),
          { ...payoffReceipt('903', '2026-03-20', '2500'), mulct: D('70') },
        ],
      });

    it('ใบรับเงินปิดบัญชีเป็นหลักฐานระดับสัญญา (installmentNo = null) ยอดตามสลิป', () => {
      const { evidences } = mapPayments(payoff(), 'HISTORY', CUTOFF);

      expect(
        evidences.map((e) => [e.installmentNo, e.legacyReceiptId, e.amount.toFixed(2)]),
      ).toEqual([
        [1, '901', '1050.00'], // ค่างวด 1,000 + ค่าปรับ 50
        [2, '902', '300.00'],
        [null, '903', '2500.00'],
      ]);
    });

    it('ไม่กระจายเข้างวด · ยอดจ่ายของงวดมาจากสลิปค่างวดเท่านั้น (ไม่นับซ้ำกับยอดปิดบัญชี)', () => {
      const { payments, warnings } = mapPayments(payoff(), 'HISTORY', CUTOFF);

      expect(payments.map(summary)).toEqual([
        {
          installmentNo: 1,
          amountDue: '1000.00',
          amountPaid: '1000.00',
          status: 'PAID',
          paidDate: day('2026-02-05'),
          lateFee: '0.00',
          lateFeePaid: '50.00',
        },
        {
          installmentNo: 2,
          amountDue: '1000.00',
          amountPaid: '300.00',
          // ส่วนที่เหลือปิดด้วยการปิดบัญชี → PAID ณ วันปิดบัญชี (แบบที่ระบบปิดบัญชีก่อนกำหนดเอง)
          status: 'PAID',
          paidDate: day('2026-03-20'),
          lateFee: '0.00',
          lateFeePaid: '0.00',
        },
      ]);
      const paid = payments.reduce((sum, p) => sum.plus(p.amountPaid), D('0'));
      expect(paid.toFixed(2)).toBe('1300.00');
      // ส่วนต่างระหว่าง ins_paid กับสลิปของสัญญาที่ปิดบัญชี = ยอดปิดบัญชีที่ระบบเก่ากระจาย — คาดไว้แล้ว
      expect(warnings).toEqual([]);
      expect(payments[1].notes).toContain('ปิดบัญชีก่อนกำหนด');
    });

    it('HISTORY: งวดจ่ายบางส่วนของสัญญาปิดบัญชี → PAID · paidDate = วันปิดบัญชี · amountPaid = สลิปเท่าเดิม', () => {
      const closedAt = new Date('2026-03-20T14:30:00+07:00');
      const c = {
        ...payoff(),
        close: { amount: D('2500'), discount: D('200'), createdAt: closedAt },
      };

      const [, second] = mapPayments(c, 'HISTORY', CUTOFF).payments;

      expect([second.status, second.paidDate, second.amountPaid.toFixed(2)]).toEqual([
        'PAID',
        closedAt,
        '300.00',
      ]);
      expect(second.notes).toContain('ส่วนที่เหลือปิดด้วยการปิดบัญชีก่อนกำหนด');
    });

    it("kind 'ACTIVE' ก็ไม่ใช้ ins_paid ของงวดที่ไม่มีสลิปเมื่อสัญญามีรายการปิดบัญชี · ไม่ปิดงวดให้ · เตือน BLOCK:", () => {
      const { payments, warnings } = mapPayments(payoff(), 'ACTIVE', CUTOFF);

      expect(payments.map((p) => [p.amountPaid.toFixed(2), p.status])).toEqual([
        ['1000.00', 'PAID'],
        ['300.00', 'PARTIALLY_PAID'],
        ['0.00', 'OVERDUE'],
        ['0.00', 'OVERDUE'],
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].startsWith('BLOCK:')).toBe(true);
      expect(warnings[0]).toContain('TEST-C-0001');
    });

    it("kind 'HISTORY' ของสัญญาปิดบัญชีไม่มีข้อเตือน BLOCK:", () => {
      const { warnings } = mapPayments(payoff(), 'HISTORY', CUTOFF);

      expect(warnings.some((w) => w.startsWith('BLOCK:'))).toBe(false);
    });

    it('สลิปค่างวดมากกว่า ins_paid ในสัญญาที่ปิดบัญชี = เตือน', () => {
      const c = payoff();
      c.installments[1] = { ...c.installments[1], paid: D('200') };

      const { payments, warnings } = mapPayments(c, 'HISTORY', CUTOFF);

      expect(payments[1].amountPaid.toFixed(2)).toBe('300.00');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-C-0001');
      expect(warnings[0]).toContain('TEST-I-12');
    });
  });

  describe('ยอดจ่ายของงวด (ins_paid) กับสลิป', () => {
    it('ไม่มีใบรับเงินแต่ ins_paid > 0 → ใช้ ins_paid · paidDate ว่าง · ไม่มีหลักฐาน · เตือน', () => {
      const c = contract({ installments: [inst('11', '2026-02-05', '400')] });

      const { payments, evidences, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments.map(summary)).toEqual([
        {
          installmentNo: 1,
          amountDue: '1000.00',
          amountPaid: '400.00',
          status: 'PARTIALLY_PAID',
          paidDate: null,
          lateFee: '0.00',
          lateFeePaid: '0.00',
        },
      ]);
      expect(payments[0].notes.startsWith('ยกมาจากระบบเก่า')).toBe(true);
      expect(payments[0].notes).toContain(UNBACKED_NOTE);
      expect(evidences).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-I-11');
    });

    it('ไม่มีใบรับเงินแต่ ins_paid ครบ → PAID โดย paidDate ว่าง', () => {
      const c = contract({ installments: [inst('11', '2026-02-05', '1000')] });

      const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

      expect([payment.status, payment.paidDate]).toEqual(['PAID', null]);
    });

    it('ins_paid มากกว่าสลิป (เช่นปรับตาม PEAK) → ใช้ ins_paid และเตือน', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '500')],
        receipts: [receipt('901', '11', '2026-02-05', '400')],
      });

      const { payments, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments[0].amountPaid.toFixed(2)).toBe('500.00');
      expect(payments[0].notes).toContain(UNBACKED_NOTE);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-C-0001');
      expect(warnings[0]).toContain('TEST-I-11');
    });

    it('สลิปมากกว่า ins_paid → ใช้ยอดสลิปและเตือน', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '500')],
        receipts: [receipt('901', '11', '2026-02-05', '600')],
      });

      const { payments, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments[0].amountPaid.toFixed(2)).toBe('600.00');
      expect(warnings).toHaveLength(1);
    });

    it('ข้อความเตือนไม่มียอดเงิน (มีแค่รหัสสัญญา / งวด)', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '512.34')],
        receipts: [receipt('901', '11', '2026-02-05', '487.66')],
      });

      const { warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toMatch(/512|487/);
    });

    it('งวดที่ applyPeakBalance ปรับแล้ว → ยอดค้างของ PaymentDraft รวมกันเท่า PEAK', () => {
      const raw = [
        inst('11', '2026-09-05', '1000'),
        inst('12', '2026-10-05', '300'),
        inst('13', '2026-11-05', '0'),
        inst('14', '2026-12-05', '0'),
      ];
      const adjusted = applyPeakBalance(raw, D('2400'));
      if ('blocked' in adjusted) throw new Error('unexpected block');
      const c = contract({
        installments: adjusted.installments,
        receipts: [
          receipt('901', '11', '2026-09-05', '1000'),
          receipt('902', '12', '2026-10-05', '300'),
        ],
      });

      const { payments } = mapPayments(c, 'ACTIVE', CUTOFF);

      const remain = payments.reduce((sum, p) => sum.plus(p.amountDue.minus(p.amountPaid)), D('0'));
      expect(remain.toFixed(2)).toBe('2400.00');
      expect(remain.equals(legacyOutstanding({ installments: adjusted.installments }))).toBe(true);
    });

    it('รับเกินค่างวด → PAID และเตือน', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '1100')],
        receipts: [receipt('901', '11', '2026-02-05', '1100')],
      });

      const { payments, warnings } = mapPayments(c, 'HISTORY', CUTOFF);

      expect(payments[0].status).toBe('PAID');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-I-11');
    });

    it('ค่างวดไม่เป็นบวก → เตือนว่าค่างวดผิด (ไม่ใช่ "จ่ายเกิน")', () => {
      const c = contract({ installments: [inst('11', '2026-02-05', '0', '-500')] });

      const { warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ไม่เป็นบวก');
      expect(warnings[0]).not.toContain('เกิน');
    });

    it('HISTORY: งวดที่ไม่นำเข้าไม่มีข้อเตือน (เช่นค่างวดติดลบของสัญญายกเลิก)', () => {
      const c = contract({
        statusCode: '4',
        installments: [inst('11', '2026-02-05', '0', '-500'), inst('12', '2026-03-05', '200')],
      });

      const { payments, warnings } = mapPayments(c, 'HISTORY', CUTOFF);

      expect(payments.map((p) => p.installmentNo)).toEqual([2]);
      // งวด 2 นำเข้า (ยอดจ่ายไม่มีใบรับเงิน → เตือน) · งวด 1 ไม่นำเข้า → ไม่เตือน
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-I-12');
    });
  });

  describe('ยอดจาก dump เป็น float/double — ปัด 2 ตำแหน่งก่อนใช้', () => {
    it('ins_paid มีเศษ float ต่ำกว่าสลิปเล็กน้อย → ถือว่าเท่ากัน ไม่เตือน', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '999.99999999911')],
        receipts: [receipt('901', '11', '2026-02-05', '1000')],
      });

      const { payments, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments[0].amountPaid.toString()).toBe('1000');
      expect(payments[0].status).toBe('PAID');
      expect(warnings).toEqual([]);
    });

    it('ins_paid มีเศษ float สูงกว่าจริง (ไม่มีใบรับเงิน) → ยอดจ่าย 2 ตำแหน่ง', () => {
      const c = contract({ installments: [inst('11', '2026-02-05', '400.0000000009')] });

      const [payment] = mapPayments(c, 'ACTIVE', CUTOFF).payments;

      expect(payment.amountPaid.toString()).toBe('400');
      expect(payment.status).toBe('PARTIALLY_PAID');
    });

    it('ค่างวด / ค่าปรับ / ยอดในสลิปเป็น 2 ตำแหน่ง', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '1000', '1000.0000000004')],
        receipts: [
          receipt('901', '11', '2026-02-05', '1000', {
            mulct: D('49.999999999'),
            amount: D('1049.99999999999'),
          }),
        ],
      });

      const { payments, evidences } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments[0].amountDue.toString()).toBe('1000');
      expect(payments[0].status).toBe('PAID');
      expect(payments[0].lateFee.toString()).toBe('0');
      expect(payments[0].lateFeePaid.toString()).toBe('50');
      expect(evidences[0].amount.toString()).toBe('1050');
    });
  });

  describe('ใบรับเงินที่ผูกงวดไม่ได้', () => {
    it('ชี้งวดที่ไม่มีในสัญญา → ไม่นับเข้างวดใด · หลักฐานระดับสัญญา · เตือน', () => {
      const c = contract({
        installments: [inst('11', '2026-02-05', '0')],
        receipts: [receipt('901', '99', '2026-02-05', '1000')],
      });

      const { payments, evidences, warnings } = mapPayments(c, 'ACTIVE', CUTOFF);

      expect(payments[0].amountPaid.toFixed(2)).toBe('0.00');
      expect(evidences.map((e) => [e.installmentNo, e.legacyReceiptId])).toEqual([[null, '901']]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('901');
    });

    it('HISTORY: สลิปของงวดที่ไม่ถูกนำเข้า (ยอดจ่าย 0 เช่นจ่ายแต่ค่าปรับ) → หลักฐานระดับสัญญา · เตือน', () => {
      const c = contract({
        statusCode: '4',
        installments: [inst('11', '2026-02-05', '0')],
        receipts: [receipt('901', '11', '2026-02-10', '0', { mulct: D('50') })],
      });

      const { payments, evidences, warnings } = mapPayments(c, 'HISTORY', CUTOFF);

      expect(payments).toEqual([]);
      expect(evidences.map((e) => [e.installmentNo, e.legacyReceiptId])).toEqual([[null, '901']]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('TEST-I-11');
    });
  });

  it('ใบรับเงินที่ไม่มีสลิปยังนับเป็นยอดจ่าย แต่ไม่มีหลักฐาน', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000')],
      receipts: [receipt('901', '11', '2026-02-05', '1000', { slipPath: null })],
    });

    const { payments, evidences } = mapPayments(c, 'ACTIVE', CUTOFF);

    expect(payments[0].status).toBe('PAID');
    expect(evidences).toEqual([]);
  });

  it('ไม่แก้สัญญาที่ส่งเข้ามา', () => {
    const c = contract({
      installments: [inst('11', '2026-02-05', '1000')],
      receipts: [receipt('901', '11', '2026-02-05', '1000')],
    });
    const before = JSON.stringify(c);

    mapPayments(c, 'HISTORY', CUTOFF);

    expect(JSON.stringify(c)).toBe(before);
  });
});

describe('mapContractDocuments', () => {
  it.each<[LegacyFileKind, string, string | null]>([
    ['img_contract', 'SIGNED_CONTRACT', null],
    ['img_selfie', 'KYC_SELFIE', null],
    ['img_receive', 'DEVICE_RECEIPT_PHOTO', null],
    ['img_line', 'LINE_PROFILE', null],
    ['img_facebook', 'FACEBOOK_PROFILE', null],
    ['img_income', 'BANK_STATEMENT', null],
    ['img_lock', 'OTHER', 'ภาพล็อกเครื่อง'],
  ])('%s → %s', (kind, documentType, notes) => {
    const c = contract({ files: [{ kind, path: `files/TEST-${kind}.jpg` }] });

    expect(mapContractDocuments(c)).toEqual([
      { documentType, path: `files/TEST-${kind}.jpg`, notes },
    ]);
  });

  it.each<LegacyFileKind>(['order_product_file', 'contract_file'])(
    '%s → OTHER พร้อม notes ที่บอกที่มาในระบบเก่า',
    (kind) => {
      const c = contract({ files: [{ kind, path: `files/TEST-${kind}.pdf` }] });

      const [doc] = mapContractDocuments(c);

      expect(doc.documentType).toBe('OTHER');
      expect(doc.path).toBe(`files/TEST-${kind}.pdf`);
      expect(doc.notes).toContain(kind);
    },
  );

  it('คงลำดับไฟล์ตามที่ส่งเข้ามา · ไม่มีไฟล์ = []', () => {
    const c = contract({
      files: [
        { kind: 'img_selfie', path: 'a.jpg' },
        { kind: 'img_contract', path: 'b.jpg' },
        { kind: 'img_contract', path: 'c.jpg' },
      ],
    });

    expect(mapContractDocuments(c).map((d) => [d.documentType, d.path])).toEqual([
      ['KYC_SELFIE', 'a.jpg'],
      ['SIGNED_CONTRACT', 'b.jpg'],
      ['SIGNED_CONTRACT', 'c.jpg'],
    ]);
    expect(mapContractDocuments(contract({}))).toEqual([]);
  });
});
