import { Prisma } from '@prisma/client';
import type { LegacyBook, LegacyContract, LegacyInstallment } from '../legacy-book';
import {
  parsePeakArCsv,
  parsePeakPairsCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
  type PeakInvoice,
  type PeakPair,
} from '../peak-recon';

/**
 * จับคู่ใบแจ้งหนี้ PEAK กับสัญญาระบบเก่า — ข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-*, IMEI 3500…)
 * IMEI ของเครื่องต่างกันต่างกันที่หลักกลาง (35000000000N001) — ต่างทั้ง 14 หลักแรกและ 14 หลักท้าย
 */

const D = (value: string) => new Prisma.Decimal(value);
const IMEI = '350000000000001';

function inst(amount: string, balance: string): LegacyInstallment {
  return {
    legacyId: `${amount}-${balance}`,
    legacyCode: 'TEST-I',
    dueDate: new Date('2026-02-05T00:00:00+07:00'),
    amount: D(amount),
    paid: D(amount).minus(balance),
    balance: D(balance),
    statusCode: '0',
  };
}

type ContractSpec = {
  id: string;
  imei?: string | null;
  status?: string;
  /** วันที่ทำสัญญา `YYYY-MM-DD` (10:00 น. กรุงเทพ) หรือ ISO เต็ม */
  createdAt?: string;
  /** [ค่างวด, คงเหลือ] ต่องวด */
  installments?: [string, string][];
};

function contract(spec: ContractSpec): LegacyContract {
  const createdAt = spec.createdAt ?? '2026-01-05';
  return {
    contractId: spec.id,
    code: `TEST-C-000${spec.id}`,
    statusCode: spec.status ?? '2',
    createdAt: new Date(createdAt.length === 10 ? `${createdAt}T10:00:00+07:00` : createdAt),
    order: { order_id: `10${spec.id}`, ref_member: '501' },
    detail: {
      ref_order_id: `10${spec.id}`,
      mobile_imei: spec.imei === undefined ? IMEI : spec.imei,
    },
    installments: (
      spec.installments ?? [
        ['6000', '0'],
        ['6000', '6000'],
      ]
    ).map(([a, b]) => inst(a, b)),
    receipts: [],
    close: null,
    files: [],
  };
}

function book(...contracts: LegacyContract[]): LegacyBook {
  return { contracts, members: new Map(), anomalies: [] };
}

type InvoiceSpec = {
  code: string;
  imei?: string | null;
  net?: string;
  remain?: string;
  issued?: string;
};

function invoice(spec: InvoiceSpec): PeakInvoice {
  return {
    invoiceCode: spec.code,
    contactCode: `TEST-CT-${spec.code}`,
    issuedDate: new Date(`${spec.issued ?? '2026-01-05'}T00:00:00+07:00`),
    netAmount: D(spec.net ?? '12000'),
    remainAmount: D(spec.remain ?? '6000'),
    imei: spec.imei === undefined ? IMEI : spec.imei,
  };
}

/** คู่ที่จับได้ในรูปที่อ่านง่าย: รหัสสัญญา → รหัสใบแจ้งหนี้ */
function pairs(recon: ReturnType<typeof reconcileWithPeak>): Record<string, string> {
  return Object.fromEntries(
    [...recon.matched].map(([contractId, match]) => [contractId, match.invoice.invoiceCode]),
  );
}

