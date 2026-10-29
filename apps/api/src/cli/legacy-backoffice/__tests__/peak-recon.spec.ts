import { Prisma } from '@prisma/client';
import type { LegacyBook, LegacyContract, LegacyInstallment } from '../legacy-book';
import {
  parsePeakArCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
  type PeakInvoice,
} from '../peak-recon';

/** จับคู่ใบแจ้งหนี้ PEAK กับสัญญาระบบเก่า — ข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-*, IMEI 3500…) */

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

    it('compares IMEIs by their last 14 characters (PEAK mistypes a digit)', () => {
      const recon = reconcileWithPeak(book(contract({ id: '1', imei: '350000000000001' })), [
        invoice({ code: 'TEST-IV-1', imei: '850000000000001' }), // first digit differs
        invoice({ code: 'TEST-IV-2', imei: '350000000000002' }), // last digit differs
      ]);
      expect(pairs(recon)).toEqual({ '1': 'TEST-IV-1' });
      expect(recon.unmatchedInvoices).toEqual(['TEST-IV-2']);
    });

    it('compares an identifier shorter than 14 characters as a whole (12-digit serials)', () => {
      const recon = reconcileWithPeak(book(contract({ id: '1', imei: '123456789012' })), [
        invoice({ code: 'TEST-IV-1', imei: '23456789012' }), // a suffix is not enough
        invoice({ code: 'TEST-IV-2', imei: ' 1234-5678-9012 ' }),
      ]);
      expect(pairs(recon)).toEqual({ '1': 'TEST-IV-2' });
      expect(recon.unmatchedInvoices).toEqual(['TEST-IV-1']);
    });
  });

  it('matches one to one by IMEI only when net_amount equals the installment total (±1)', () => {
    const recon = reconcileWithPeak(
      book(
        contract({ id: '1', imei: '350000000000001' }),
        contract({ id: '2', imei: '350000000000002' }),
      ),
      [
        invoice({ code: 'TEST-IV-1', imei: '350000000000001', net: '12001.00' }),
        invoice({ code: 'TEST-IV-2', imei: '350000000000002', net: '11998.99' }),
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
          contract({ id: '2', imei: '350000000000002', createdAt: '2026-03-03' }),
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
        contract({ id: '2', status: '4', imei: '350000000000002' }),
        contract({ id: '3', status: '5', imei: '350000000000003' }),
        contract({ id: '4', status: '2', imei: '350000000000004' }),
      ),
      [
        invoice({ code: 'TEST-IV-1', imei: '350000000000009', remain: '0' }), // no contract
        invoice({ code: 'TEST-IV-2', imei: '350000000000002', net: '999', remain: '0' }), // total differs
        invoice({ code: 'TEST-IV-3', imei: '350000000000008', remain: '10' }), // no contract
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
    }).toEqual({
      invoice: 'TEST-IV-1',
      legacyInstallmentTotal: '4000.00',
      legacyOutstanding: '1600.00',
      diff: '-100.00',
      grossDiff: '0.50',
    });
    expect(match?.diff).toBeInstanceOf(Prisma.Decimal);
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
        contract({ id: '2', status: '3', imei: '350000000000002' }),
        contract({ id: '3', imei: '350000000000003', installments: [['500', '250']] }),
      ],
      members: new Map([['501', { member_id: '501', member_name: FAKE_NAME }]]),
      anomalies: [],
    };
  }

  const invoices = [
    invoice({ code: 'TEST-IV-1', net: '2000', remain: '1000.5' }),
    invoice({ code: 'TEST-IV-2', imei: '350000000000002', net: '1', remain: '0' }), // total differs
    invoice({ code: 'TEST-IV-3', imei: '350000000000007', net: '1', remain: '5' }), // no contract
    invoice({ code: 'TEST-IV-4', imei: '350000000000003', net: '700' }), // total differs
  ];

  it('writes one row per matched contract with codes and amounts only', () => {
    const b = namedBook();
    const csv = peakReconCsv(b, reconcileWithPeak(b, invoices));
    expect(csv).toBe(
      'legacy_code,invoice_code,peak_contact_code,legacy_status,legacy_installment_total,' +
        'peak_net_amount,gross_diff,legacy_outstanding,peak_remain,diff\n' +
        'TEST-C-0001,TEST-IV-1,TEST-CT-TEST-IV-1,2,2000.00,2000.00,0.00,1000.00,1000.50,0.50\n',
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
