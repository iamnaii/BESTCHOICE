import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAY_LINK_USED_MESSAGE,
  PaySolutionsIntentService,
} from './services/paysolutions-intent.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 39 — หน้า `/pay/:token` จ่ายลิงก์ที่ไม่ใช่ `INSTALLMENT` (`PAYOFF` ยอดปิด · `AMOUNT` ยอดค้างรวมแจ้งล็อก/ยอดนัด) โดยส่ง
 * `paymentLinkToken` (64 hex) แทนเลขงวด: server ใช้ยอดของลิงก์ที่เก็บไว้ (ยอดจาก client ต้องตรง ±0.01 ไม่งั้นปฏิเสธ) · ลิงก์ต้องเป็นของ
 * สัญญานี้ ยังใช้ได้ (ใช้แล้ว = ข้อความของตัวเอง) · สัญญาไม่มียอดค้างเลย = ปฏิเสธ · ยอดเกินยอดค้างที่เหลือ = ให้จ่าย (webhook พักส่วนเกินเป็น
 * เงินรับล่วงหน้า) · ด่าน #24 (คำขอคืนเงินรอธนาคาร) เฉพาะ `PAYOFF` และทางไม่มีทั้งเลขงวดและ token (LiffEarlyPayoff) ·
 * แถวติดตาม intent ชี้ลิงก์ต้นทาง (webhook ตั้งลิงก์เป็น USED) · คืน id ของแถวติดตาม (UUID) ให้หน้าเว็บ poll สถานะ · ทางเลขงวดไม่เปลี่ยน
 */
