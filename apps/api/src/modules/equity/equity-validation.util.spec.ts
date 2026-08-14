import { Prisma, ShareholderType } from '@prisma/client';
import { validateEquityDoc, computeDefaultWht } from './equity-validation.util';

const D = Prisma.Decimal;
const base = {
  txnType: 'CAP_INIT' as const,
  resolutionNo: 'MOA-2569-001',
  resolutionDate: new Date('2026-01-10'),
  paymentAccountCode: '11-1201',
  paAccountCode: null,
  paAmount: null,
  paDirection: null,
  lines: [
    {
      shareholderId: 'sh-1',
      amount: new D('500000'),
      premium: new D(0),
      paid: new D('500000'),
      wht: new D(0),
    },
    {
      shareholderId: 'sh-2',
      amount: new D('500000'),
      premium: new D(0),
      paid: new D('0'),
      wht: new D(0),
    },
  ],
};
const codes = (errs: { code: string }[]) => errs.map((e) => e.code);

describe('validateEquityDoc', () => {
  it('CAP_INIT ครบถ้วน + paid 50% → ผ่าน', () => {
    expect(validateEquityDoc(base, { hasAttachment: true })).toEqual([]);
  });

  it('V_INIT_25: paid 24.99% ของ par → fail; 25% พอดี → ผ่าน (Decimal ตรงๆ ไม่มี tolerance)', () => {
    const under = {
      ...base,
      lines: [{ ...base.lines[0], amount: new D('1000000'), paid: new D('249999.99') }],
    };
    expect(codes(validateEquityDoc(under, { hasAttachment: true }))).toContain('V_INIT_25');
    const exact = {
      ...base,
      lines: [{ ...base.lines[0], amount: new D('1000000'), paid: new D('250000') }],
    };
    expect(codes(validateEquityDoc(exact, { hasAttachment: true }))).not.toContain('V_INIT_25');
  });

  it('V_INIT_PAID_LE_PAR: paid > par → fail', () => {
    const doc = {
      ...base,
      lines: [{ ...base.lines[0], amount: new D('100'), paid: new D('100.01') }],
    };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('V_INIT_PAID_LE_PAR');
  });

  it('V_SH_UNIQUE: shareholderId ซ้ำ → fail', () => {
    const doc = { ...base, lines: [base.lines[0], { ...base.lines[1], shareholderId: 'sh-1' }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('V_SH_UNIQUE');
  });

  it('V_RESOLUTION: DIV_DEC ไม่มีเลขมติ → fail; DRAW ไม่ต้องมี → ผ่าน', () => {
    const divDec = {
      ...base,
      txnType: 'DIV_DEC' as const,
      resolutionNo: null,
      resolutionDate: null,
      paymentAccountCode: null,
    };
    expect(codes(validateEquityDoc(divDec, { hasAttachment: true }))).toContain('V_RESOLUTION');
    const draw = {
      ...base,
      txnType: 'DRAW' as const,
      resolutionNo: null,
      resolutionDate: null,
      lines: [base.lines[0]],
    };
    expect(codes(validateEquityDoc(draw, { hasAttachment: false }))).not.toContain('V_RESOLUTION');
  });

  it('V8: ประเภทที่ต้องมีมติ แต่ไม่มีไฟล์แนบ → fail', () => {
    expect(codes(validateEquityDoc(base, { hasAttachment: false }))).toContain('V8');
  });

  it('PAYMENT: DIV_PAY ไม่เลือกช่องเงิน → fail', () => {
    const doc = {
      ...base,
      txnType: 'DIV_PAY' as const,
      paymentAccountCode: null,
      resolutionNo: null,
      resolutionDate: null,
      lines: [{ ...base.lines[0], wht: new D('50000') }],
    };
    expect(codes(validateEquityDoc(doc, { hasAttachment: false }))).toContain('PAYMENT');
  });

  it('SH_REQUIRED: CAP_INC ไม่มีบรรทัดผู้ถือหุ้น → fail · PRIOR_ADJ ไม่ต้องมี → ผ่าน', () => {
    const noLines = { ...base, txnType: 'CAP_INC' as const, lines: [] };
    expect(codes(validateEquityDoc(noLines, { hasAttachment: true }))).toContain('SH_REQUIRED');
    const pa = {
      ...base,
      txnType: 'PRIOR_ADJ' as const,
      lines: [],
      paymentAccountCode: null,
      paAccountCode: '11-1201',
      paAmount: new D('100'),
      paDirection: 'DR_OTHER_CR_RE' as const,
    };
    expect(codes(validateEquityDoc(pa, { hasAttachment: true }))).not.toContain('SH_REQUIRED');
  });

  it('SH_AMOUNT: amount ≤ 0 → fail', () => {
    const doc = { ...base, lines: [{ ...base.lines[0], amount: new D('0'), paid: new D('0') }] };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('SH_AMOUNT');
  });

  it('WHT_RANGE: DIV_PAY wht เกิน amount → fail', () => {
    const doc = {
      ...base,
      txnType: 'DIV_PAY' as const,
      resolutionNo: null,
      resolutionDate: null,
      lines: [{ ...base.lines[0], amount: new D('100'), wht: new D('100.01') }],
    };
    expect(codes(validateEquityDoc(doc, { hasAttachment: false }))).toContain('WHT_RANGE');
  });

  it('PA_FIELDS: PRIOR_ADJ ขาด paAmount → fail', () => {
    const doc = {
      ...base,
      txnType: 'PRIOR_ADJ' as const,
      lines: [],
      paymentAccountCode: null,
      paAccountCode: '11-1201',
      paAmount: null,
      paDirection: 'DR_OTHER_CR_RE' as const,
    };
    expect(codes(validateEquityDoc(doc, { hasAttachment: true }))).toContain('PA_FIELDS');
  });
});

describe('computeDefaultWht', () => {
  it('INDIVIDUAL → 10% HALF_UP 2dp', () => {
    expect(computeDefaultWht('INDIVIDUAL' as ShareholderType, new D('333.35')).toFixed(2)).toBe(
      '33.34',
    );
  });
  it('JURISTIC_TH → 0 (ม.65 ทวิ(10))', () => {
    expect(computeDefaultWht('JURISTIC_TH' as ShareholderType, new D('1000')).toFixed(2)).toBe(
      '0.00',
    );
  });
  it('JURISTIC_FOREIGN → 10% default', () => {
    expect(computeDefaultWht('JURISTIC_FOREIGN' as ShareholderType, new D('1000')).toFixed(2)).toBe(
      '100.00',
    );
  });
});