describe('parsePeakArCsv', () => {
  const HEADER = 'invoice_code,contact_code,issued_date,net_amount,remain_amount,imei';

  it('reads both date forms, quoted amounts with thousands separators, a BOM and an empty imei', () => {
    const text =
      `\uFEFF${HEADER}\r\n` +
      'TEST-IV-1,TEST-CT-1,20260105,"12,000.00","4,500.50",350000000000001\r\n' +
      'TEST-IV-2,TEST-CT-2,2026-02-10,6000,0,\r\n';
    const plain = parsePeakArCsv(text).map((i) => ({
      ...i,
      issuedDate: i.issuedDate.toISOString(),
      netAmount: i.netAmount.toFixed(2),
      remainAmount: i.remainAmount.toFixed(2),
    }));
    expect(plain).toEqual([
      {
        invoiceCode: 'TEST-IV-1',
        contactCode: 'TEST-CT-1',
        issuedDate: '2026-01-04T17:00:00.000Z',
        netAmount: '12000.00',
        remainAmount: '4500.50',
        imei: '350000000000001',
      },
      {
        invoiceCode: 'TEST-IV-2',
        contactCode: 'TEST-CT-2',
        issuedDate: '2026-02-09T17:00:00.000Z',
        netAmount: '6000.00',
        remainAmount: '0.00',
        imei: null,
      },
    ]);
  });

  it('finds the columns by header name, in any order, ignoring extra columns', () => {
    const text =
      'imei,note,remain_amount,net_amount,issued_date,contact_code,invoice_code\n' +
      ',"มี, จุลภาค",100,200,20260301,TEST-CT-9,TEST-IV-9\n';
    expect(parsePeakArCsv(text)).toMatchObject([
      { invoiceCode: 'TEST-IV-9', contactCode: 'TEST-CT-9', imei: null },
    ]);
  });

  it('rejects a file without the PEAK columns, naming the missing ones', () => {
    expect(() => parsePeakArCsv('invoice_code,contact_code,issued_date,net_amount\n')).toThrow(
      /ไม่มีคอลัมน์ remain_amount, imei/,
    );
  });

  it.each<[string, string, RegExp]>([
    ['an impossible date', 'TEST-IV-1,TEST-CT-1,20260230,100,0,', /บรรทัด 2 ช่อง issued_date/],
    [
      'a date in another format',
      'TEST-IV-1,TEST-CT-1,05/01/2026,100,0,',
      /บรรทัด 2 ช่อง issued_date/,
    ],
    ['a half-dashed date', 'TEST-IV-1,TEST-CT-1,2026-0105,100,0,', /บรรทัด 2 ช่อง issued_date/],
    [
      'an amount that is not a number',
      'TEST-IV-1,TEST-CT-1,20260105,1e3,0,',
      /บรรทัด 2 ช่อง net_amount/,
    ],
    ['an empty remain_amount', 'TEST-IV-1,TEST-CT-1,20260105,100,,', /บรรทัด 2 ช่อง remain_amount/],
    ['an empty invoice_code', ',TEST-CT-1,20260105,100,0,', /บรรทัด 2 ช่อง invoice_code/],
  ])('rejects %s with the line and column', (_label, row, error) => {
    expect(() => parsePeakArCsv(`${HEADER}\n${row}\n`)).toThrow(error);
  });

  it('rejects the same invoice twice (would count its balance twice)', () => {
    const row = 'TEST-IV-1,TEST-CT-1,20260105,100,0,';
    expect(() => parsePeakArCsv(`${HEADER}\n${row}\n${row}\n`)).toThrow(
      /บรรทัด 3 ช่อง invoice_code — ใบแจ้งหนี้ซ้ำกับบรรทัด 2/,
    );
  });
});

