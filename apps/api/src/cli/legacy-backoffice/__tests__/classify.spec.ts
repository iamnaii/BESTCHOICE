import { Prisma } from '@prisma/client';
import { classifyContract, isOldForm } from '../classify';
import type { LegacyContract, LegacyInstallment } from '../legacy-book';

/** จัดประเภทสัญญาระบบเก่า (สเปก 5.3) — สัญญาสังเคราะห์ทั้งหมด */

const CUTOFF = new Date('2026-11-30T23:59:59+07:00');

function inst(due: string, amount: string, paid: string, statusCode: string): LegacyInstallment {
  const total = new Prisma.Decimal(amount);
  return {
    legacyId: due,
    legacyCode: `TEST-I-${due}`,
    dueDate: new Date(`${due}T00:00:00+07:00`),
    amount: total,
    paid: new Prisma.Decimal(paid),
    balance: total.minus(paid),
    statusCode,
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

const CLOSE = {
  amount: new Prisma.Decimal('4750'),
  discount: new Prisma.Decimal('250'),
  createdAt: new Date('2026-03-01T09:00:00+07:00'),
};

describe('classifyContract', () => {
  it.each<[string, Partial<LegacyContract>, ReturnType<typeof classifyContract>]>([
    [
      "'2' with an unpaid installment due before the cutoff",
      {
        statusCode: '2',
        installments: [
          inst('2026-10-05', '1000', '1000', '4'),
          inst('2026-11-05', '1000', '0', '0'),
          inst('2026-12-05', '1000', '0', '0'),
        ],
      },
      { kind: 'ACTIVE', status: 'OVERDUE', reason: null },
    ],
    [
      "'2' with a partly paid installment due before the cutoff",
      {
        statusCode: '2',
        installments: [
          inst('2026-11-05', '1000', '400', '3'),
          inst('2026-12-05', '1000', '0', '0'),
        ],
      },
      { kind: 'ACTIVE', status: 'OVERDUE', reason: null },
    ],
    [
      "'2' with nothing outstanding before the cutoff",
      {
        statusCode: '2',
        installments: [
          inst('2026-10-05', '1000', '1000', '4'),
          inst('2026-11-05', '1000', '1000', '4'),
          inst('2026-12-05', '1000', '0', '0'),
        ],
      },
      { kind: 'ACTIVE', status: 'ACTIVE', reason: null },
    ],
    [
      "'2' whose past installment has no balance left (settled with a discount)",
      {
        statusCode: '2',
        installments: [
          { ...inst('2026-11-05', '1000', '950', '4'), balance: new Prisma.Decimal(0) },
        ],
      },
      { kind: 'ACTIVE', status: 'ACTIVE', reason: null },
    ],
    [
      "'3' with a close row",
      { statusCode: '3', close: CLOSE },
      { kind: 'HISTORY', status: 'EARLY_PAYOFF', reason: null },
    ],
    [
      "'3' without a close row",
      { statusCode: '3' },
      { kind: 'HISTORY', status: 'COMPLETED', reason: null },
    ],
    [
      "'4' (canceled) — never imported, whatever the contract holds",
      {
        statusCode: '4',
        code: 'TEST-C-0004',
        installments: [inst('2026-10-05', '1000', '0', '0')],
        close: CLOSE,
      },
      { kind: 'SKIP', status: null, reason: 'status-4-canceled' },
    ],
    [
      "'5' (bad debt) — SKIP reason that planImport turns into a blocker",
      { statusCode: '5', code: 'TEST-C-0009' },
      { kind: 'SKIP', status: null, reason: 'bad-debt-unsupported' },
    ],
    ["'0' (no status)", { statusCode: '0' }, { kind: 'SKIP', status: null, reason: 'status-0' }],
    [
      "'1' (waiting to sign)",
      { statusCode: '1' },
      { kind: 'SKIP', status: null, reason: 'status-1' },
    ],
  ])('%s', (_name, over, expected) => {
    expect(classifyContract(contract(over), CUTOFF)).toEqual(expected);
  });

  it('counts an installment due on the cutoff day as overdue, and one due the day after as not', () => {
    const dueOnCutoff = contract({ installments: [inst('2026-11-30', '1000', '0', '0')] });
    const dueAfter = contract({ installments: [inst('2026-12-01', '1000', '0', '0')] });
    expect(classifyContract(dueOnCutoff, CUTOFF).status).toBe('OVERDUE');
    expect(classifyContract(dueAfter, CUTOFF).status).toBe('ACTIVE');
  });
});

describe('isOldForm', () => {
  it('compares the contract date on the Bangkok calendar with 2025-11-14', () => {
    const at = (iso: string) => isOldForm(contract({ createdAt: new Date(iso) }));
    expect(at('2025-11-13T23:59:59+07:00')).toBe(true);
    expect(at('2025-11-13T16:59:59Z')).toBe(true); // 23:59:59 กรุงเทพ
    expect(at('2025-11-13T17:00:00Z')).toBe(false); // 14 พ.ย. 00:00 กรุงเทพ — วันที่ UTC ยังเป็น 13
    expect(at('2025-11-14T00:00:00+07:00')).toBe(false);
  });
});
