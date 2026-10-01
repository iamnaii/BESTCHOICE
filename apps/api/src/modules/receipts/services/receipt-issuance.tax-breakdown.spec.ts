import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptIssuanceService } from './receipt-issuance.service';

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

  it('ใบปิดยอดผูกรายการ JP4 ยังไม่ได้ (PR5) → ปฏิเสธเหมือนเดิม ก่อนสร้างใบ', async () => {
    const { svc, created } = buildService({
      source: {
        id: 'je-jp4',
        status: 'POSTED',
        deletedAt: null,
        metadata: { tag: 'JP4', flow: 'early-payoff', contractId: 'c1' },
      },
    });

    await expect(
      svc.generateReceipt(
        'c1',
        null,
        'EARLY_PAYOFF',
        17339.96,
        null,
        'BANK_TRANSFER',
        null,
        'u1',
        undefined,
        'JE-JP4',
      ),
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
      expect(tx.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lineIdFinance: { not: null } }),
        }),
      );
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
});