describe('reconcileWithPeak', () => {
  describe('one IMEI can belong to several legacy contracts (repossessed / traded-in devices resold)', () => {
    it('first prefers the contract whose installment total equals net_amount (±1)', () => {
      const recon = reconcileWithPeak(
        book(
          contract({
            id: '1',
            status: '3',
            installments: [
              ['6000', '0'],
              ['6000', '0'],
            ],
          }),
          contract({
            id: '2',
            status: '2',
            installments: [
              ['4500', '0'],
              ['4500', '4500'],
            ],
          }),
        ),
        [invoice({ code: 'TEST-IV-1', net: '12000.50' })],
      );
      expect(pairs(recon)).toEqual({ '1': 'TEST-IV-1' });
      expect(recon.ambiguous).toEqual([]);
    });

    it('then prefers the active contract (status 2)', () => {
      const recon = reconcileWithPeak(
        book(contract({ id: '1', status: '3' }), contract({ id: '2', status: '2' })),
        [invoice({ code: 'TEST-IV-1' })],
      );
      expect(pairs(recon)).toEqual({ '2': 'TEST-IV-1' });
    });

    it('then prefers the contract made closest to issued_date', () => {
      const recon = reconcileWithPeak(
        book(
          contract({ id: '1', createdAt: '2025-06-01' }),
          contract({ id: '2', createdAt: '2026-02-27' }),
        ),
        [invoice({ code: 'TEST-IV-1', issued: '2026-03-02' })],
      );
      expect(pairs(recon)).toEqual({ '2': 'TEST-IV-1' });
    });

    it('is ambiguous when every rule still ties', () => {
      const recon = reconcileWithPeak(
        book(
          contract({ id: '1', createdAt: '2026-02-27' }),
          contract({ id: '2', createdAt: '2026-03-05' }),
        ),
        [invoice({ code: 'TEST-IV-1', issued: '2026-03-02' })],
      );
      expect(recon.matched.size).toBe(0);
      expect(recon.ambiguous).toEqual(['TEST-IV-1']);
      expect(recon.unmatchedContracts).toEqual(['1', '2']);
    });

    it.each<[string, string, string, boolean]>([
      ['exactly equal', '350000000000001', '350000000000001', true],
      [
        'first 14 digits equal (PEAK mistyped the check digit)',
        '350000000000001',
        '350000000000009',
        true,
      ],
      ['last 14 digits equal', '350000000000001', '850000000000001', true],
      [
        'neither the first nor the last 14 digits equal',
        '350000000000001',
        '850000000000009',
        false,
      ],
      [
        'digits read through separators and a label',
        '350000000000001',
        'IMEI: 35-000000-000000-9',
        true,
      ],
      ['a 12-digit serial equal as a whole', '123456789012', ' 1234-5678-9012 ', true],
      ['a 12-digit serial against a part of it', '123456789012', '23456789012', false],
      [
        'serials that differ only in letters (fewer than 14 digits)',
        'A123456789012',
        'B123456789012',
        false,
      ],
      [
        'a 12-digit serial against a longer IMEI ending in it',
        '123456789012',
        '350123456789012',
        false,
      ],
    ])('IMEI match — %s', (_label, contractImei, invoiceImei, expected) => {
      const recon = reconcileWithPeak(book(contract({ id: '1', imei: contractImei })), [
        invoice({ code: 'TEST-IV-1', imei: invoiceImei }),
      ]);
      expect(recon.matched.has('1')).toBe(expected);
    });
  });

  it('matches one to one by IMEI only when net_amount equals the installment total (±1)', () => {
    const recon = reconcileWithPeak(
      book(
        contract({ id: '1', imei: '350000000000001' }),
        contract({ id: '2', imei: '350000000002001' }),
      ),
      [
        invoice({ code: 'TEST-IV-1', imei: '350000000000001', net: '12001.00' }),
        invoice({ code: 'TEST-IV-2', imei: '350000000002001', net: '11998.99' }),
      ],
    );
    expect(pairs(recon)).toEqual({ '1': 'TEST-IV-1' });
    expect(recon.ambiguous).toEqual(['TEST-IV-2']);
    expect(recon.unmatchedContracts).toEqual(['2']);
  });

  it('never gives one contract two invoices — both claims become ambiguous', () => {
    const recon = reconcileWithPeak(
      book(contract({ id: '1' }), contract({ id: '2', status: '3' })),
      [
        invoice({ code: 'TEST-IV-1', issued: '2026-01-05' }),
        invoice({ code: 'TEST-IV-2', issued: '2026-06-05' }),
      ],
    );
    expect(recon.matched.size).toBe(0);
    expect(recon.ambiguous).toEqual(['TEST-IV-1', 'TEST-IV-2']);
    expect(recon.unmatchedContracts).toEqual(['1']);
  });

  describe('an invoice without an IMEI', () => {
    it('matches by installment total and a contract date within ±3 Bangkok calendar days', () => {
      const recon = reconcileWithPeak(
        book(
          contract({ id: '1', imei: '350000000000001', createdAt: '2026-03-01T23:30:00+07:00' }),
          contract({ id: '2', imei: null, createdAt: '2026-03-10' }),
        ),
        [
          // 3 calendar days before, although more than 3 × 24 hours before
          invoice({ code: 'TEST-IV-1', imei: null, issued: '2026-02-26' }),
          invoice({ code: 'TEST-IV-2', imei: null, issued: '2026-03-14' }), // 4 days after
        ],
      );
      expect(pairs(recon)).toEqual({ '1': 'TEST-IV-1' });
      expect(recon.unmatchedInvoices).toEqual(['TEST-IV-2']);
      expect(recon.unmatchedContracts).toEqual(['2']);
    });

    it('is ambiguous when several contracts fit', () => {
      const recon = reconcileWithPeak(
        book(
          contract({ id: '1', createdAt: '2026-03-01' }),
          contract({ id: '2', imei: '350000000002001', createdAt: '2026-03-03' }),
        ),
        [invoice({ code: 'TEST-IV-1', imei: '', issued: '2026-03-02' })],
      );
      expect(recon.matched.size).toBe(0);
      expect(recon.ambiguous).toEqual(['TEST-IV-1']);
    });
  });

  it('does not count a fully paid invoice or a closed contract as a discrepancy', () => {
    const recon = reconcileWithPeak(
      book(
        contract({ id: '1', status: '3', imei: '350000000000001' }),
        contract({ id: '2', status: '4', imei: '350000000002001' }),
        contract({ id: '3', status: '5', imei: '350000000003001' }),
        contract({ id: '4', status: '2', imei: '350000000004001' }),
      ),
      [
        invoice({ code: 'TEST-IV-1', imei: '350000000009001', remain: '0' }), // no contract
        invoice({ code: 'TEST-IV-2', imei: '350000000002001', net: '999', remain: '0' }), // total differs
        invoice({ code: 'TEST-IV-3', imei: '350000000008001', remain: '10' }), // no contract
      ],
    );
    expect(recon.matched.size).toBe(0);
    expect(recon.unmatchedContracts).toEqual(['4']);
    expect(recon.unmatchedInvoices).toEqual(['TEST-IV-3']);
    expect(recon.ambiguous).toEqual([]);
  });

  it('never pairs an invoice with a contract that was never made (status 0 / 1)', () => {
    const recon = reconcileWithPeak(
      book(contract({ id: '1', status: '0' }), contract({ id: '2', status: '1' })),
      [invoice({ code: 'TEST-IV-1' })],
    );
    expect(recon.matched.size).toBe(0);
    expect(recon.unmatchedInvoices).toEqual(['TEST-IV-1']);
    expect(recon.unmatchedContracts).toEqual([]);
  });

  it('diff = remain_amount − legacy outstanding (Σ positive balances) · grossDiff = net − total', () => {
    const recon = reconcileWithPeak(
      book(
        contract({
          id: '1',
          installments: [
            ['1000', '0'],
            ['1000', '600'],
            ['1000', '1000'],
            ['1000', '-20'], // paid 20 too much — not outstanding
          ],
        }),
      ),
      [invoice({ code: 'TEST-IV-1', net: '4000.50', remain: '1500' })],
    );
    const match = recon.matched.get('1');
    expect({
      invoice: match?.invoice.invoiceCode,
      legacyInstallmentTotal: match?.legacyInstallmentTotal.toFixed(2),
      legacyOutstanding: match?.legacyOutstanding.toFixed(2),
      diff: match?.diff.toFixed(2),
      grossDiff: match?.grossDiff.toFixed(2),
      source: match?.source,
      note: match?.note,
    }).toEqual({
      invoice: 'TEST-IV-1',
      legacyInstallmentTotal: '4000.00',
      legacyOutstanding: '1600.00',
      diff: '-100.00',
      grossDiff: '0.50',
      source: 'auto',
      note: null,
    });
    expect(match?.diff).toBeInstanceOf(Prisma.Decimal);
  });

  describe('manual pairs (--peak-pairs)', () => {
    const pair = (invoiceCode: string, legacyCode: string): PeakPair => ({
      invoiceCode,
      legacyCode,
    });

    it('wins over an ambiguous auto result', () => {
      const recon = reconcileWithPeak(
        book(
          contract({ id: '1', createdAt: '2026-02-27' }),
          contract({ id: '2', createdAt: '2026-03-05' }),
        ),
        [invoice({ code: 'TEST-IV-1', issued: '2026-03-02' })],
        [pair('TEST-IV-1', 'TEST-C-0002')],
      );
      expect(pairs(recon)).toEqual({ '2': 'TEST-IV-1' });
      expect(recon.matched.get('2')).toMatchObject({ source: 'manual', note: null });
      expect(recon.ambiguous).toEqual([]);
      expect(recon.unmatchedContracts).toEqual(['1']);
    });

    it('takes the contract out of the auto pool, so the other invoice falls to the resold one', () => {
      // same device, same price: without the pair both invoices claim the active contract
      const recon = reconcileWithPeak(
        book(contract({ id: '1' }), contract({ id: '2', status: '3' })),
        [
          invoice({ code: 'TEST-IV-1', issued: '2025-06-05', remain: '0' }),
          invoice({ code: 'TEST-IV-2', issued: '2026-01-05' }),
        ],
        [pair('TEST-IV-2', 'TEST-C-0001')],
      );
      expect(pairs(recon)).toEqual({ '1': 'TEST-IV-2', '2': 'TEST-IV-1' });
      expect(recon.matched.get('2')?.source).toBe('auto');
      expect(recon.ambiguous).toEqual([]);
    });

    it('keeps a pair whose IMEI or total differs, noting imei-mismatch for the IMEI', () => {
      const recon = reconcileWithPeak(
        book(contract({ id: '1', imei: '350000000000001' }), contract({ id: '2', imei: null })),
        [
          invoice({ code: 'TEST-IV-1', imei: '360000000000002', net: '999' }),
          invoice({ code: 'TEST-IV-2', imei: '350000000002001' }), // nothing to compare against
        ],
        [pair('TEST-IV-1', 'TEST-C-0001'), pair('TEST-IV-2', 'TEST-C-0002')],
      );
      expect(recon.matched.get('1')).toMatchObject({ source: 'manual', note: 'imei-mismatch' });
      expect(recon.matched.get('1')?.grossDiff.toFixed(2)).toBe('-11001.00');
      expect(recon.matched.get('2')).toMatchObject({ source: 'manual', note: null });
    });

    it.each<[string, PeakPair[], RegExp]>([
      [
        'an unknown invoice_code',
        [pair('TEST-IV-404', 'TEST-C-0001')],
        /ไม่พบใบแจ้งหนี้ TEST-IV-404/,
      ],
      ['an unknown legacy_code', [pair('TEST-IV-1', 'TEST-C-0404')], /ไม่พบสัญญา TEST-C-0404/],
      [
        'an invoice paired twice',
        [pair('TEST-IV-1', 'TEST-C-0001'), pair('TEST-IV-1', 'TEST-C-0002')],
        /ใบแจ้งหนี้ TEST-IV-1 อยู่ในไฟล์จับคู่มากกว่าหนึ่งแถว/,
      ],
      [
        'a contract paired twice',
        [pair('TEST-IV-1', 'TEST-C-0001'), pair('TEST-IV-2', 'TEST-C-0001')],
        /สัญญา TEST-C-0001 อยู่ในไฟล์จับคู่มากกว่าหนึ่งแถว/,
      ],
    ])('rejects %s, naming the codes', (_label, manual, error) => {
      expect(() =>
        reconcileWithPeak(
          book(contract({ id: '1' }), contract({ id: '2' })),
          [invoice({ code: 'TEST-IV-1' }), invoice({ code: 'TEST-IV-2' })],
          manual,
        ),
      ).toThrow(error);
    });
  });
});

