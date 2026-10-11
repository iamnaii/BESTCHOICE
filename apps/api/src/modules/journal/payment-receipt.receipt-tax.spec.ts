import { Decimal } from '@prisma/client/runtime/library';
import { ledgerLines } from './__tests__/ledger-lines-mock';
import * as Sentry from '@sentry/nestjs';
import { PaymentReceiptTemplate } from './cpa-templates/payment-receipt.template';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5) — PaymentReceiptTemplate ประทับค่าที่ใบเสร็จของรายการนี้
 * ต้องพิมพ์ลง metadata.receiptTax (generateReceipt คัดลอกลงแถว Receipt) และตรวจทานภาษีของแถวค่างวดกับภาษีขายของ 2A
 * ที่ลงพร้อมกัน. สัญญามาตรฐาน 17,000/12 → งวด 1,515.83 = 1,416.66 + VAT 99.17
 */
describe('PaymentReceiptTemplate — ใบกำกับภาษีตามบัญชี (receiptTax)', () => {
  const dec = (v: string | number) => new Decimal(v);
  const RECEIPT_DATE = new Date('2026-09-29T03:00:00.000Z');
  const MISMATCH_MESSAGE =
    '[receipt-tax] receipt VAT differs from the 2A output VAT posted with it';

  const contract = {
    id: 'contract-1',
    contractNumber: 'CT-0001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
    status: 'ACTIVE',
  };

  type CapturedJe = { metadata: Record<string, unknown> };

  function build(opts: {
    /** Cr 11-2103 ของรายการก่อนหน้าของงวด (reconstructPriorCleared อ่านจาก journalEntry.findMany) */
    prior?: string[];
    accrual?: { kind: string; amount: string; vat: string; completes: boolean } | null;
    /** PR4: ยอดในบัญชีของสัญญา (glContractBalance → journalLine.findMany) */
    ledger?: Record<string, string>;
    /** PR4: metadata ของรายการของสัญญาที่ advanceVatOutstanding อ่าน (journalEntry.findMany path contractId) */
    stamps?: Record<string, unknown>[];
  }) {
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'inst-3',
          installmentNo: 3,
          contractId: contract.id,
          dueDate: new Date('2026-10-11T17:00:00.000Z'),
          accrualJournalEntryId: null,
          contract,
        }),
      },
      journalEntry: {
        findMany: jest.fn().mockImplementation(async (args: { where?: { metadata?: { path?: string[] } } }) => {
          // PR4: advanceVatOutstanding ค้นด้วย metadata.contractId — คนละคำค้นกับ reconstructPriorCleared
          if (args?.where?.metadata?.path?.[0] === 'contractId') {
            return (opts.stamps ?? []).map((metadata) => ({ metadata }));
          }
          return (opts.prior ?? []).map((credit) => ({
            metadata: { tag: 'receipt', installmentScheduleId: 'inst-3' },
            lines: [{ accountCode: '11-2103', debit: dec(0), credit: dec(credit) }],
          }));
        }),
      },
      journalLine: { findMany: jest.fn(ledgerLines(opts.ledger ?? {})) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const createAndPost = jest
      .fn()
      .mockResolvedValue({ id: 'je-r', entryNumber: 'JE-202609-00078' });
    const accrueAtReceipt = jest.fn().mockResolvedValue(
      opts.accrual === null
        ? null
        : {
            entryNo: 'JE-202609-00077',
            postedAt: RECEIPT_DATE,
            kind: opts.accrual?.kind ?? 'FULL',
            amount: dec(opts.accrual?.amount ?? '1515.83'),
            vat: dec(opts.accrual?.vat ?? '99.17'),
            completes: opts.accrual?.completes ?? true,
          },
    );
    const rootPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const tpl = new PaymentReceiptTemplate(
      { createAndPost } as never,
      rootPrisma as never,
      undefined,
      { accrueAtReceipt } as never,
    );
    return { tpl, tx, createAndPost };
  }

  const stamped = (createAndPost: jest.Mock) =>
    (createAndPost.mock.calls[0][0] as CapturedJe).metadata.receiptTax;

  const base = {
    installmentScheduleId: 'inst-3',
    debitAccountCode: '11-1101',
    paymentId: 'pay-3',
    postedAt: RECEIPT_DATE,
  };

  beforeEach(() => jest.clearAllMocks());

  it('จ่ายเต็มงวด 1,515.83 → ประทับค่าที่ต้องพิมพ์ลง metadata และคืนค่าเดียวกันให้ผู้เรียก', async () => {
    const { tpl, tx, createAndPost } = build({});

    const out = await tpl.execute(
      { ...base, delta: dec('1515.83'), isFinalReceipt: true },
      tx as never,
    );

    const expected = {
      version: 1,
      amount: '1515.83',
      amountBeforeVat: '1416.66',
      vatAmount: '99.17',
      roundingAmount: '0.00',
      lateFeeAmount: '0.00',
      lateFeeWaivedAmount: '0.00',
      advanceAmount: '0.00',
      advanceVatAmount: '0.00',
    };
    expect(stamped(createAndPost)).toEqual(expected);
    expect(out.receiptTax).toEqual(expected);
    expect(out.warnings).toEqual([]);
  });

  it('ใบบางส่วนก่อนวันครบกำหนด 1,000 → VAT ของใบ 65.42 = ภาษีขายของ 2A ที่ลงพร้อมกัน → ไม่มีสัญญาณเตือน', async () => {
    const { tpl, tx, createAndPost } = build({
      accrual: { kind: 'PARTIAL', amount: '1000', vat: '65.42', completes: false },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('1000'), isFinalReceipt: false },
      tx as never,
    );

    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('65.42');
    expect(out.warnings).toEqual([]);
  });

  it('VAT ของใบไม่เท่าภาษีขายของ 2A (งวดที่มีใบรับบางส่วนก่อน PR2ข) → ลงบัญชีตามปกติ + คืนสัญญาณเตือนให้ส่งหลัง commit', async () => {
    // ใบก่อนหน้า 1,000 ไม่เคยตั้งลูกหนี้งวด (คอลัมน์ = 0) → ใบนี้ทำให้งวดครบ: 2A ทั้งงวด VAT 99.17
    // แต่เอกสารแสดงไปแล้ว 65.42 → ใบนี้พิมพ์ 99.17 − 65.42 = 33.75
    const { tpl, tx, createAndPost } = build({
      prior: ['1000'],
      accrual: { kind: 'FULL', amount: '1515.83', vat: '99.17', completes: true },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('515.83'), isFinalReceipt: true },
      tx as never,
    );

    expect(createAndPost).toHaveBeenCalledTimes(1);
    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('33.75');
    expect(out.warnings).toEqual([
      {
        message: MISMATCH_MESSAGE,
        tags: { module: 'journal', action: 'receipt-vat-accrual-mismatch' },
        extra: {
          contractId: 'contract-1',
          contractNumber: 'CT-0001',
          installmentScheduleId: 'inst-3',
          installmentNo: 3,
          paymentId: 'pay-3',
          accrualEntryNumber: 'JE-202609-00077',
          accrualVat: '99.17',
          receiptInstallmentVat: '33.75',
          principalCleared: '515.83',
        },
      },
    ]);
    // ธุรกรรมของผู้เรียก — template ไม่ส่ง Sentry เอง
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ใบบางส่วน 1,000 ตั้ง 2A ของตัวเองแล้ว → ใบที่ทำให้ครบ 515.83 ได้ 2A ส่วนที่เหลือ VAT 33.75 = VAT ของใบ 33.75 → ไม่มีสัญญาณเตือน', async () => {
    // ใบก่อนหน้า 1,000 ตั้ง 2A บางส่วน VAT 65.42 (ก1) → 2A ของใบนี้คือส่วนที่เหลือ 99.17 − 65.42 = 33.75 เท่ากับที่ใบพิมพ์ —
    // เคสปกติของใบรับบางส่วนก่อนวันครบกำหนด ห้ามเตือน (final review T3-1)
    const { tpl, tx, createAndPost } = build({
      prior: ['1000'],
      accrual: { kind: 'REMAINDER', amount: '515.83', vat: '33.75', completes: true },
    });

    const out = await tpl.execute(
      { ...base, delta: dec('515.83'), isFinalReceipt: true },
      tx as never,
    );

    expect((stamped(createAndPost) as Record<string, string>).vatAmount).toBe('33.75');
    expect(out.receiptTax.vatAmount).toBe('33.75');
    expect(out.warnings).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('หักเงินรับล่วงหน้า 500 ในใบเดียวกัน → แถวค่างวด VAT 99.17 (= 2A) · แถวหัก −500.00 / −32.71 (เงินที่พักพร้อมภาษี) · ไม่มีสัญญาณเตือน', async () => {
    // PR4: เงินที่พักหลัง deploy มี stamp park ⇒ ขากลับ 32.71 ลงบัญชี และแถวหักพิมพ์ตัวเลขเดียวกัน
    const { tpl, tx, createAndPost } = build({
      ledger: { '21-1103': '500.00' },
      stamps: [{ advanceVatPark: '32.71' }],
    });

    const out = await tpl.execute(
      { ...base, delta: dec('1015.83'), advanceConsume: dec('500'), isFinalReceipt: true },
      tx as never,
    );

    expect(stamped(createAndPost)).toEqual(
      expect.objectContaining({
        amount: '1015.83',
        advanceAmount: '-500.00',
        advanceVatAmount: '-32.71',
        vatAmount: '66.46',
        amountBeforeVat: '949.37',
      }),
    );
    expect(out.warnings).toEqual([]);
  });

  // PR4 ต5 — ทุกรายการที่มีขาภาษีของ PR4 ประทับ stamp ให้ advanceVatOutstanding อ่าน
  it('พักเงินรับล่วงหน้า 500 ในใบเดียวกัน → stamp metadata.advanceVatPark = "32.71" และมีบรรทัด 21-2102/21-2101 · ไม่มีขาพัก = ไม่มี stamp', async () => {
    const { tpl, tx, createAndPost } = build({});
    await tpl.execute(
      { ...base, delta: dec('2015.83'), advanceCredit: dec('500'), isFinalReceipt: true },
      tx as never,
    );
    const je = createAndPost.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
      lines: { accountCode: string; dr: Decimal; cr: Decimal }[];
    };
    expect(je.metadata.advanceVatPark).toBe('32.71');
    expect(je.metadata.advanceVatConsume).toBeUndefined();
    expect(je.lines.find((l) => l.accountCode === '21-2102')?.dr.toFixed(2)).toBe('32.71');
    expect(je.lines.find((l) => l.accountCode === '21-2101')?.cr.toFixed(2)).toBe('32.71');

    jest.clearAllMocks();
    const plain = build({});
    await plain.tpl.execute({ ...base, delta: dec('1515.83'), isFinalReceipt: true }, plain.tx as never);
    const je2 = plain.createAndPost.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(je2.metadata.advanceVatPark).toBeUndefined();
  });

  // PR4 ต3/ต4/ต9 — ขากลับตอนหักเงินรับล่วงหน้า อ่าน "ยังค้าง" จากสมุด · ใบสุดท้ายรับเศษ · เอกสาร = บัญชี
  describe('PR4 — ขากลับตอนหักเงินรับล่วงหน้า', () => {
    type Je = { metadata: Record<string, unknown>; lines: { accountCode: string; dr: Decimal; cr: Decimal }[] };
    const je = (createAndPost: jest.Mock) => createAndPost.mock.calls[0][0] as Je;

    it('G3 หัก 250 จากถัง 500 (ยังค้าง 32.71 · ถังไม่หมด) → ขากลับ 16.36 · stamp advanceVatConsume · ใบพิมพ์ −16.36', async () => {
      const { tpl, tx, createAndPost } = build({
        ledger: { '21-1103': '500.00' },
        stamps: [{ advanceVatPark: '32.71' }],
      });
      const out = await tpl.execute(
        { ...base, delta: dec('1265.83'), advanceConsume: dec('250'), isFinalReceipt: true },
        tx as never,
      );
      const posted = je(createAndPost);
      expect(posted.lines.find((l) => l.accountCode === '21-2101')?.dr.toFixed(2)).toBe('16.36');
      expect(posted.lines.find((l) => l.accountCode === '21-2102')?.cr.toFixed(2)).toBe('16.36');
      expect(posted.metadata.advanceVatConsume).toBe('16.36');
      expect(posted.metadata.advanceVatPark).toBeUndefined();
      expect(out.receiptTax.advanceVatAmount).toBe('-16.36');
    });

    it('G3 ใบที่สอง หัก 250 ที่เหลือ (ยังค้าง 16.35 · ถังหมด) → ขากลับ 16.35 ทั้งก้อน ไม่ใช่ 16.36 · ใบพิมพ์ −16.35', async () => {
      const { tpl, tx, createAndPost } = build({
        ledger: { '21-1103': '250.00' },
        stamps: [{ advanceVatPark: '32.71' }, { advanceVatConsume: '16.36' }],
      });
      const out = await tpl.execute(
        { ...base, delta: dec('1265.83'), advanceConsume: dec('250'), isFinalReceipt: true },
        tx as never,
      );
      const posted = je(createAndPost);
      expect(posted.lines.find((l) => l.accountCode === '21-2101')?.dr.toFixed(2)).toBe('16.35');
      expect(posted.metadata.advanceVatConsume).toBe('16.35');
      expect(out.receiptTax.advanceVatAmount).toBe('-16.35');
      expect(out.receiptTax.vatAmount).toBe('82.82');
      expect(out.receiptTax.amountBeforeVat).toBe('1183.01');
    });

    it('G7 ใช้เครดิตจากเปลี่ยนเครื่องเสีย (Dr 21-5101 · ไม่มี stamp) → ไม่มีขากลับ ไม่มี stamp — 2A รับรู้เต็มเหมือนเดิม', async () => {
      const { tpl, tx, createAndPost } = build({ ledger: { '21-5101': '2000.00' }, stamps: [] });
      await tpl.execute(
        { ...base, debitAccountCode: '21-5101', delta: dec('1515.83'), isFinalReceipt: true },
        tx as never,
      );
      const posted = je(createAndPost);
      expect(posted.lines.some((l) => l.accountCode === '21-2101' || l.accountCode === '21-2102')).toBe(false);
      expect(posted.metadata.advanceVatConsume).toBeUndefined();
    });

    it('ใช้เครดิตที่มี stamp park (overpayment-credit) ชำระจนถังหมด → ขากลับ = ยังค้างทั้งก้อน · เอกสารใบใช้เครดิตไม่เปลี่ยน (ไม่มีแถวหัก)', async () => {
      const { tpl, tx, createAndPost } = build({
        ledger: { '21-5101': '1515.83' },
        stamps: [{ advanceVatPark: '99.17' }],
      });
      const out = await tpl.execute(
        { ...base, debitAccountCode: '21-5101', delta: dec('1515.83'), isFinalReceipt: true },
        tx as never,
      );
      const posted = je(createAndPost);
      expect(posted.lines.find((l) => l.accountCode === '21-2101')?.dr.toFixed(2)).toBe('99.17');
      expect(posted.metadata.advanceVatConsume).toBe('99.17');
      expect(out.receiptTax.advanceAmount).toBe('0.00');
      expect(out.receiptTax.advanceVatAmount).toBe('0.00');
    });

    it('ไม่มีเงินออกจากถัง (เงินสดล้วน) → ไม่อ่านยอดในบัญชี/stamp เลย (ไม่เพิ่มคำค้นให้ใบรับชำระปกติ)', async () => {
      const { tpl, tx, createAndPost } = build({});
      await tpl.execute({ ...base, delta: dec('1515.83'), isFinalReceipt: true }, tx as never);
      expect(tx.journalLine.findMany).not.toHaveBeenCalled();
      expect(je(createAndPost).metadata.advanceVatConsume).toBeUndefined();
    });
  });

  it('หักเงินรับล่วงหน้าที่พักก่อน PR4 (ไม่มี stamp — ไม่มีขากลับ) → แถวหัก −500.00 / 0.00 · ภาษีของใบ = 99.17 ตามบัญชี (ต9: เอกสาร = บัญชี)', async () => {
    const { tpl, tx, createAndPost } = build({ ledger: { '21-1103': '500.00' }, stamps: [] });

    const out = await tpl.execute(
      { ...base, delta: dec('1015.83'), advanceConsume: dec('500'), isFinalReceipt: true },
      tx as never,
    );

    expect(stamped(createAndPost)).toEqual(
      expect.objectContaining({
        advanceAmount: '-500.00',
        advanceVatAmount: '0.00',
        vatAmount: '99.17',
        amountBeforeVat: '916.66',
      }),
    );
    expect(
      (createAndPost.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata.advanceVatConsume,
    ).toBeUndefined();
    expect(out.warnings).toEqual([]);
  });

  it('ไม่มี 2A ในใบนี้ (งวดตั้งครบแล้ว) → ไม่ตรวจทาน', async () => {
    const { tpl, tx } = build({ prior: ['700'], accrual: null });

    const out = await tpl.execute(
      { ...base, delta: dec('815.83'), isFinalReceipt: true },
      tx as never,
    );

    expect(out.receiptTax.vatAmount).toBe('53.38'); // 99.17 − HALF_UP(700 × 7/107 = 45.79)
    expect(out.warnings).toEqual([]);
  });

  it('template ห่อธุรกรรมเอง → สัญญาณเตือนเรื่อง VAT ถูกส่งหลังธุรกรรมคืนค่า และคืนรายการว่าง', async () => {
    const { tpl } = build({
      prior: ['1000'],
      accrual: { kind: 'FULL', amount: '1515.83', vat: '99.17', completes: true },
    });

    const out = await tpl.execute({ ...base, delta: dec('515.83'), isFinalReceipt: true });

    expect(out.warnings).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      MISMATCH_MESSAGE,
      expect.objectContaining({
        level: 'warning',
        tags: { module: 'journal', action: 'receipt-vat-accrual-mismatch' },
      }),
    );
  });
});
