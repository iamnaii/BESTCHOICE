jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaySolutionsWebhookService } from './services/paysolutions-webhook.service';
import { GatewayPayoffMismatchError } from '../contracts/early-payoff-gateway';

/**
 * Task 41 (คำตัดสินเจ้าของ #43) — กลไกของทางปิดยอดใน webhook (mock): JP4 อยู่ใน savepoint ของธุรกรรมที่ claim ลิงก์แล้ว
 * - ลงสำเร็จ → ไม่มี FIFO · งานหลัง commit ของการปิดยอดตามลำดับ · การ์ด "ปิดยอดก่อนกำหนดสำเร็จ" เดิม
 * - ลงไม่ได้ (ด่านใด ๆ) → ROLLBACK TO SAVEPOINT ก่อน FIFO · งาน HIGH + Sentry warning หลัง commit เท่านั้น
 * - serialization failure / deadlock → ทั้ง webhook ล้ม (PaySolutions ส่งซ้ำ) ไม่ถอยเป็น FIFO ในธุรกรรมที่ commit ไม่ได้
 * พฤติกรรมบนฐานจริง (ตัวเลขทอง · ส่งซ้ำ · คำขอคืนเงิน) อยู่ที่ `paysolutions.gateway-payoff.db.spec.ts`
 */