describe('parsePeakPairsCsv', () => {
  it('reads the pairs by header name (any order, BOM, extra columns)', () => {
    expect(
      parsePeakPairsCsv('\uFEFFlegacy_code,note,invoice_code\r\nTEST-C-0001,x,TEST-IV-1\r\n'),
    ).toEqual([{ invoiceCode: 'TEST-IV-1', legacyCode: 'TEST-C-0001' }]);
  });

  it('rejects a missing column or an empty cell with the line', () => {
    expect(() => parsePeakPairsCsv('invoice_code\nTEST-IV-1\n')).toThrow(
      /ไม่มีคอลัมน์ legacy_code/,
    );
    expect(() => parsePeakPairsCsv('invoice_code,legacy_code\nTEST-IV-1,\n')).toThrow(
      /บรรทัด 2 ช่อง legacy_code — ไม่มีค่า/,
    );
  });
});

describe('peak-recon CSV files', () => {
  const FAKE_NAME = 'นายทดสอบ สมมุติ';

  function namedBook(): LegacyBook {
    const active = contract({
      id: '1',
      installments: [
        ['1000', '0'],
        ['1000', '1000'],
      ],
    });
    active.order = { ...active.order, customer_name: FAKE_NAME };
    active.detail = { ...active.detail, buyer_name: FAKE_NAME };
    return {
      contracts: [
        active,
        contract({ id: '2', status: '3', imei: '350000000002001' }),
        contract({ id: '3', imei: '350000000003001', installments: [['500', '250']] }),
      ],
      members: new Map([['501', { member_id: '501', member_name: FAKE_NAME }]]),
      anomalies: [],
    };
  }

  const invoices = [
    invoice({ code: 'TEST-IV-1', net: '2000', remain: '1000.5' }),
    invoice({ code: 'TEST-IV-2', imei: '350000000002001', net: '1', remain: '0' }), // total differs
    invoice({ code: 'TEST-IV-3', imei: '350000000007001', net: '1', remain: '5' }), // no contract
    invoice({ code: 'TEST-IV-4', imei: '350000000003001', net: '700' }), // total differs
  ];

  it('writes one row per matched contract with codes, amounts, source and note only', () => {
    const b = namedBook();
    const manual = [{ invoiceCode: 'TEST-IV-3', legacyCode: 'TEST-C-0003' }];
    const csv = peakReconCsv(b, reconcileWithPeak(b, invoices, manual));
    expect(csv).toBe(
      'legacy_code,invoice_code,peak_contact_code,legacy_status,legacy_installment_total,' +
        'peak_net_amount,gross_diff,legacy_outstanding,peak_remain,diff,source,note\n' +
        'TEST-C-0001,TEST-IV-1,TEST-CT-TEST-IV-1,2,2000.00,2000.00,0.00,1000.00,1000.50,0.50,auto,\n' +
        'TEST-C-0003,TEST-IV-3,TEST-CT-TEST-IV-3,2,500.00,1.00,-499.00,250.00,5.00,-245.00,' +
        'manual,imei-mismatch\n',
    );
    expect(csv).not.toContain(FAKE_NAME);
  });

  it('lists unmatched active contracts, ambiguous invoices and unmatched invoices', () => {
    const b = namedBook();
    const csv = peakReconUnmatchedCsv(b, reconcileWithPeak(b, invoices));
    expect(csv).toBe(
      'kind,code,legacy_outstanding\n' +
        'unmatched-contract,TEST-C-0003,250.00\n' +
        'ambiguous-invoice,TEST-IV-4,\n' +
        'unmatched-invoice,TEST-IV-3,\n',
    );
    expect(csv).not.toContain(FAKE_NAME);
  });

  it('quotes a code that holds a comma or a quote', () => {
    const b = book({ ...contract({ id: '1' }), code: 'TEST-C-"1",A' });
    const csv = peakReconCsv(b, reconcileWithPeak(b, [invoice({ code: 'TEST-IV-1' })]));
    expect(csv.split('\n')[1]).toMatch(/^"TEST-C-""1"",A",TEST-IV-1,/);
  });
});