describe('PaySolutionsIntentService.createPaymentIntent — ลิงก์ PAYOFF / AMOUNT (paymentLinkToken)', () => {
  const contractId = 'ct-1';
  const lineId = 'U-line-1';
  const token = 'f'.repeat(64);

  const unpaidRows = [
    // งวด 1 ค้าง 1,515.83 + ค่าปรับ 100 · งวด 2 ยังไม่ครบกำหนด
    {
      amountDue: new Prisma.Decimal('1515.83'),
      amountPaid: new Prisma.Decimal('0'),
      lateFee: new Prisma.Decimal('100'),
      lateFeeWaived: false,
    },
    {
      amountDue: new Prisma.Decimal('1515.83'),
      amountPaid: new Prisma.Decimal('0'),
      lateFee: new Prisma.Decimal('0'),
      lateFeeWaived: false,
    },
  ];

  function payLink(overrides: Record<string, unknown> = {}) {
    return {
      id: 'link-1',
      token,
      contractId,
      paymentId: 'pay-1',
      savingPlanId: null,
      amount: new Prisma.Decimal('1000.00'),
      purpose: 'AMOUNT',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
      ...overrides,
    };
  }

  function build(opts: { link?: Record<string, unknown> | null; unpaid?: unknown[]; refunds?: unknown[] } = {}) {
    const tx = {
      payment: { update: jest.fn() },
      paymentLink: { create: jest.fn().mockResolvedValue({ id: 'track-1' }) },
    };
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: contractId,
          customerId: 'cust-1',
          deletedAt: null,
          contractNumber: 'BC-001',
          customer: { name: 'ลูกค้า', phone: null, email: null },
        }),
      },
      customerLineLink: { findFirst: jest.fn().mockResolvedValue({ customerId: 'cust-1' }) },
      refund: { findMany: jest.fn().mockResolvedValue(opts.refunds ?? []) },
      paymentLink: {
        findUnique: jest.fn().mockResolvedValue(opts.link === undefined ? payLink() : opts.link),
      },
      payment: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue(opts.unpaid ?? unpaidRows),
      },
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const gateway = {
      getMerchantId: jest.fn(async () => 'merchant'),
      getTerminalId: jest.fn(async () => 'terminal'),
      createUiPayment: jest.fn(async (_payload: { amount: number }) => ({
        gatewayResponse: {},
        paymentUrl: 'https://gw/pay',
      })),
    };
    const service = new PaySolutionsIntentService(
      gateway as never,
      prisma as never,
      {} as never,
      { get: (_k: string, fallback?: unknown) => fallback } as never,
    );
    return { prisma, tx, gateway, service };
  }

  const pay = (service: PaySolutionsIntentService, amount: number) =>
    service.createPaymentIntent(contractId, amount, 'ชำระค่างวด', lineId, undefined, token);

  it('ยอดตรงลิงก์ → gateway ตัดเงินตามยอดของลิงก์ · แถวติดตาม intent ไม่ผูกงวด ยอดเดียวกัน · ไม่แตะแถวงวด', async () => {
    const { prisma, tx, gateway, service } = build();

    await pay(service, 1000);

    expect(prisma.paymentLink.findUnique).toHaveBeenCalledWith({ where: { token } });
    expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 1000 });
    expect(tx.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      contractId,
      paymentId: null,
      amount: 1000,
      purpose: 'AMOUNT',
      sourceLinkId: 'link-1',
    });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it('คืน id ของแถวติดตาม (UUID — หน้า /pay/:token poll สถานะได้ · เดิมคืนเลขอ้างอิง 12 หลักที่ endpoint สถานะตอบ 400)', async () => {
    const { service } = build();

    await expect(pay(service, 1000)).resolves.toMatchObject({ paymentId: 'track-1' });
  });

  it('ยอดที่ client ส่งต่างจากลิงก์เกิน 0.01 → 400 "ยอดชำระไม่ตรง" ไม่ถึง gateway', async () => {
    for (const amount of [1, 999.98, 1000.02, 1615.83]) {
      const { gateway, tx, service } = build();
      await expect(pay(service, amount)).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('ยอดชำระไม่ตรง'),
      });
      expect(gateway.createUiPayment).not.toHaveBeenCalled();
      expect(tx.paymentLink.create).not.toHaveBeenCalled();
    }
  });

  it('ยอดต่างไม่เกิน 0.01 (เศษทศนิยมของ client) → ผ่าน · gateway ได้ยอดของลิงก์ ไม่ใช่ยอดของ client', async () => {
    const { gateway, service } = build();

    await pay(service, 1000.01);

    expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 1000 });
  });

  it.each([
    ['ไม่พบลิงก์', null],
    ['ลิงก์ของสัญญาอื่น', payLink({ contractId: 'ct-other' })],
    ['ลิงก์ INSTALLMENT (ต้องส่งเลขงวด)', payLink({ purpose: 'INSTALLMENT' })],
    ['แถวเก่าที่ไม่มี purpose', payLink({ purpose: null })],
    ['ลิงก์ถูกลบ', payLink({ deletedAt: new Date() })],
    ['ลิงก์ออมเงิน', payLink({ savingPlanId: 'sp-1' })],
  ])('%s → 400 "ลิงก์ชำระเงินไม่ถูกต้อง" ไม่ถึง gateway', async (_label, link) => {
    const { gateway, service } = build({ link });

    await expect(pay(service, 1000)).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'ลิงก์ชำระเงินไม่ถูกต้อง',
    });
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['แถวติดตาม intent (เลขอ้างอิง 12 หลัก)', '793686721395'],
    ['ไม่ใช่ hex', 'g'.repeat(64)],
    ['ยาวไม่ครบ', 'f'.repeat(63)],
  ])('token ที่ไม่ใช่ลิงก์ /pay/:token (%s) → 400 "ลิงก์ชำระเงินไม่ถูกต้อง" ไม่อ่านแถว', async (_label, badToken) => {
    const { prisma, gateway, service } = build({ link: payLink({ token: badToken }) });

    await expect(
      service.createPaymentIntent(contractId, 1000, 'x', lineId, undefined, badToken),
    ).rejects.toThrow('ลิงก์ชำระเงินไม่ถูกต้อง');
    expect(prisma.paymentLink.findUnique).not.toHaveBeenCalled();
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
  });

  it('ลิงก์ที่ชำระไปแล้ว (USED — webhook ตั้งเมื่อเงินเข้า) → 400 ข้อความ "ชำระแล้ว" ชี้ปุ่ม "กลับไปดูสัญญา" · ไม่ถึง gateway', async () => {
    const { gateway, service } = build({ link: payLink({ status: 'USED' }) });

    await expect(pay(service, 1000)).rejects.toThrow(PAY_LINK_USED_MESSAGE);
    expect(PAY_LINK_USED_MESSAGE).toContain('กลับไปดูสัญญา');
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['หมดอายุ (สถานะ)', payLink({ status: 'EXPIRED' })],
    ['หมดอายุ (เวลา)', payLink({ expiresAt: new Date(Date.now() - 1000) })],
  ])('ลิงก์%s → 400 "ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว"', async (_label, link) => {
    const { gateway, service } = build({ link });

    await expect(pay(service, 1000)).rejects.toThrow('ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว');
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
  });

  it('สัญญาไม่มียอดค้างแล้ว (ทุกงวดชำระครบระหว่างนั้น) → 400 "สัญญานี้ชำระครบแล้ว" — ไม่ให้เงินทั้งก้อนกลายเป็นเงินรับล่วงหน้า', async () => {
    const { prisma, gateway, service } = build({ unpaid: [] });

    await expect(pay(service, 1000)).rejects.toThrow('สัญญานี้ชำระครบแล้ว');
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
    expect(prisma.payment.findMany.mock.calls[0][0].where).toMatchObject({
      contractId,
      status: { not: 'PAID' },
      deletedAt: null,
    });
  });

  it('แถวที่ยังไม่ PAID แต่ไม่มียอดค้างจริง (ค่าปรับยกเว้นแล้ว) → นับเป็นไม่มียอดค้าง', async () => {
    const { service } = build({
      unpaid: [
        {
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('1515.83'),
          lateFee: new Prisma.Decimal('100'),
          lateFeeWaived: true,
        },
      ],
    });

    await expect(pay(service, 1000)).rejects.toThrow('สัญญานี้ชำระครบแล้ว');
  });

  it('ยอดของลิงก์เกินยอดค้างที่เหลือ (ลูกค้าจ่ายบางส่วนไปก่อน) → ให้จ่ายตามยอดของลิงก์ (webhook พักส่วนเกินเป็นเงินรับล่วงหน้า 21-1103)', async () => {
    const { gateway, service } = build({
      link: payLink({ amount: new Prisma.Decimal('1615.83') }),
      unpaid: [
        {
          amountDue: new Prisma.Decimal('1515.83'),
          amountPaid: new Prisma.Decimal('1515.83'),
          lateFee: new Prisma.Decimal('100'),
          lateFeeWaived: false,
        },
      ],
    });

    await pay(service, 1615.83);

    expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 1615.83 });
  });

  describe('#24 คำขอคืนเงินที่อนุมัติแล้วรอธนาคาร — กันเฉพาะการปิดยอด (JP4) ไม่กันการจ่ายยอดค้าง', () => {
    const pendingRefund = [
      { id: 'rf-1', amount: new Prisma.Decimal('500'), payment: { installmentNo: 1 } },
    ];

    it('ลิงก์ AMOUNT (แจ้งล็อก/ยอดนัด) → จ่ายได้ (เหมือนจ่ายที่สาขา/ลิงก์งวด) · ไม่อ่านคำขอคืนเงิน', async () => {
      const { prisma, gateway, service } = build({ refunds: pendingRefund });

      await pay(service, 1000);

      expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 1000 });
      expect(prisma.refund.findMany).not.toHaveBeenCalled();
    });

    it('ลิงก์ PAYOFF (ยอดปิด) → 400 ข้อความลูกค้า ไม่ถึง gateway', async () => {
      const { gateway, service } = build({
        link: payLink({ purpose: 'PAYOFF' }),
        refunds: pendingRefund,
      });

      await expect(pay(service, 1000)).rejects.toThrow('ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้');
      expect(gateway.createUiPayment).not.toHaveBeenCalled();
    });

    it('ลิงก์ PAYOFF ไม่มีคำขอค้าง → จ่ายได้', async () => {
      const { gateway, service } = build({ link: payLink({ purpose: 'PAYOFF' }) });

      await pay(service, 1000);

      expect(gateway.createUiPayment).toHaveBeenCalledTimes(1);
    });

    it('ไม่มีทั้งเลขงวดและ token (LiffEarlyPayoff) → 400 เหมือนเดิม', async () => {
      const { gateway, service } = build({ refunds: pendingRefund });

      await expect(
        service.createPaymentIntent(contractId, 15189.98, 'ปิดยอด', lineId),
      ).rejects.toThrow('ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้');
      expect(gateway.createUiPayment).not.toHaveBeenCalled();
    });

    it('token ใช้ไม่ได้ + มีคำขอค้าง → ข้อความของลิงก์ (ตรวจลิงก์ก่อนด่าน #24)', async () => {
      const { service } = build({ link: null, refunds: pendingRefund });

      await expect(pay(service, 1000)).rejects.toThrow('ลิงก์ชำระเงินไม่ถูกต้อง');
    });
  });

  it('ส่งเลขงวดมาด้วย → ทางผูกงวดเดิม (ไม่อ่านลิงก์ · เทียบยอดกับงวด)', async () => {
    const { prisma, service } = build();
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'OVERDUE',
      amountDue: new Prisma.Decimal('1515.83'),
      lateFee: new Prisma.Decimal('100'),
      amountPaid: new Prisma.Decimal('0'),
    });

    await expect(
      service.createPaymentIntent(contractId, 1000, 'x', lineId, 1, token),
    ).rejects.toThrow('ยอดชำระไม่ตรง');
    expect(prisma.paymentLink.findUnique).not.toHaveBeenCalled();
  });

  it('ไม่ส่งทั้งเลขงวดและ token (หน้าปิดยอด LiffEarlyPayoff) → ทางเดิม ไม่อ่านลิงก์ · แถวติดตาม PAYOFF ไม่มีลิงก์ต้นทาง', async () => {
    const { prisma, tx, gateway, service } = build();

    await expect(
      service.createPaymentIntent(contractId, 15189.98, 'ปิดยอด', lineId),
    ).resolves.toMatchObject({ paymentId: 'track-1' });

    expect(prisma.paymentLink.findUnique).not.toHaveBeenCalled();
    expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 15189.98 });
    expect(tx.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      paymentId: null,
      purpose: 'PAYOFF',
      sourceLinkId: null,
    });
  });

  it('ทางเลขงวด (ลิงก์ INSTALLMENT) → แถวติดตามผูกงวด purpose INSTALLMENT · คืน id ของงวด (เหมือนเดิม)', async () => {
    const { prisma, tx, service } = build();
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'OVERDUE',
      amountDue: new Prisma.Decimal('1515.83'),
      lateFee: new Prisma.Decimal('100'),
      amountPaid: new Prisma.Decimal('0'),
    });

    await expect(
      service.createPaymentIntent(contractId, 1615.83, 'x', lineId, 1),
    ).resolves.toMatchObject({ paymentId: 'pay-1' });
    expect(tx.paymentLink.create.mock.calls[0][0].data).toMatchObject({
      paymentId: 'pay-1',
      purpose: 'INSTALLMENT',
      sourceLinkId: null,
    });
  });
});
