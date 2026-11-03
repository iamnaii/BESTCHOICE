import { Prisma } from '@prisma/client';
import { PaymentLinkService } from './payment-link.service';

/**
 * Task 39 — ลิงก์ชำระรู้ว่าเงินของมันจ่ายอะไร (`PaymentLink.purpose`) ให้หน้า `/pay/:token` ตัดสินจากข้อมูลแทนการเดาจากยอด ·
 * ผู้เรียกบอกเองเมื่อส่งยอด: `INSTALLMENT` (ยอดคงค้างของงวด — ไม่ส่งยอด หรือส่งยอดของงวดที่ระบุ) · `PAYOFF` (ยอดปิดสัญญา) · `AMOUNT`
 * (ยอดที่ข้อความทวงบอก — ยอดค้างรวมแจ้งล็อก · ยอดนัด)
 */
describe('PaymentLinkService — purpose ของลิงก์', () => {
  const unpaid = {
    id: 'pay-1',
    installmentNo: 1,
    amountDue: new Prisma.Decimal('1515.83'),
    lateFee: new Prisma.Decimal('100.00'),
    amountPaid: new Prisma.Decimal('0'),
    dueDate: new Date('2026-10-01T17:00:00Z'),
  };

  function build(link?: Record<string, unknown>) {
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ct-1',
          contractNumber: 'BC-001',
          payments: [unpaid],
        }),
      },
      paymentLink: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(link ?? null),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      // Task 42 รีวิว I1 — ค่าปรับที่ใบรับชำระก่อนหน้าของงวดลงไปแล้ว (reconstructPriorCleared)
      installmentSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const promptPay = {
      generateQrDataUrl: jest.fn().mockResolvedValue(null),
      getAccountName: jest.fn().mockReturnValue('บริษัท'),
      getMaskedPromptPayId: jest.fn().mockReturnValue('xxx'),
    };
    const service = new PaymentLinkService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      prisma as never,
      promptPay as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it.each([
    ['ระบุงวด ไม่ส่งยอด (ไลน์บอท · ขั้นทวงตามวัน · การ์ดลิงก์อัตโนมัติ · ลิงก์ของพนักงาน)', 1, undefined, 1615.83, 'INSTALLMENT'],
    ['ไม่ระบุงวด ไม่ส่งยอด (งวดค้างแรก — การ์ดลิงก์ของพนักงาน / ลูกค้าขอลิงก์)', undefined, undefined, 1615.83, 'INSTALLMENT'],
    ['ระบุงวด + ยอดคงค้างของงวด (กฎทวงตามเหตุการณ์ที่ข้อความระบุงวด)', 1, { amount: 1615.83, purpose: 'INSTALLMENT' }, 1615.83, 'INSTALLMENT'],
    ['ยอดค้างรวมแจ้งล็อก / ยอดนัด', undefined, { amount: 1000, purpose: 'AMOUNT' }, 1000, 'AMOUNT'],
    ['ยอดปิดสัญญา (POST liff/early-payoff)', undefined, { amount: 15189.98, purpose: 'PAYOFF' }, 15189.98, 'PAYOFF'],
  ] as const)('%s → %s', async (_label, installmentNo, override, amount, purpose) => {
    const { prisma, service } = build();

    const result = await service.createPaymentLink('ct-1', installmentNo, override);

    expect(result.amount).toBe(amount);
    expect(prisma.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      contractId: 'ct-1',
      paymentId: 'pay-1',
      amount,
      purpose,
    });
  });

  it.each(['INSTALLMENT', 'PAYOFF', 'AMOUNT', null])(
    'GET /line-oa/pay/:token ส่ง purpose ของลิงก์ (%s) ให้หน้าเว็บ',
    async (purpose) => {
      const { service } = build({
        id: 'link-1',
        status: 'ACTIVE',
        amount: new Prisma.Decimal('1000.00'),
        purpose,
        expiresAt: new Date(Date.now() + 60_000),
        contract: { id: 'ct-1', contractNumber: 'BC-001', customer: { name: 'สมชาย ใจดี' } },
        payment: unpaid,
      });

      const view = await service.resolvePaymentLink('tok');

      expect(view).toMatchObject({ valid: true, amount: 1000, purpose });
    },
  );

  describe('Task 42 — กฎทวงที่สร้างลิงก์ + วันนัด', () => {
    it('ผู้เรียกบอก sourceEvent / promiseDate → เก็บบนลิงก์', async () => {
      const { prisma, service } = build();
      const promiseDate = new Date('2026-11-04T17:00:00.000Z');

      await service.createPaymentLink('ct-1', undefined, {
        amount: 1000,
        purpose: 'AMOUNT',
        sourceEvent: 'CALL_ANSWERED_PROMISE',
        promiseDate,
      });

      expect(prisma.paymentLink.create.mock.calls[0][0].data).toMatchObject({
        purpose: 'AMOUNT',
        sourceEvent: 'CALL_ANSWERED_PROMISE',
        promiseDate,
      });
    });

    it('ไม่บอก → null (ลิงก์งวด · ลิงก์ปิดยอด · ลิงก์ของพนักงาน)', async () => {
      const { prisma, service } = build();

      await service.createPaymentLink('ct-1', 1);

      expect(prisma.paymentLink.create.mock.calls[0][0].data).toMatchObject({
        sourceEvent: null,
        promiseDate: null,
      });
    });
  });

  describe('GET /line-oa/pay/:token — หัวยอด · วันนัด · แถว "นำไปชำระ (งวดเก่าก่อน)" (Task 42)', () => {
    const dec = (v: string) => new Prisma.Decimal(v);
    const installment = (installmentNo: number, amountPaid: string, lateFee: string) => ({
      id: `pay-${installmentNo}`,
      installmentNo,
      amountDue: dec('1515.83'),
      amountPaid: dec(amountPaid),
      lateFee: dec(lateFee),
      lateFeeWaived: false,
      dueDate: new Date('2026-10-01T17:00:00Z'),
    });
    const linkRow = (fields: Record<string, unknown>) => ({
      id: 'link-1',
      status: 'ACTIVE',
      amount: dec('1000.00'),
      purpose: 'AMOUNT',
      sourceEvent: null,
      promiseDate: null,
      expiresAt: new Date(Date.now() + 60_000),
      // สัญญา 17,000 / 12 งวด (ค่างวดตามบัญชี 1,515.83)
      contract: {
        id: 'ct-1',
        contractNumber: 'BC-001',
        customer: { name: 'สมชาย ใจดี' },
        financedAmount: dec('10000.00'),
        storeCommission: dec('1000.00'),
        interestTotal: dec('6000.00'),
        vatAmount: dec('1190.00'),
        totalMonths: 12,
      },
      payment: unpaid,
      ...fields,
    });

    it.each([
      ['INSTALLMENT', 'CALL_NO_ANSWER', 'DUE'],
      ['PAYOFF', null, 'PAYOFF'],
      ['AMOUNT', 'DEVICE_LOCKED', 'OUTSTANDING'],
      ['AMOUNT', 'CALL_ANSWERED_PROMISE', 'PROMISE'],
      ['AMOUNT', null, 'DUE'],
      [null, null, 'DUE'],
    ])('purpose %s · กฎ %s → หัวยอด %s', async (purpose, sourceEvent, amountKind) => {
      const { service } = build(linkRow({ purpose, sourceEvent }));

      await expect(service.resolvePaymentLink('tok')).resolves.toMatchObject({ amountKind });
    });

    it('ลิงก์แจ้งล็อก → แถวนำไปชำระ = การกระจายของ webhook จากงวดค้าง ณ ตอนนี้ (query เดียวกับ webhook)', async () => {
      const { prisma, service } = build(
        linkRow({ amount: dec('2231.66'), sourceEvent: 'DEVICE_LOCKED' }),
      );
      prisma.payment.findMany.mockResolvedValue([
        installment(2, '900.00', '100.00'),
        installment(3, '0', '0'),
      ]);

      const view = await service.resolvePaymentLink('tok');

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: { contractId: 'ct-1', status: { not: 'PAID' }, deletedAt: null },
        orderBy: { installmentNo: 'asc' },
      });
      expect(view).toMatchObject({
        amountKind: 'OUTSTANDING',
        promiseDate: null,
        allocation: [
          { kind: 'INSTALLMENT_REMAINING', installmentNo: 2, amount: 615.83 },
          { kind: 'LATE_FEE', installmentNo: 2, amount: 100 },
          { kind: 'INSTALLMENT', installmentNo: 3, amount: 1515.83 },
        ],
      });
    });

    it('ลิงก์ยอดนัด → วันนัด + งวดที่เงินไม่พอปิด (ชำระบางส่วน / ยังค้างหลังชำระ)', async () => {
      const promiseDate = new Date('2026-11-04T17:00:00.000Z');
      const { prisma, service } = build(
        linkRow({ sourceEvent: 'CALL_ANSWERED_PROMISE', promiseDate }),
      );
      prisma.payment.findMany.mockResolvedValue([installment(2, '0', '100.00'), installment(3, '0', '0')]);

      const view = await service.resolvePaymentLink('tok');

      expect(view).toMatchObject({
        amountKind: 'PROMISE',
        promiseDate,
        allocation: [
          { kind: 'PARTIAL', installmentNo: 2, amount: 1000 },
          { kind: 'LEFT_AFTER', installmentNo: 2, amount: 615.83 },
        ],
      });
    });

    it('รีวิว I1 — งวดที่จ่ายที่สาขามาแล้วและใบนั้นลงค่าปรับไปแล้ว → แถวค่างวดอย่างเดียว (ค่าปรับก่อน ตามบัญชี — ไม่บอกว่าจ่ายค่าปรับซ้ำ)', async () => {
      const { prisma, service } = build(
        linkRow({ amount: dec('2331.66'), sourceEvent: 'DEVICE_LOCKED' }),
      );
      // งวด 2 จ่ายที่สาขา 900 (ใบนั้น Cr 42-1103 100 / Cr 11-2103 800) · งวด 3 ยังไม่เคยจ่าย
      prisma.payment.findMany.mockResolvedValue([
        installment(2, '900.00', '100.00'),
        installment(3, '0', '100.00'),
      ]);
      prisma.installmentSchedule.findMany.mockResolvedValue([{ id: 'sched-2', installmentNo: 2 }]);
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          metadata: { tag: 'receipt', installmentScheduleId: 'sched-2' },
          lines: [
            { accountCode: '11-1101', debit: dec('900.00'), credit: dec('0') },
            { accountCode: '42-1103', debit: dec('0'), credit: dec('100.00') },
            { accountCode: '11-2103', debit: dec('0'), credit: dec('800.00') },
          ],
        },
      ]);

      const view = await service.resolvePaymentLink('tok');

      expect(view).toMatchObject({
        allocation: [
          { kind: 'INSTALLMENT_REMAINING', installmentNo: 2, amount: 715.83 },
          { kind: 'INSTALLMENT', installmentNo: 3, amount: 1515.83 },
          { kind: 'LATE_FEE', installmentNo: 3, amount: 100 },
        ],
      });
      // อ่านบัญชีเฉพาะงวดที่เงินปิด มีค่าปรับ และเคยจ่ายบางส่วน (งวด 3 ยังไม่เคยจ่าย — ไม่มีใบให้อ่าน)
      expect(prisma.installmentSchedule.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.installmentSchedule.findMany.mock.calls[0][0].where).toMatchObject({
        contractId: 'ct-1',
        installmentNo: { in: [2] },
        deletedAt: null,
      });
      expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1);
    });

    it('ไม่มีงวดที่ต้องอ่านบัญชี → ไม่อ่านตารางงวด/รายการบัญชี', async () => {
      const { prisma, service } = build(linkRow({ sourceEvent: 'DEVICE_LOCKED' }));
      prisma.payment.findMany.mockResolvedValue([installment(2, '0', '0')]);

      await service.resolvePaymentLink('tok');

      expect(prisma.installmentSchedule.findMany).not.toHaveBeenCalled();
      expect(prisma.journalEntry.findMany).not.toHaveBeenCalled();
    });

    it.each(['INSTALLMENT', 'PAYOFF', null])(
      'ลิงก์ %s → ไม่มีแถวนำไปชำระ (การ์ดเดิม) · ไม่อ่านงวด',
      async (purpose) => {
        const { prisma, service } = build(linkRow({ purpose }));

        const view = await service.resolvePaymentLink('tok');

        expect(view).toMatchObject({ allocation: null });
        expect(prisma.payment.findMany).not.toHaveBeenCalled();
      },
    );

    it('ไม่ส่งข้อมูลส่วนตัวเพิ่ม — ช่องใหม่มีแค่หัวยอด · วันนัด · แถวนำไปชำระ (เลขงวด + ยอด)', async () => {
      const { prisma, service } = build(linkRow({ sourceEvent: 'DEVICE_LOCKED' }));
      prisma.payment.findMany.mockResolvedValue([installment(2, '0', '0')]);

      const view = (await service.resolvePaymentLink('tok')) as Record<string, unknown>;

      expect(Object.keys(view).sort()).toEqual(
        [
          'allocation',
          'amount',
          'amountKind',
          'contract',
          'expiresAt',
          'payment',
          'promiseDate',
          'promptPay',
          'purpose',
          'status',
          'token',
          'valid',
        ].sort(),
      );
      for (const line of view.allocation as Record<string, unknown>[]) {
        expect(Object.keys(line).sort()).toEqual(['amount', 'installmentNo', 'kind']);
      }
    });
  });
});