describe('PaySolutionsWebhookService — ทางปิดยอดผ่าน QR (Task 41)', () => {
  const contractId = 'ct-41';
  const refno = '793700000001';
  const snapshot = {
    v: 1,
    totalPayoff: '15189.98',
    discountPct: 50,
    discountAmount: '3000.00',
    unpaidLateFees: '0.00',
    remainingMonths: 12,
    notDueMonths: 12,
    quoteDate: '2026-11-03',
    quotedAt: '2026-11-03T03:00:00.000Z',
  };

  const unpaidRow = (installmentNo: number) => ({
    id: `pay-${installmentNo}`,
    contractId,
    installmentNo,
    amountDue: new Prisma.Decimal('1515.83'),
    amountPaid: new Prisma.Decimal('0'),
    lateFee: new Prisma.Decimal('0'),
    lateFeeWaived: false,
    status: 'PENDING',
  });

  function build(
    opts: {
      earlyPayoff?: jest.Mock;
      tracking?: Record<string, unknown>;
      payoffPort?: boolean;
      /** สถานะสัญญาในธุรกรรม (ก่อนรับเงิน) */
      contractStatus?: string;
      /** แถวงวดที่ยังไม่ PAID (FIFO) */
      unpaid?: ReturnType<typeof unpaidRow>[];
      /** งวดบัญชีของวันที่เงินเข้า (ไม่ส่ง = ไม่มีแถว = เปิด) */
      periodStatus?: string;
      /** บัญชี QR ค่าเริ่มต้นใน PaymentMethodConfig (ไม่ส่ง = ไม่มีค่าตั้ง) */
      qrAccount?: string;
    } = {},
  ) {
    const order: string[] = [];
    const tx = {
      paymentLink: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ status: opts.contractStatus ?? 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({ productId: null }),
      },
      payment: {
        findMany: jest.fn(async () => {
          order.push('fifo');
          return opts.unpaid ?? [unpaidRow(1), unpaidRow(2)];
        }),
        update: jest.fn(async (args: { where: { id: string } }) => ({
          ...unpaidRow(Number(args.where.id.split('-')[1])),
        })),
        count: jest.fn().mockResolvedValue(1),
      },
      installmentSchedule: {
        count: jest.fn().mockResolvedValue(2),
        findUnique: jest.fn(async () => ({ id: 'inst', vat60dayJournalEntryId: null })),
      },
      refund: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() },
      ...(opts.periodStatus
        ? {
            accountingPeriod: { findUnique: jest.fn().mockResolvedValue({ status: opts.periodStatus }) },
            systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
          }
        : {}),
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        order.push(sql);
        return 0;
      }),
    };
    const prisma = {
      // คำตัดสินเจ้าของ #45 — บัญชีรับเงินของ Pay Solutions (`resolvePaySolutionsDepositAccount`) · ไม่มีค่าตั้ง = 11-1201
      paymentMethodConfig: {
        findFirst: jest.fn().mockResolvedValue(opts.qrAccount ? { accountCode: opts.qrAccount } : null),
      },
      partialPaymentLink: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentLink: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'track-41',
          token: refno,
          status: 'ACTIVE',
          contractId,
          paymentId: null,
          savingPlanId: null,
          sourceLinkId: null,
          amount: new Prisma.Decimal('15189.98'),
          purpose: 'PAYOFF',
          payoffQuote: snapshot,
          ...opts.tracking,
        }),
      },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-fin' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-1' }) },
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: contractId, contractNumber: 'CT-41', branchId: 'br-1' }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      todo: {
        upsert: jest.fn(async (_args: { where: unknown; create: Record<string, string> }) =>
          order.push('todo'),
        ),
      },
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
        const result = await cb(tx);
        order.push('commit');
        return result;
      }),
    };
    const host = {
      handlePartialPaymentCallback: jest.fn(),
      confirmSavingPlanPayment: jest.fn(),
      confirmOnlineOrderPayment: jest.fn(),
      sendPaymentSuccessNotification: jest.fn(async () => {
        order.push('notify-payment');
      }),
      sendEarlyPayoffSuccessNotification: jest.fn(async () => {
        order.push('notify-payoff');
      }),
    };
    const earlyPayoff =
      opts.earlyPayoff ??
      jest.fn(
        async (
          _id,
          _user,
          _dto,
          _a,
          _s,
          gatewayMatch: { onCommit: (w: () => Promise<void>) => void },
        ) => {
          order.push('jp4');
          gatewayMatch.onCommit(async () => {
            order.push('payoff-post-commit');
          });
          return { totalPayoff: 15189.98 };
        },
      );
    const payoffPort = {
      earlyPayoff,
      getEarlyPayoffQuote: jest.fn(async () => ({ totalPayoff: 15422.98 })),
    };
    const receiptTemplate = { execute: jest.fn(async () => ({ entryNo: 'JE-R', warnings: [] })) };
    const service = new PaySolutionsWebhookService(
      { getMerchantId: async () => 'M' } as never,
      prisma as never,
      {} as never,
      { transferOwnership: jest.fn() } as never,
      { createAndPost: jest.fn() } as never,
      receiptTemplate as never,
      { execute: jest.fn() } as never,
      { reverseStageOnPayment: jest.fn() } as never,
      host,
      undefined,
      opts.payoffPort === false ? undefined : (payoffPort as never),
    );
    return { service, tx, prisma, host, earlyPayoff, payoffPort, receiptTemplate, order };
  }

  const callback = (total = '15189.98') => ({
    refno,
    result_code: '00',
    transaction_id: 'TX-41',
    total,
  });

  beforeEach(() => jest.clearAllMocks());

  it('ลง JP4 ได้ → savepoint ครอบ · ไม่มี FIFO · งานหลัง commit ของการปิดยอดหลัง commit · การ์ดปิดยอดเดิม · ไม่มีงานแจ้ง', async () => {
    const { service, earlyPayoff, receiptTemplate, host, prisma, order } = build();

    await service.handlePaymentCallback(callback());

    expect(order).toEqual([
      'SAVEPOINT paysolutions_gateway_payoff',
      'jp4',
      'RELEASE SAVEPOINT paysolutions_gateway_payoff',
      'commit',
      'payoff-post-commit',
      'notify-payoff',
    ]);
    const [id, userId, dto, approval, slip, gatewayMatch] = earlyPayoff.mock.calls[0];
    expect([id, userId, approval, slip]).toEqual([contractId, 'owner-1', undefined, undefined]);
    expect(dto).toMatchObject({
      paymentMethod: 'ONLINE_GATEWAY',
      discountPct: 50,
      depositAccountCode: '11-1201', // คำตัดสินเจ้าของ #45 (ไม่มีค่าตั้ง QR = 11-1201)
      referenceNo: 'TX-41',
    });
    expect(gatewayMatch).toMatchObject({
      refno,
      transactionId: 'TX-41',
      paymentLinkId: 'track-41',
    });
    expect(gatewayMatch.paidAmount.toFixed(2)).toBe('15189.98');
    expect(receiptTemplate.execute).not.toHaveBeenCalled();
    expect(host.sendEarlyPayoffSuccessNotification).toHaveBeenCalledWith(
      contractId,
      new Prisma.Decimal('15189.98'),
    );
    expect(host.sendPaymentSuccessNotification).not.toHaveBeenCalled();
    expect(prisma.todo.upsert).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ยอดไม่ตรง → ROLLBACK TO SAVEPOINT ก่อน FIFO · งานแจ้ง + Sentry หลัง commit (ยอดปิด ณ เวลาที่เงินเข้าในข้อความ)', async () => {
    const earlyPayoff = jest.fn(async () => {
      throw new GatewayPayoffMismatchError(15422.98, '15189.98');
    });
    const { service, prisma, host, order } = build({ earlyPayoff });

    await service.handlePaymentCallback(callback());

    expect(order.slice(0, 3)).toEqual([
      'SAVEPOINT paysolutions_gateway_payoff',
      'ROLLBACK TO SAVEPOINT paysolutions_gateway_payoff',
      'fifo',
    ]);
    expect(order.indexOf('todo')).toBeGreaterThan(order.indexOf('commit'));
    const upsert = prisma.todo.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ requestKey: 'paysolutions-payoff-fallback:track-41' });
    expect(upsert.create).toMatchObject({
      priority: 'HIGH',
      tags: ['paysolutions-payoff-fallback'],
      branchId: 'br-1',
    });
    expect(upsert.create.title).toContain('CT-41');
    expect(upsert.create.description).toContain('15,422.98');
    expect(upsert.create.description).toContain('15,189.98 บาท (วันที่ 2026-11-03)');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('QUOTE_MISMATCH'),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({
          action: 'paysolutions-payoff-fallback',
          reason: 'QUOTE_MISMATCH',
        }),
      }),
    );
    expect(host.sendPaymentSuccessNotification).toHaveBeenCalledTimes(1);
    expect(host.sendEarlyPayoffSuccessNotification).not.toHaveBeenCalled();
  });

  it('ด่านอื่นของแกนปิดยอด (เช่น #24) → อ่านสถานะหลังถอย savepoint เพื่อบอกเหตุ · FIFO', async () => {
    const earlyPayoff = jest.fn(async () => {
      throw new BadRequestException('มีคำขอคืนเงินรอธนาคาร');
    });
    const { service, tx, order } = build({ earlyPayoff });
    tx.refund.findMany.mockResolvedValue([
      { id: 'rf', amount: new Prisma.Decimal('1'), payment: { installmentNo: 1 } },
    ]);

    await service.handlePaymentCallback(callback());

    expect(order.slice(0, 5)).toEqual([
      'SAVEPOINT paysolutions_gateway_payoff',
      'ROLLBACK TO SAVEPOINT paysolutions_gateway_payoff',
      'SAVEPOINT paysolutions_gateway_payoff_diag',
      'RELEASE SAVEPOINT paysolutions_gateway_payoff_diag',
      'fifo',
    ]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: expect.objectContaining({ reason: 'REFUND_PENDING' }) }),
    );
  });

  it('error ที่ไม่รู้จัก → JP4_ERROR พร้อมข้อความ error ใน Sentry · FIFO', async () => {
    const earlyPayoff = jest.fn(async () => {
      throw new Error('ledger anomaly');
    });
    const { service } = build({ earlyPayoff });

    await service.handlePaymentCallback(callback());

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ reason: 'JP4_ERROR' }),
        extra: expect.objectContaining({ error: 'ledger anomaly' }),
      }),
    );
  });

  it.each([
    [
      'P2034',
      new Prisma.PrismaClientKnownRequestError('serialization', {
        code: 'P2034',
        clientVersion: 'x',
      }),
    ],
    [
      'P2010 40P01',
      new Prisma.PrismaClientKnownRequestError('deadlock', {
        code: 'P2010',
        clientVersion: 'x',
        meta: { code: '40P01' },
      }),
    ],
  ])(
    'serialization/deadlock (%s) → ทั้ง webhook ล้ม (ส่งซ้ำได้) · ไม่ถอยเป็น FIFO · ไม่มีงานแจ้ง',
    async (_label, error) => {
      const earlyPayoff = jest.fn(async () => {
        throw error;
      });
      const { service, prisma, order } = build({ earlyPayoff });

      await expect(service.handlePaymentCallback(callback())).rejects.toBe(error);
      expect(order).toEqual(['SAVEPOINT paysolutions_gateway_payoff']);
      expect(prisma.todo.upsert).not.toHaveBeenCalled();
    },
  );

  it('P2002 (unique) ไม่ใช่การแข่ง → ถอยเป็น FIFO + งานแจ้ง (ส่งซ้ำก็ได้ผลเดิม — ห้ามทิ้งเงิน)', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { service, prisma, order } = build({
      earlyPayoff: jest.fn(async () => {
        throw error;
      }),
    });

    await service.handlePaymentCallback(callback());

    expect(order).toContain('fifo');
    expect(prisma.todo.upsert).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี snapshot → ไม่เรียกแกนปิดยอด · FIFO + งานแจ้งเหตุ NO_QUOTE_SNAPSHOT', async () => {
    const { service, earlyPayoff, prisma } = build({ tracking: { payoffQuote: null } });

    await service.handlePaymentCallback(callback());

    expect(earlyPayoff).not.toHaveBeenCalled();
    expect(prisma.todo.upsert).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: expect.objectContaining({ reason: 'NO_QUOTE_SNAPSHOT' }) }),
    );
  });

  it('ไม่ได้ต่อแกนปิดยอด (spec/บริบทเก่า) → FIFO + งานแจ้งเหตุ UNAVAILABLE', async () => {
    const { service, prisma } = build({ payoffPort: false });

    await service.handlePaymentCallback(callback());

    expect(prisma.todo.upsert).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: expect.objectContaining({ reason: 'UNAVAILABLE' }) }),
    );
  });

  it('แถวติดตามไม่ใช่การปิดยอด (AMOUNT / INSTALLMENT) → ไม่แตะ savepoint/แกนปิดยอด · FIFO เดิม · ไม่มีงานแจ้ง', async () => {
    for (const purpose of ['AMOUNT', 'INSTALLMENT', null]) {
      const { service, earlyPayoff, tx, prisma } = build({ tracking: { purpose } });
      await service.handlePaymentCallback(callback());
      expect(earlyPayoff).not.toHaveBeenCalled();
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prisma.todo.upsert).not.toHaveBeenCalled();
    }
  });

  it('งานแจ้งสร้างไม่สำเร็จ → ไม่ทำให้ webhook ล้ม (เงินลงแล้ว) · Sentry error + warning ยังส่ง', async () => {
    const { service, prisma } = build({
      earlyPayoff: jest.fn(async () => {
        throw new GatewayPayoffMismatchError(15422.98, '15189.98');
      }),
    });
    prisma.todo.upsert.mockRejectedValue(new Error('todo down'));

    await expect(service.handlePaymentCallback(callback())).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback-todo' }),
      }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback' }),
      }),
    );
  });

  it('เงินที่รับต่างยอดปิดในรายการ 0.01 (ภายในเกณฑ์) → JP4 ลงยอดปิด + Sentry warning หลัง commit', async () => {
    const { service } = build();

    await service.handlePaymentCallback(callback('15189.99'));

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ action: 'paysolutions-payoff-satang-difference' }),
      }),
    );
  });
  describe('Task 41 fix round — งานแจ้งบอกสิ่งที่เกิดกับเงินจริง (รีวิว I-1) · บัญชีรับเงิน (คำตัดสินเจ้าของ #45)', () => {
    const statusError = jest.fn(async () => {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    });

    it('สัญญาปิดแล้ว (EARLY_PAYOFF) ไม่มีงวดค้าง → FIFO ไม่ตัดงวด · ไม่เขียนสถานะทับ/ไม่ย้ายกรรมสิทธิ์ · เงินทั้งก้อนเป็นเงินรับล่วงหน้า · ข้อความ "ต้องคืนลูกค้า" ตามจริง', async () => {
      const { service, tx, prisma } = build({ earlyPayoff: statusError, contractStatus: 'EARLY_PAYOFF', unpaid: [] });
      tx.payment.count.mockResolvedValue(0);

      await service.handlePaymentCallback(callback());

      expect(tx.contract.update.mock.calls.some(([args]) => 'status' in args.data)).toBe(false);
      const create = prisma.todo.upsert.mock.calls[0][0].create;
      expect(create.title).toBe('เงินปิดยอดผ่าน QR เข้าสัญญาที่ปิดยอดไม่ได้ — สัญญา CT-41 รับเงิน 15,189.98 บาท (ต้องคืนลูกค้า)');
      expect(create.description.split('\n')).toEqual([
        'ลูกค้าชำระผ่าน Pay Solutions 15,189.98 บาท (อ้างอิง TX-41) เพื่อปิดยอดก่อนกำหนด แต่สัญญาอยู่ในสถานะ EARLY_PAYOFF ตอนเงินเข้า (เช่น ลูกค้าจ่าย QR ปิดยอดซ้ำ หรือสัญญาปิดไปแล้วทางอื่น) — ระบบลงเป็นปิดยอดไม่ได้',
        'ยอดปิดตอนสร้าง QR: 15,189.98 บาท (วันที่ 2026-11-03) · ยอดปิด ณ เวลาที่เงินเข้า: —',
        'ระบบไม่ได้ตัดงวดใด — เงินทั้งก้อน 15,189.98 บาทพักเป็นเงินรับล่วงหน้า (21-1103) ของสัญญา และออกใบรับเงินส่วนเกิน (ADVANCE_SURPLUS) ให้ลูกค้าแล้ว · สถานะสัญญาคงเดิม (EARLY_PAYOFF)',
        'เงินก้อนนี้ต้องคืนลูกค้า แต่ระบบยังไม่มีทางคืน (คำขอคืนเงินและการยกเลิกใบเสร็จถูกปฏิเสธเมื่อสัญญาปิด · เว็บไม่มีหน้าจอคืนเงิน) — แจ้งฝ่ายบัญชีวันนี้เพื่อโอนคืนลูกค้าและบันทึกบัญชี · รอบกวาดเงินพักส่วนเกินเวลา 00:40 น. คืนนี้จะลงเงินนี้เป็นรายได้ 42-1106 อัตโนมัติ (ทีมระบบกลับรายการได้ด้วยเครื่องมือ advance-excess:reverse)',
      ]);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('refund needed'),
        expect.objectContaining({ tags: expect.objectContaining({ reason: 'CONTRACT_STATUS', outcome: 'ADVANCE_ONLY' }) }),
      );
    });

    it('สัญญาที่รอบกวาดไม่ลงรายได้ (CLOSED_BAD_DEBT) → ข้อความคืนเงินไม่อ้างรอบกวาด · สถานะคงเดิม', async () => {
      const { service, tx, prisma } = build({ earlyPayoff: statusError, contractStatus: 'CLOSED_BAD_DEBT', unpaid: [] });
      tx.payment.count.mockResolvedValue(0);

      await service.handlePaymentCallback(callback());

      expect(tx.contract.update.mock.calls.some(([args]) => 'status' in args.data)).toBe(false);
      const lines = prisma.todo.upsert.mock.calls[0][0].create.description.split('\n');
      expect(lines[2]).toContain('สถานะสัญญาคงเดิม (CLOSED_BAD_DEBT)');
      expect(lines[3]).toBe(
        'เงินก้อนนี้ต้องคืนลูกค้า แต่ระบบยังไม่มีทางคืน (คำขอคืนเงินและการยกเลิกใบเสร็จถูกปฏิเสธเมื่อสัญญาปิด · เว็บไม่มีหน้าจอคืนเงิน) — แจ้งฝ่ายบัญชีวันนี้เพื่อโอนคืนลูกค้าและบันทึกบัญชี',
      );
    });

    it('สัญญายังเปิด (TERMINATED ยังไม่จบ) และ FIFO ตัดครบทุกงวด → ปิดตามเดิม (สถานะ COMPLETED) — ตัวกันเขียนทับเฉพาะสถานะที่จบแล้ว', async () => {
      const { service, tx } = build({ earlyPayoff: statusError, contractStatus: 'TERMINATED', unpaid: [unpaidRow(1)] });
      tx.payment.count.mockResolvedValue(0);

      await service.handlePaymentCallback(callback('1515.83'));

      expect(tx.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('ยอดไม่ตรง → ข้อความ: งวดที่ตัด · ส่วนเกิน · สัญญายังไม่ปิด · ทางไปต่อ = ปุ่ม "ปิดก่อนกำหนด"', async () => {
      const { service, prisma } = build({
        earlyPayoff: jest.fn(async () => {
          throw new GatewayPayoffMismatchError(15422.98, '15189.98');
        }),
        unpaid: [unpaidRow(1), unpaidRow(2), unpaidRow(3)],
      });

      await service.handlePaymentCallback(callback('3100.00'));

      const create = prisma.todo.upsert.mock.calls[0][0].create;
      expect(create.title).toBe('ปิดยอดผ่าน QR ไม่สำเร็จ — สัญญา CT-41 รับเงิน 3,100.00 บาท');
      expect(create.description.split('\n')).toEqual([
        'ลูกค้าชำระผ่าน Pay Solutions 3,100.00 บาท (อ้างอิง TX-41) เพื่อปิดยอดก่อนกำหนด แต่ระบบลงเป็นปิดยอดไม่ได้: ยอดที่ลูกค้าจ่ายไม่ตรงยอดปิด ณ เวลาที่เงินเข้า (เช่น ข้ามวันแล้วมีงวดถึงกำหนด ค่าปรับเพิ่ม หรือมีเงินเข้าทางอื่นระหว่างนั้น)',
        'ยอดปิดตอนสร้าง QR: 15,189.98 บาท (วันที่ 2026-11-03) · ยอดปิด ณ เวลาที่เงินเข้า: 15,422.98 บาท',
        'ระบบลงเงินก้อนนี้เป็นค่างวดตามลำดับงวดแล้ว: งวดที่ 1–3 (ใบเสร็จค่างวดออกตามปกติ) — สัญญายังไม่ปิด',
        'เปิดหน้าสัญญา กดปุ่ม "ปิดก่อนกำหนด" เพื่อดูยอดคงเหลือหลังเงินก้อนนี้ แล้วปิดยอดตามขั้นตอนปกติหลังตรวจกับลูกค้า',
      ]);
    });

    it('คำขอคืนเงินรอธนาคาร (#24) → ทางไปต่อ: บันทึกผลธนาคารก่อน แล้วปิดยอดส่วนที่เหลือ', async () => {
      const { service, tx, prisma } = build({ earlyPayoff: statusError });
      tx.refund.findMany.mockResolvedValue([{ id: 'rf', amount: new Prisma.Decimal('1'), payment: { installmentNo: 1 } }]);

      await service.handlePaymentCallback(callback());

      const lines = prisma.todo.upsert.mock.calls[0][0].create.description.split('\n');
      expect(lines[0]).toContain('สัญญามีคำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้บันทึกผลธนาคาร (คำตัดสินเจ้าของ #24');
      expect(lines[3]).toBe(
        'บันทึกผลธนาคารของคำขอคืนเงินก่อน (ยังไม่มีปุ่มในหน้าจอ — แจ้งฝ่ายบัญชีให้ทีมระบบบันทึก) แล้วเปิดหน้าสัญญา กดปุ่ม "ปิดก่อนกำหนด" เพื่อดูยอดคงเหลือหลังเงินก้อนนี้ แล้วปิดยอดตามขั้นตอนปกติหลังตรวจกับลูกค้า',
      );
    });

    it('งวดบัญชีของวันที่เงินเข้าปิดระหว่างทำรายการ → เหตุ PERIOD_CLOSED + ทางไปต่อของงวดบัญชี', async () => {
      const { service, prisma } = build({ earlyPayoff: statusError, periodStatus: 'SYNCED' });

      await service.handlePaymentCallback(callback());

      const lines = prisma.todo.upsert.mock.calls[0][0].create.description.split('\n');
      expect(lines[0]).toContain('งวดบัญชีของวันที่เงินเข้าถูกปิดระหว่างทำรายการ');
      expect(lines[3]).toBe(
        'แจ้งฝ่ายบัญชีตรวจรายการค่างวดที่ลงในวันที่งวดบัญชีปิด แล้วเปิดหน้าสัญญา กดปุ่ม "ปิดก่อนกำหนด" เพื่อปิดยอดส่วนที่เหลือหลังตรวจกับลูกค้า',
      );
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ tags: expect.objectContaining({ reason: 'PERIOD_CLOSED', outcome: 'FIFO' }) }),
      );
    });

    it('สถานะสัญญาเปลี่ยน (TERMINATED) และ FIFO ตัดงวด → ทางไปต่อ: ฝ่ายบัญชีตรวจกับสถานะสัญญา', async () => {
      const { service, prisma } = build({ earlyPayoff: statusError, contractStatus: 'TERMINATED' });

      await service.handlePaymentCallback(callback('1515.83'));

      const lines = prisma.todo.upsert.mock.calls[0][0].create.description.split('\n');
      expect(lines[2]).toBe('ระบบลงเงินก้อนนี้เป็นค่างวดตามลำดับงวดแล้ว: งวดที่ 1 (ใบเสร็จค่างวดออกตามปกติ) — สัญญายังไม่ปิด');
      expect(lines[3]).toBe('สัญญาอยู่ในสถานะ TERMINATED ซึ่งปิดยอดก่อนกำหนดไม่ได้ — แจ้งฝ่ายบัญชีตรวจเงินก้อนนี้กับสถานะสัญญา');
    });

    it('คำตัดสินเจ้าของ #45 — บัญชี QR ที่ตั้งไว้เป็นบัญชีรับเงินของทั้ง JP4 และใบรับชำระงวด (FIFO) + แถวงวด', async () => {
      const jp4 = build({ qrAccount: '11-1203' });
      await jp4.service.handlePaymentCallback(callback());
      expect(jp4.earlyPayoff.mock.calls[0][2]).toMatchObject({ depositAccountCode: '11-1203' });

      const fifo = build({
        qrAccount: '11-1203',
        earlyPayoff: jest.fn(async () => {
          throw new GatewayPayoffMismatchError(15422.98, '15189.98');
        }),
      });
      await fifo.service.handlePaymentCallback(callback('1515.83'));
      expect(fifo.receiptTemplate.execute).toHaveBeenCalledWith(
        expect.objectContaining({ debitAccountCode: '11-1203' }),
        fifo.tx,
      );
      expect(fifo.tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ depositAccountCode: '11-1203' }) }),
      );
    });
  });
});
