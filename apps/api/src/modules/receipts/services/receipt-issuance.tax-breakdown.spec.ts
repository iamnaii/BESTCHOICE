import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptIssuanceService } from './receipt-issuance.service';
import { domainAccessExecution, type DomainAccessExecution } from '../../employee-access/access-execution-context';

/**
 * ใบกำกับภาษีตามบัญชี (PR3 — คำตัดสินฝ่ายบัญชี D3–D5): generateReceipt เก็บค่าที่ใบค่างวดต้องพิมพ์ ณ ตอนออกใบ
 * จาก metadata.receiptTax ของรายการบัญชีที่ผูก · ออกได้หนึ่งใบต่อรายการบัญชีหนึ่งรายการ (เรียกซ้ำได้ใบเดิม) ·
 * ใบเสร็จปิดยอดก่อนกำหนดยังพิมพ์แบบเดิม (ย้ายไป PR5) · ข้อความใบเสร็จทาง LINE ใช้กติกาเดิมกับทุกช่องทาง รวมใบของ
 * เงินที่เข้าทางลิงก์ชำระและการใช้เครดิตชำระ (คำตอบเจ้าของ ถ4 2026-09-30 — ส่งแบบเดียวกับหน้ารับชำระ).
 */
describe('ReceiptIssuanceService — ใบกำกับภาษีตามบัญชี', () => {
  const RECEIPT_TAX = {
    version: 1,
    amount: '6079.00',
    amountBeforeVat: '5681.00',
    vatAmount: '397.67',
    roundingAmount: '0.33',
    lateFeeAmount: '0.00',
    lateFeeWaivedAmount: '0.00',
    advanceAmount: '0.00',
    advanceVatAmount: '0.00',
  };
  const TAX_COLUMNS = [
    'amountBeforeVat',
    'vatAmount',
    'roundingAmount',
    'lateFeeAmount',
    'lateFeeWaivedAmount',
    'advanceAmount',
    'advanceVatAmount',
  ];

  function buildService(opts: {
    source?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
    lineLinked?: boolean;
  }) {
    const created: Record<string, unknown>[] = [];
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          deletedAt: null,
          customer: { name: 'ลูกค้าทดสอบ' },
          payments: [],
          financedAmount: '10000',
          totalMonths: 10,
        }),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { findUnique: jest.fn().mockResolvedValue(null) },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'r1', ...args.data };
        }),
      },
      journalEntry: { findUnique: jest.fn().mockResolvedValue(opts.source ?? null) },
      customer: {
        findFirst: jest.fn().mockResolvedValue(opts.lineLinked ? { id: 'cust-1' } : null),
      },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as never;
    const numbers = {
      generateReceiptNumber: jest.fn().mockResolvedValue('RT-202610-00001'),
    };
    const lineOa = { sendPaymentReceipt: jest.fn().mockResolvedValue(true) };
    const svc = new ReceiptIssuanceService(prisma, lineOa as never, numbers as never);
    return { svc, tx, created, numbers, lineOa };
  }

  const money = (v: unknown) => (v == null ? v : new Prisma.Decimal(String(v)).toFixed(2));
  const receiptSource = (extraMeta: Record<string, unknown> = { receiptTax: RECEIPT_TAX }) => ({
    id: 'je-r',
    status: 'POSTED',
    deletedAt: null,
    metadata: { tag: 'receipt', contractId: 'c1', paymentId: 'p1', ...extraMeta },
  });

  it('ใบรับชำระค่างวด: คัดลอก metadata.receiptTax ของรายการที่ผูกลงคอลัมน์ทั้ง 7 ช่อง', async () => {
    const { svc, created } = buildService({ source: receiptSource() });

    await svc.generateReceipt(
      'c1',
      'p1',
      'INSTALLMENT',
      6079,
      3,
      'CASH',
      null,
      'u1',
      undefined,
      'JE-1',
    );

    expect(created).toHaveLength(1);
    expect(created[0].sourceJournalEntryId).toBe('je-r');
    expect(TAX_COLUMNS.map((k) => [k, money(created[0][k])])).toEqual([
      ['amountBeforeVat', '5681.00'],
      ['vatAmount', '397.67'],
      ['roundingAmount', '0.33'],
      ['lateFeeAmount', '0.00'],
      ['lateFeeWaivedAmount', '0.00'],
      ['advanceAmount', '0.00'],
      ['advanceVatAmount', '0.00'],
    ]);
  });

  it.each([
    ['ยอดของใบไม่เท่ายอดที่ประทับ', { receiptTax: RECEIPT_TAX }, 6000],
    ['รายการเก่าที่ไม่มี receiptTax', {}, 6079],
    [
      'receiptTax ผลรวมไม่เท่ายอดรับ',
      { receiptTax: { ...RECEIPT_TAX, vatAmount: '397.68' } },
      6079,
    ],
  ])(
    '%s → ไม่เก็บค่า (PDF ใช้ตรรกะเดิม) แต่ยังผูกรายการบัญชี',
    async (_label, extraMeta, amount) => {
      const { svc, created } = buildService({ source: receiptSource(extraMeta) });

      await svc.generateReceipt(
        'c1',
        'p1',
        'INSTALLMENT',
        amount,
        3,
        'CASH',
        null,
        'u1',
        undefined,
        'JE-1',
      );

      expect(created[0].sourceJournalEntryId).toBe('je-r');
      expect(created[0].vatAmount).toBeUndefined();
      expect(created[0].roundingAmount).toBeUndefined();
    },
  );

  it('ใบเสร็จปิดยอดก่อนกำหนด (ย้ายไป PR5): ผู้เรียกไม่ส่งเลขที่รายการ → ไม่ผูกรายการ ไม่เก็บค่า — PDF พิมพ์แบบเดิม', async () => {
    const { svc, tx, created } = buildService({});

    await svc.generateReceipt(
      'c1',
      null,
      'EARLY_PAYOFF',
      17339.96,
      null,
      'BANK_TRANSFER',
      null,
      'u1',
    );

    expect(tx.journalEntry.findUnique).not.toHaveBeenCalled();
    expect(tx.receipt.findFirst).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0].sourceJournalEntryId).toBeUndefined();
    for (const k of TAX_COLUMNS) expect(created[0][k]).toBeUndefined();
  });

  // ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16.1/16.2 · 2026-10-18): ผูกรายการ JP4 (tag JP4 · flow early-payoff ·
  // paymentId ไม่มี) และคัดลอก receiptTax ที่ earlyPayoff ประทับไว้ — รวมช่องส่วนลดดอกเบี้ยปิดยอด
  const PAYOFF_TAX = {
    version: 1,
    amount: '15189.98',
    amountBeforeVat: '17000.00',
    vatAmount: '1190.00',
    roundingAmount: '0.00',
    lateFeeAmount: '0.00',
    lateFeeWaivedAmount: '0.00',
    advanceAmount: '0.00',
    advanceVatAmount: '0.00',
    discountAmount: '3000.02',
  };
  const jp4Source = (meta: Record<string, unknown> = {}) => ({
    id: 'je-jp4',
    status: 'POSTED',
    deletedAt: null,
    metadata: { tag: 'JP4', flow: 'early-payoff', contractId: 'c1', receiptTax: PAYOFF_TAX, ...meta },
  });

  it('ใบปิดยอดผูกรายการ JP4 → เก็บค่าที่ประทับรวม discountAmount (16.1: 17,000 / 1,190 / ส่วนลด 3,000.02)', async () => {
    const { svc, tx, created } = buildService({ source: jp4Source() });

    await svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 15189.98, null, 'BANK_TRANSFER', null, 'u1', undefined, 'JE-JP4');

    expect(tx.journalEntry.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entryNumber: 'JE-JP4' } }),
    );
    expect(created).toHaveLength(1);
    expect(created[0].sourceJournalEntryId).toBe('je-jp4');
    expect(created[0].amountBeforeVat?.toString()).toBe('17000');
    expect(created[0].vatAmount?.toString()).toBe('1190');
    expect(created[0].discountAmount?.toString()).toBe('3000.02');
    expect(created[0].advanceAmount?.toString()).toBe('0');
  });

  it('รายการ JP4 ไม่มี receiptTax (ปิดยอดที่ประทับไม่ได้ — เช่น มีเงินรับเกิน 18.2) → ผูกรายการแต่ช่องว่าง (พิมพ์แบบเดิม)', async () => {
    const { svc, created } = buildService({ source: jp4Source({ receiptTax: undefined }) });

    await svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 15189.98, null, 'BANK_TRANSFER', null, 'u1', undefined, 'JE-JP4');

    expect(created).toHaveLength(1);
    expect(created[0].sourceJournalEntryId).toBe('je-jp4');
    for (const k of [...TAX_COLUMNS, 'discountAmount']) expect(created[0][k]).toBeUndefined();
  });

  it('ยอดใบไม่ตรง receiptTax.amount ของ JP4 → ไม่เก็บค่า (ผูกรายการตามเดิม)', async () => {
    const { svc, created } = buildService({ source: jp4Source() });

    await svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 15189.0, null, 'BANK_TRANSFER', null, 'u1', undefined, 'JE-JP4');

    expect(created).toHaveLength(1);
    expect(created[0].sourceJournalEntryId).toBe('je-jp4');
    expect(created[0].discountAmount).toBeUndefined();
    expect(created[0].vatAmount).toBeUndefined();
  });

  it('เลขที่รายการที่ส่งมาไม่ใช่ JP4 ของสัญญานี้ (สัญญาอื่น) → ปฏิเสธก่อนสร้างใบ', async () => {
    const { svc, created } = buildService({ source: jp4Source({ contractId: 'c2' }) });

    await expect(
      svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 15189.98, null, 'BANK_TRANSFER', null, 'u1', undefined, 'JE-JP4'),
    ).rejects.toThrow('ไม่พบรายการบัญชีรับชำระที่ตรงกับใบเสร็จ');
    expect(created).toHaveLength(0);
  });

  it('รายการบัญชีนี้มีใบเสร็จแล้ว (webhook ส่งซ้ำ / ลองใหม่ / ออกซ้ำด้วยมือ) → คืนใบเดิม ไม่สร้างใบใหม่', async () => {
    const existing = {
      id: 'r-old',
      receiptNumber: 'RT-202610-00007',
      sourceJournalEntryId: 'je-r',
    };
    const { svc, tx, created } = buildService({ source: receiptSource(), existing });

    const out = await svc.generateReceipt(
      'c1',
      'p1',
      'INSTALLMENT',
      6079,
      3,
      'CASH',
      null,
      'u1',
      undefined,
      'JE-1',
    );

    expect(out).toBe(existing);
    expect(created).toHaveLength(0);
    expect(tx.receipt.findFirst).toHaveBeenCalledWith({
      where: { sourceJournalEntryId: 'je-r', deletedAt: null },
    });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['ONLINE_GATEWAY', 'เงินเข้าทางลิงก์ชำระ'],
    ['CREDIT_BALANCE', 'ใช้เครดิตชำระ'],
  ])(
    'ใบช่องทาง %s (%s) → ส่งข้อความใบเสร็จทาง LINE ทางเดียวกับหน้ารับชำระ เมื่อลูกค้าผูก LINE FINANCE (คำตอบเจ้าของ ถ4)',
    async (paymentMethod) => {
      const { svc, lineOa, tx, created } = buildService({
        source: receiptSource(),
        lineLinked: true,
      });

      await svc.generateReceipt(
        'c1',
        'p1',
        'INSTALLMENT',
        6079,
        3,
        paymentMethod,
        null,
        'u1',
        undefined,
        'JE-1',
      );

      expect(created).toHaveLength(1);
      // Task 22 I-1 (ง) — "ผูก LINE การเงิน" = แถว OTP ที่ยังผูก ไม่ใช่คอลัมน์ lineIdFinance
      expect(tx.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lineLinks: { some: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null } },
          }),
        }),
      );
      expect(tx.customer.findFirst.mock.calls[0][0].where).not.toHaveProperty('lineIdFinance');
      // ส่งต่อให้ LineOaService.sendPaymentReceipt ตัวเดียวกับหน้ารับชำระ — ตัวนั้นส่งทาง OA ของ SHOP
      // เฉพาะลูกค้าที่ผูก LINE SHOP และยินยอม PDPA (กติกาเดิม ไม่แตะ)
      expect(lineOa.sendPaymentReceipt).toHaveBeenCalledTimes(1);
      expect(lineOa.sendPaymentReceipt).toHaveBeenCalledWith(
        'cust-1',
        expect.objectContaining({ paymentMethod, receiptNumber: 'RT-202610-00001' }),
      );
    },
  );

  it('ลูกค้าไม่ได้ผูก LINE FINANCE → ออกใบตามปกติแต่ไม่ส่งข้อความ (กติกาเดิม — ทุกช่องทาง)', async () => {
    const { svc, lineOa, created } = buildService({ source: receiptSource(), lineLinked: false });

    await svc.generateReceipt(
      'c1',
      'p1',
      'INSTALLMENT',
      6079,
      3,
      'CREDIT_BALANCE',
      null,
      'u1',
      undefined,
      'JE-1',
    );

    expect(created).toHaveLength(1);
    expect(lineOa.sendPaymentReceipt).not.toHaveBeenCalled();
  });

  // final review I1: ยกเลิกใบเสร็จ / คืนเงินกลับรายการรับชำระแล้ว (รายการเดิมคง POSTED · ประทับ metadata.reversed) — ออกใบซ้ำด้วย
  // เลขที่รายการนั้นต้องไม่ได้ใบกำกับภาษีที่มีผลให้เงินที่บัญชีกลับไปแล้ว
  it('รายการบัญชีรับชำระถูกกลับรายการแล้ว → ปฏิเสธก่อนออกเลขที่ใบ · ไม่สร้างใบ · ไม่ส่งข้อความ LINE', async () => {
    const { svc, tx, created, numbers, lineOa } = buildService({
      source: receiptSource({
        receiptTax: RECEIPT_TAX,
        reversed: true,
        reversedByEntryNumber: 'JE-202610-00009',
      }),
      lineLinked: true,
    });

    const issued = svc.generateReceipt(
      'c1',
      'p1',
      'INSTALLMENT',
      6079,
      3,
      'CASH',
      null,
      'u1',
      undefined,
      'JE-1',
    );

    await expect(issued).rejects.toBeInstanceOf(BadRequestException);
    await expect(issued).rejects.toThrow('รายการบัญชีรับชำระนี้ถูกกลับรายการแล้ว — ออกใบเสร็จไม่ได้');
    expect(numbers.generateReceiptNumber).not.toHaveBeenCalled();
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(lineOa.sendPaymentReceipt).not.toHaveBeenCalled();
  });

  // final review M1: ทุกรายการที่ PaymentReceiptTemplate ลงตั้งแต่ PR3 มี receiptTax — รายการรับชำระที่ไม่มี (หรือค่าใช้ไม่ได้)
  // ยังออกใบ (พิมพ์แบบเดิม) แต่ต้องมีร่องรอยพร้อมเลขที่ใบและเลขที่รายการ ไม่เงียบ
  it.each([
    ['ไม่มี receiptTax', {}],
    ['receiptTax ผลรวมไม่เท่ายอดรับ', { receiptTax: { ...RECEIPT_TAX, vatAmount: '397.68' } }],
  ])(
    'รายการรับชำระ (tag receipt) %s → log เตือนพร้อมเลขที่ใบและเลขที่รายการ · ยังออกใบโดยไม่เก็บค่า',
    async (_label, extraMeta) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const { svc, created } = buildService({ source: receiptSource(extraMeta) });

        await svc.generateReceipt(
          'c1',
          'p1',
          'INSTALLMENT',
          6079,
          3,
          'CASH',
          null,
          'u1',
          undefined,
          'JE-1',
        );

        expect(created).toHaveLength(1);
        expect(created[0].sourceJournalEntryId).toBe('je-r');
        for (const k of TAX_COLUMNS) expect(created[0][k]).toBeUndefined();
        const messages = warn.mock.calls.map(([m]) => String(m));
        expect(
          messages.filter((m) => m.includes('RT-202610-00001') && m.includes('JE-1')),
        ).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('รายการรับชำระที่มี receiptTax ครบ → ไม่มี log เตือนเรื่องค่าที่ประทับ', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { svc } = buildService({ source: receiptSource() });

      await svc.generateReceipt(
        'c1',
        'p1',
        'INSTALLMENT',
        6079,
        3,
        'CASH',
        null,
        'u1',
        undefined,
        'JE-1',
      );

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });


  // ── PR4ข (ฝ่ายบัญชี 16/10/2569 ข้อ 14 / 23.1 / 23.2): ใบปรับดิว 6a และใบส่วนเกินลิงก์ชำระเก็บค่าที่พิมพ์ ณ ตอนออกใบ ──
  describe('PR4ข — ใบปรับดิว 6a / ใบส่วนเกินลิงก์ชำระ', () => {
    const META_6A = {
      tag: 'reschedule-collect',
      contractId: 'c1',
      paymentId: 'p1',
      variant: '6a',
      rescheduleFee: '1516',
      lateFeeCollected: '50',
      advanceVatPark: '99.18',
    };
    const source6a = (extra: Record<string, unknown> = {}) => ({
      id: 'je-6a',
      status: 'POSTED',
      deletedAt: null,
      metadata: { ...META_6A, ...extra },
    });
    const sourceSurplus = (extra: Record<string, unknown> = {}) => ({
      id: 'je-surplus',
      status: 'POSTED',
      deletedAt: null,
      // รายการส่วนเกินไม่มี paymentId (เงินพักไว้ที่สัญญา ไม่ผูกงวด)
      metadata: {
        tag: 'paysolutions-surplus-advance',
        contractId: 'c1',
        refno: 'REF-1',
        surplus: '500',
        advanceVatPark: '32.71',
        ...extra,
      },
    });

    it('ใบปรับดิว 6a: เก็บ 7 คอลัมน์จาก metadata ของรายการ reschedule-collect (ภาษี = stamp advanceVatPark) + remainingBalance null (ใช้ยอด ณ วันออกใบ)', async () => {
      const { svc, created } = buildService({ source: source6a() });

      await svc.generateReceipt('c1', 'p1', 'RESCHEDULE_FEE', 1566, 4, 'BANK_TRANSFER', 'SLIP-1', 'u1', undefined, 'JE-6A');

      expect(created).toHaveLength(1);
      expect(created[0].sourceJournalEntryId).toBe('je-6a');
      expect(created[0].remainingBalance).toBeNull();
      expect(TAX_COLUMNS.map((k) => [k, money(created[0][k])])).toEqual([
        ['amountBeforeVat', '1416.82'],
        ['vatAmount', '99.18'],
        ['roundingAmount', '0.00'],
        ['lateFeeAmount', '50.00'],
        ['lateFeeWaivedAmount', '0.00'],
        ['advanceAmount', '1516.00'],
        ['advanceVatAmount', '99.18'],
      ]);
    });

    it('ใบปรับดิว 6b (ค่าธรรมเนียมไม่ได้พัก — ไม่มี stamp ภาษี) → ผูกรายการแต่ไม่เก็บค่า (พิมพ์แบบเดิม)', async () => {
      const { svc, created } = buildService({
        source: source6a({ variant: '6b', advanceVatPark: undefined }),
      });

      await svc.generateReceipt('c1', 'p1', 'RESCHEDULE_FEE', 1566, 4, 'CASH', null, 'u1', undefined, 'JE-6B');

      expect(created[0].sourceJournalEntryId).toBe('je-6a');
      for (const k of TAX_COLUMNS) expect(created[0][k]).toBeUndefined();
    });

    it('ใบส่วนเกินลิงก์ชำระ (ADVANCE_SURPLUS · paymentId null): รับรายการ tag paysolutions-surplus-advance ที่ไม่มี paymentId · เก็บ 467.29 / 32.71 / เงินรับล่วงหน้า 500.00', async () => {
      const { svc, created, tx } = buildService({ source: sourceSurplus() });
      const paidAt = new Date('2026-10-13T05:00:00.000Z');

      await svc.generateReceipt('c1', null, 'ADVANCE_SURPLUS', 500, null, 'ONLINE_GATEWAY', 'REF-1', 'u1', paidAt, 'JE-S');

      expect(created).toHaveLength(1);
      expect(created[0].sourceJournalEntryId).toBe('je-surplus');
      expect(created[0].paymentId).toBeNull();
      expect(created[0].installmentNo).toBeNull();
      expect(created[0].paidDate).toEqual(paidAt);
      expect(created[0].remainingBalance).toBeNull();
      expect(TAX_COLUMNS.map((k) => [k, money(created[0][k])])).toEqual([
        ['amountBeforeVat', '467.29'],
        ['vatAmount', '32.71'],
        ['roundingAmount', '0.00'],
        ['lateFeeAmount', '0.00'],
        ['lateFeeWaivedAmount', '0.00'],
        ['advanceAmount', '500.00'],
        ['advanceVatAmount', '32.71'],
      ]);
      // ไม่ใช่ใบค่างวด — ไม่อ่านแถว Payment มาทำ partial seq
      expect(tx.payment.findUnique).not.toHaveBeenCalled();
    });

    it('ใบส่วนเกินที่ส่งเลขที่รายการรับชำระค่างวดมา (tag receipt) → ปฏิเสธก่อนสร้างใบ', async () => {
      const { svc, created } = buildService({ source: receiptSource() });

      await expect(
        svc.generateReceipt('c1', null, 'ADVANCE_SURPLUS', 500, null, 'ONLINE_GATEWAY', 'REF-1', 'u1', undefined, 'JE-1'),
      ).rejects.toThrow('ไม่พบรายการบัญชีรับชำระที่ตรงกับใบเสร็จ');
      expect(created).toHaveLength(0);
    });
  });

  // Managed (owned) payoff receipt: issued inside the same Serializable domain transaction as the JP4 —
  // may link that JP4 so the 16.1/16.2 tax columns are stored, but the owned path stays EARLY_PAYOFF-only.
  describe('ใบปิดยอดในธุรกรรมของสิทธิ์ตำแหน่ง (ownedPayoff)', () => {
    function owned(tx: unknown) {
      const ctx = {
        snapshot: { userId: 'u1', isOwner: false, managed: true, revision: 1, grants: [] },
        scope: { userId: 'u1', company: 'FINANCE', permission: 'payments.create', tuples: [] },
        client: tx,
        scopeReads: false,
        domain: 'parties',
        isolationLevel: 'Serializable',
        effects: { commit: [], rollback: [] },
      } as unknown as DomainAccessExecution;
      return {
        run: <T>(work: () => Promise<T>) => domainAccessExecution.run(ctx, work),
        payoff: { client: tx as Prisma.TransactionClient, financeCompanyId: 'co-fin' },
      };
    }

    it('ownedPayoff + เลขที่รายการ JP4 → ผูกรายการและเก็บค่าที่ประทับ (ไม่ปฏิเสธ)', async () => {
      const { svc, tx, created } = buildService({ source: jp4Source() });
      tx.companyInfo.findFirst.mockResolvedValue({ id: 'co-fin', nameTh: 'FINANCE' });
      const { run, payoff } = owned(tx);

      await run(() =>
        svc.generateReceipt('c1', null, 'EARLY_PAYOFF', 15189.98, null, 'BANK_TRANSFER', null, 'u1', undefined, 'JE-JP4', payoff),
      );

      expect(tx.companyInfo.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'co-fin', companyCode: 'FINANCE' }) }),
      );
      expect(created).toHaveLength(1);
      expect(created[0].sourceJournalEntryId).toBe('je-jp4');
      expect(created[0].vatAmount?.toString()).toBe('1190');
      expect(created[0].discountAmount?.toString()).toBe('3000.02');
    });

    it('ownedPayoff กับใบชนิดอื่น (ส่งเลขที่รายการมาด้วย) → ยังปฏิเสธ ก่อนอ่านรายการบัญชี', async () => {
      const { svc, tx, created } = buildService({ source: receiptSource() });
      const { run, payoff } = owned(tx);

      await expect(
        run(() => svc.generateReceipt('c1', 'p1', 'INSTALLMENT', 6079, 3, 'CASH', null, 'u1', undefined, 'JE-1', payoff)),
      ).rejects.toThrow('ไม่มีขอบเขตการออกใบเสร็จปิดสัญญา');
      expect(tx.journalEntry.findUnique).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });
  });
});
