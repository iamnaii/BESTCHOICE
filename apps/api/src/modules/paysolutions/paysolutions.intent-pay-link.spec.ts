import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaySolutionsIntentService } from './services/paysolutions-intent.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 39 — หน้า `/pay/:token` จ่ายลิงก์ที่**ไม่ผูกงวด** (ปิดยอด · ยอดค้างรวมแจ้งล็อก · ยอดนัด) โดยส่ง `paymentLinkToken` แทนเลขงวด:
 * server ใช้ยอดของลิงก์ที่เก็บไว้ (ยอดจาก client ต้องตรง ±0.01 ไม่งั้นปฏิเสธ) · ลิงก์ต้องเป็นของสัญญานี้ ยังใช้ได้ และไม่ผูกงวด ·
 * สัญญาไม่มียอดค้างเลย = ปฏิเสธ (แบบเดียวกับงวดที่ชำระแล้วของทางผูกงวด) · ยอดเกินยอดค้างที่เหลือ = ให้จ่าย (webhook พักส่วนเกินเป็นเงินรับล่วงหน้า)
 * · ทางที่ส่งเลขงวด (ลิงก์ผูกงวด) ไม่เปลี่ยน
 */
describe('PaySolutionsIntentService.createPaymentIntent — ลิงก์ไม่ผูกงวด (paymentLinkToken)', () => {
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
      installmentBound: false,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
      ...overrides,
    };
  }

  function build(opts: { link?: Record<string, unknown> | null; unpaid?: unknown[]; refunds?: unknown[] } = {}) {
    const tx = { payment: { update: jest.fn() }, paymentLink: { create: jest.fn() } };
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
    });
    expect(tx.payment.update).not.toHaveBeenCalled();
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
    ['ลิงก์ผูกงวด (ต้องส่งเลขงวด)', payLink({ installmentBound: true })],
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
    ['ใช้แล้ว', payLink({ status: 'USED' })],
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

  it('#24 คำขอคืนเงินที่รอธนาคาร → ข้อความลูกค้า ไม่ถึง gateway (ทางไม่ระบุงวดทุกแบบ)', async () => {
    const { gateway, service } = build({
      refunds: [{ id: 'rf-1', amount: new Prisma.Decimal('500'), payment: { installmentNo: 1 } }],
    });

    await expect(pay(service, 1000)).rejects.toThrow('ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้');
    expect(gateway.createUiPayment).not.toHaveBeenCalled();
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

  it('ไม่ส่งทั้งเลขงวดและ token (หน้าปิดยอด LiffEarlyPayoff) → ทางเดิม ไม่อ่านลิงก์', async () => {
    const { prisma, gateway, service } = build();

    await service.createPaymentIntent(contractId, 15189.98, 'ปิดยอด', lineId);

    expect(prisma.paymentLink.findUnique).not.toHaveBeenCalled();
    expect(gateway.createUiPayment.mock.calls[0][0]).toMatchObject({ amount: 15189.98 });
  });
});
