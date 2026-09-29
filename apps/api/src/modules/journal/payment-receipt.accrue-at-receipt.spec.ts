import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { PaymentReceiptTemplate } from './cpa-templates/payment-receipt.template';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * จุดเกี่ยว "ตั้งลูกหนี้งวด ณ วันรับเงิน" ใน PaymentReceiptTemplate — เทสแบบ mock.
 * (คำตัดสินฝ่ายบัญชี D2 2026-09-28 · คำตัดสินผู้คุมงาน R1, R9, R12 2026-09-29)
 * สัญญามาตรฐาน 17,000 / 12 งวด → ยอดของงวดในบัญชี (installmentTotal) 1,515.83
 */
describe('PaymentReceiptTemplate — ตั้งลูกหนี้งวดก่อนลงใบรับชำระ', () => {
  const dec = (v: string | number) => new Decimal(v);
  const RECEIPT_DATE = new Date('2026-09-29T03:00:00.000Z');
  const PARTIAL_MESSAGE =
    '[accrue-at-receipt] partial receipt on an installment with no accrual yet — 2A not posted';
  const STATUS_MESSAGE =
    '[accrue-at-receipt] receipt on a contract the accrual does not serve — 2A not posted';

  const contract = {
    id: 'contract-1',
    contractNumber: 'CT-0001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };

  type CapturedJe = { lines: { accountCode: string; dr: Decimal; cr: Decimal }[] };

  function build(opts: {
    accrualJournalEntryId: string | null;
    /** สถานะของแถวสัญญา ณ ตอนที่ template อ่าน (หลังเส้นทางรับชำระแก้ไปแล้ว) */
    contractStatus?: string;
    accrueImpl?: jest.Mock;
    /** ยอด Cr 11-2103 ของใบรับชำระก่อนหน้าของงวดนี้ (reconstructPriorCleared อ่านจาก journalEntry.findMany) */
    priorReceipts?: string[];
  }) {
    const calls: string[] = [];
    const inst = {
      id: 'inst-3',
      installmentNo: 3,
      contractId: contract.id,
      dueDate: new Date('2026-10-11T17:00:00.000Z'),
      accrualJournalEntryId: opts.accrualJournalEntryId,
      contract: { ...contract, status: opts.contractStatus ?? 'ACTIVE' },
    };
    const tx = {
      installmentSchedule: { findUniqueOrThrow: jest.fn().mockResolvedValue(inst) },
      journalEntry: {
        findMany: jest.fn().mockResolvedValue(
          (opts.priorReceipts ?? []).map((credit) => ({
            metadata: { tag: 'receipt', installmentScheduleId: 'inst-3' },
            lines: [{ accountCode: '11-2103', debit: dec(0), credit: dec(credit) }],
          })),
        ),
      },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const createAndPost = jest.fn().mockImplementation(async () => {
      calls.push('receipt');
      return { id: 'je-r', entryNumber: 'JE-202609-00078' };
    });
    const accrueAtReceipt =
      opts.accrueImpl ??
      jest.fn().mockImplementation(async () => {
        calls.push('accrual');
        return { entryNo: 'JE-202609-00077', postedAt: RECEIPT_DATE };
      });
    const rootPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const tpl = new PaymentReceiptTemplate(
      { createAndPost } as never,
      rootPrisma as never,
      undefined,
      { accrueAtReceipt } as never,
    );
    return { tpl, tx, rootPrisma, createAndPost, accrueAtReceipt, calls };
  }

  const receiptLines = (createAndPost: jest.Mock) =>
    (createAndPost.mock.calls[0][0] as CapturedJe).lines.map((l) => [
      l.accountCode,
      l.dr.toFixed(2),
      l.cr.toFixed(2),
    ]);

  const fullReceipt = {
    installmentScheduleId: 'inst-3',
    delta: dec('1515.83'),
    debitAccountCode: '11-1101',
    isFinalReceipt: true,
    paymentId: 'pay-3',
  };

  beforeEach(() => jest.clearAllMocks());

  describe('ใบที่ทำให้งวดชำระครบ', () => {
    it('งวดยังไม่ตั้งลูกหนี้ → ตั้งก่อน (ธุรกรรมเดียวกัน วันที่รับเงิน = postedAt) แล้วจึงลงใบรับชำระ', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost, calls } = build({
        accrualJournalEntryId: null,
      });

      const out = await tpl.execute({ ...fullReceipt, postedAt: RECEIPT_DATE }, tx as never);

      expect(accrueAtReceipt).toHaveBeenCalledTimes(1);
      expect(accrueAtReceipt).toHaveBeenCalledWith('inst-3', RECEIPT_DATE, tx);
      expect(calls).toEqual(['accrual', 'receipt']);
      expect(out.entryNo).toBe('JE-202609-00078');
      expect(out.split.principalCleared.toFixed(2)).toBe('1515.83');
      expect(createAndPost.mock.calls[0][1]).toBe(tx);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง postedAt (auto-allocate / ใช้เครดิต / webhook) → วันที่รับเงิน = ตอนนี้', async () => {
      const { tpl, tx, accrueAtReceipt } = build({ accrualJournalEntryId: null });
      const before = Date.now();

      await tpl.execute(fullReceipt, tx as never);

      const receiptDate = accrueAtReceipt.mock.calls[0][1] as Date;
      expect(receiptDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(receiptDate.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('ใบที่สองจ่ายส่วนที่เหลือของงวดที่เคยรับบางส่วน 1,000.00 → ตั้งตอนใบที่สอง', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost, calls } = build({
        accrualJournalEntryId: null,
        priorReceipts: ['1000.00'],
      });

      await tpl.execute(
        { ...fullReceipt, delta: dec('515.83'), postedAt: RECEIPT_DATE },
        tx as never,
      );

      expect(accrueAtReceipt).toHaveBeenCalledWith('inst-3', RECEIPT_DATE, tx);
      expect(calls).toEqual(['accrual', 'receipt']);
      expect(receiptLines(createAndPost)).toEqual([
        ['11-1101', '515.83', '0.00'],
        ['11-2103', '0.00', '515.83'],
      ]);
    });

    it('ลูกหนี้ในบัญชีถูกล้างครบไปแล้วโดยใบก่อน ๆ และยังไม่มี 2A: ใบ 0.33 ที่ปิดแถวงวด → ตั้ง ลงวันที่ของใบนี้', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost, calls } = build({
        accrualJournalEntryId: null,
        priorReceipts: ['1515.83'],
      });

      await tpl.execute(
        { ...fullReceipt, delta: dec('0.33'), postedAt: RECEIPT_DATE },
        tx as never,
      );

      expect(accrueAtReceipt).toHaveBeenCalledWith('inst-3', RECEIPT_DATE, tx);
      expect(calls).toEqual(['accrual', 'receipt']);
      // ใบนี้ไม่ล้างลูกหนี้เลย — เศษ 0.33 ลงเป็นกำไรจากการปัดเศษ
      expect(receiptLines(createAndPost)).toEqual([
        ['11-1101', '0.33', '0.00'],
        ['53-1503', '0.00', '0.33'],
      ]);
    });

    it('จ่ายขาด 0.83 บาทและมีผู้อนุมัติส่วนต่าง → ตั้ง · ใบรับชำระปิดเศษด้วย 52-1104', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost } = build({ accrualJournalEntryId: null });

      await tpl.execute(
        { ...fullReceipt, delta: dec('1515.00'), toleranceApproverId: 'approver-1' },
        tx as never,
      );

      expect(accrueAtReceipt).toHaveBeenCalledTimes(1);
      expect(receiptLines(createAndPost)).toEqual([
        ['11-1101', '1515.00', '0.00'],
        ['52-1104', '0.83', '0.00'],
        ['11-2103', '0.00', '1515.83'],
      ]);
    });

    it('เงินสด 1,015.83 + หักเงินรับล่วงหน้า 500.00 ในใบเดียวกัน → ตั้ง', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost } = build({ accrualJournalEntryId: null });

      await tpl.execute(
        { ...fullReceipt, delta: dec('1015.83'), advanceConsume: dec('500') },
        tx as never,
      );

      expect(accrueAtReceipt).toHaveBeenCalledTimes(1);
      expect(receiptLines(createAndPost)).toEqual([
        ['11-1101', '1015.83', '0.00'],
        ['21-1103', '500.00', '0.00'],
        ['11-2103', '0.00', '1515.83'],
      ]);
    });

    it('งวดตั้งลูกหนี้แล้ว (รอบกลางคืน หรือใบรับชำระใบก่อน) → ไม่ตั้งซ้ำ', async () => {
      const { tpl, tx, accrueAtReceipt, calls } = build({
        accrualJournalEntryId: 'JE-202609-00001',
      });

      await tpl.execute({ ...fullReceipt, postedAt: RECEIPT_DATE }, tx as never);

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(calls).toEqual(['receipt']);
    });

    it('ไม่มีธุรกรรมของผู้เรียก → ห่อ Serializable เอง ให้ 2A กับใบรับชำระอยู่ในธุรกรรมเดียวกัน', async () => {
      const { tpl, tx, rootPrisma, accrueAtReceipt, createAndPost } = build({
        accrualJournalEntryId: null,
      });

      await tpl.execute({ ...fullReceipt, postedAt: RECEIPT_DATE });

      expect(rootPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(rootPrisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(accrueAtReceipt.mock.calls[0][2]).toBe(tx);
      expect(createAndPost.mock.calls[0][1]).toBe(tx);
    });
  });

  describe('ใบที่ยังไม่ทำให้งวดชำระครบ — พฤติกรรมเดิม + สัญญาณเตือน', () => {
    it('รับบางส่วน 1,000.00 ของงวดที่ยังไม่ตั้งลูกหนี้ → ไม่ตั้ง ลงใบรับชำระเหมือนเดิม และส่งสัญญาณเตือนของตัวเอง', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost, calls } = build({
        accrualJournalEntryId: null,
      });

      const out = await tpl.execute(
        { ...fullReceipt, delta: dec('1000'), isFinalReceipt: false, postedAt: RECEIPT_DATE },
        tx as never,
      );

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(calls).toEqual(['receipt']);
      expect(receiptLines(createAndPost)).toEqual([
        ['11-1101', '1000.00', '0.00'],
        ['11-2103', '0.00', '1000.00'],
      ]);
      expect(out.split.principalRemainingAfter.toFixed(2)).toBe('515.83');
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        PARTIAL_MESSAGE,
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'accrue-at-receipt-skipped-partial' }),
          extra: expect.objectContaining({
            contractId: 'contract-1',
            installmentScheduleId: 'inst-3',
            paymentId: 'pay-3',
            isFinalReceipt: false,
            principalRemainingAfter: '515.83',
          }),
        }),
      );
    });

    it('รับครบยอดในบัญชีแต่ผู้เรียกไม่ได้บอกว่าเป็นใบปิดงวด (แถวงวดยังค้างเศษของยอดเรียกเก็บ) → ไม่ตั้ง', async () => {
      const { tpl, tx, accrueAtReceipt, calls } = build({ accrualJournalEntryId: null });

      const out = await tpl.execute({ ...fullReceipt, isFinalReceipt: false }, tx as never);

      expect(out.split.principalRemainingAfter.toFixed(2)).toBe('0.00');
      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(calls).toEqual(['receipt']);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        PARTIAL_MESSAGE,
        expect.objectContaining({
          extra: expect.objectContaining({
            isFinalReceipt: false,
            principalRemainingAfter: '0.00',
          }),
        }),
      );
    });

    it('ไม่ส่ง isFinalReceipt (เครื่องมือ) → ถือเป็นใบบางส่วน', async () => {
      const { tpl, tx, accrueAtReceipt } = build({ accrualJournalEntryId: null });

      await tpl.execute(
        { installmentScheduleId: 'inst-3', delta: dec('700'), debitAccountCode: '11-1202' },
        tx as never,
      );

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(PARTIAL_MESSAGE, expect.anything());
    });

    it('รับบางส่วนของงวดที่ตั้งลูกหนี้ไปแล้ว → ไม่มีสัญญาณเตือน (ไม่ใช่กรณีที่รอคำตอบ)', async () => {
      const { tpl, tx, accrueAtReceipt } = build({ accrualJournalEntryId: 'JE-202609-00001' });

      await tpl.execute({ ...fullReceipt, delta: dec('1000'), isFinalReceipt: false }, tx as never);

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('ด่านของ template ทำงานก่อนจุดเกี่ยว — ใบที่ถูกปฏิเสธต้องไม่ทิ้ง 2A ไว้', () => {
    it('ใบปิดงวดที่ยังขาดเกิน 1 บาท → ถูกปฏิเสธ ไม่ตั้งลูกหนี้งวด ไม่ลงใบรับชำระ', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost } = build({ accrualJournalEntryId: null });

      await expect(
        tpl.execute({ ...fullReceipt, delta: dec('1000') }, tx as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
    });

    it('ขาดไม่เกิน 1 บาทแต่ไม่มีผู้อนุมัติ → ถูกปฏิเสธ ไม่ตั้งลูกหนี้งวด', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost } = build({ accrualJournalEntryId: null });

      await expect(
        tpl.execute({ ...fullReceipt, delta: dec('1515.00') }, tx as never),
      ).rejects.toThrow('Underpay tolerance requires approver');

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
    });
  });

  describe('error จากการตั้งลูกหนี้งวด', () => {
    it.each(['P2002', 'P2034'])(
      'ชนกับรายการตั้งลูกหนี้งวดอีกรายการ (%s) → error ของฐานข้อมูลผ่านออกไปตามเดิม ไม่ถูกแปลง ไม่ลงใบรับชำระ',
      async (code) => {
        // webhook ของ PaySolutions ใช้ template เดียวกันและอาศัยคำตอบ 5xx เพื่อให้ผู้ให้บริการส่งซ้ำ —
        // template จึงห้ามแปลง error นี้เป็น HTTP 4xx
        const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
          code,
          clientVersion: 'test',
        });
        const { tpl, tx, createAndPost } = build({
          accrualJournalEntryId: null,
          accrueImpl: jest.fn().mockRejectedValue(conflict),
        });

        await expect(
          tpl.execute({ ...fullReceipt, postedAt: RECEIPT_DATE }, tx as never),
        ).rejects.toBe(conflict);
        expect(createAndPost).not.toHaveBeenCalled();
      },
    );

    it('ข้อผิดพลาดอื่น (เช่น งวดบัญชีปิด) ส่งต่อไปตามเดิม ไม่ลงใบรับชำระ', async () => {
      const closed = new Error('ไม่สามารถรับชำระงวด #3 ได้ — งวดบัญชีปิดแล้ว');
      const { tpl, tx, createAndPost } = build({
        accrualJournalEntryId: null,
        accrueImpl: jest.fn().mockRejectedValue(closed),
      });

      await expect(tpl.execute(fullReceipt, tx as never)).rejects.toBe(closed);
      expect(createAndPost).not.toHaveBeenCalled();
    });
  });

  describe('สถานะสัญญาก่อนรับเงิน', () => {
    it('สถานะก่อนรับเงินเป็น TERMINATED → ไม่ตั้งลูกหนี้งวด ลงใบรับชำระตามเดิม และส่งสัญญาณเตือน', async () => {
      const { tpl, tx, accrueAtReceipt, createAndPost } = build({
        accrualJournalEntryId: null,
        contractStatus: 'TERMINATED',
      });

      const out = await tpl.execute(
        { ...fullReceipt, postedAt: RECEIPT_DATE, contractStatusBeforeReceipt: 'TERMINATED' },
        tx as never,
      );

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(createAndPost).toHaveBeenCalledTimes(1);
      expect(out.split.principalCleared.toFixed(2)).toBe('1515.83');
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        STATUS_MESSAGE,
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'accrue-at-receipt-skipped-status' }),
          extra: expect.objectContaining({
            contractId: 'contract-1',
            contractStatus: 'TERMINATED',
            installmentScheduleId: 'inst-3',
          }),
        }),
      );
    });

    it('ผู้เรียกบอกว่าก่อนรับเงินเป็น ACTIVE แม้แถวสัญญาเป็น COMPLETED แล้ว (การรับเงินครั้งนี้ปิดสัญญา) → ยังตั้งลูกหนี้งวด', async () => {
      const { tpl, tx, accrueAtReceipt, calls } = build({
        accrualJournalEntryId: null,
        contractStatus: 'COMPLETED',
      });

      await tpl.execute(
        { ...fullReceipt, postedAt: RECEIPT_DATE, contractStatusBeforeReceipt: 'ACTIVE' },
        tx as never,
      );

      expect(accrueAtReceipt).toHaveBeenCalledWith('inst-3', RECEIPT_DATE, tx);
      expect(calls).toEqual(['accrual', 'receipt']);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('ผู้เรียกไม่ได้ส่งสถานะ (เครื่องมือ / spec) → ตัดสินจากสถานะปัจจุบันของสัญญา', async () => {
      const { tpl, tx, accrueAtReceipt, calls } = build({
        accrualJournalEntryId: null,
        contractStatus: 'CLOSED_BAD_DEBT',
      });

      await tpl.execute({ ...fullReceipt, postedAt: RECEIPT_DATE }, tx as never);

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(calls).toEqual(['receipt']);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(STATUS_MESSAGE, expect.anything());
    });

    it('งวดตั้งลูกหนี้ไปแล้วของสัญญาที่บอกเลิก → ไม่มีอะไรต้องตั้ง จึงไม่ส่งสัญญาณเตือน', async () => {
      const { tpl, tx, accrueAtReceipt } = build({
        accrualJournalEntryId: 'JE-202609-00001',
        contractStatus: 'TERMINATED',
      });

      await tpl.execute(
        { ...fullReceipt, postedAt: RECEIPT_DATE, contractStatusBeforeReceipt: 'TERMINATED' },
        tx as never,
      );

      expect(accrueAtReceipt).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });
});
