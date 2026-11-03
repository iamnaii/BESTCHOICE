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

  function build(opts: { earlyPayoff?: jest.Mock; tracking?: Record<string, unknown>; payoffPort?: boolean } = {}) {
    const order: string[] = [];
    const tx = {
      paymentLink: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({ productId: null }),
      },
      payment: {
        findMany: jest.fn(async () => {
          order.push('fifo');
          return [unpaidRow(1), unpaidRow(2)];
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
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        order.push(sql);
        return 0;
      }),
    };
    const prisma = {
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
        findUnique: jest.fn().mockResolvedValue({ id: contractId, contractNumber: 'CT-41', branchId: 'br-1' }),
      },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
      todo: {
        upsert: jest.fn(async (_args: { where: unknown; create: Record<string, string> }) => order.push('todo')),
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
      jest.fn(async (_id, _user, _dto, _a, _s, gatewayMatch: { onCommit: (w: () => Promise<void>) => void }) => {
        order.push('jp4');
        gatewayMatch.onCommit(async () => {
          order.push('payoff-post-commit');
        });
        return { totalPayoff: 15189.98 };
      });
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

  const callback = (total = '15189.98') => ({ refno, result_code: '00', transaction_id: 'TX-41', total });

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
      depositAccountCode: '11-1202',
      referenceNo: 'TX-41',
    });
    expect(gatewayMatch).toMatchObject({ refno, transactionId: 'TX-41', paymentLinkId: 'track-41' });
    expect(gatewayMatch.paidAmount.toFixed(2)).toBe('15189.98');
    expect(receiptTemplate.execute).not.toHaveBeenCalled();
    expect(host.sendEarlyPayoffSuccessNotification).toHaveBeenCalledWith(contractId, new Prisma.Decimal('15189.98'));
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
    expect(upsert.create).toMatchObject({ priority: 'HIGH', tags: ['paysolutions-payoff-fallback'], branchId: 'br-1' });
    expect(upsert.create.title).toContain('CT-41');
    expect(upsert.create.description).toContain('15,422.98');
    expect(upsert.create.description).toContain('15,189.98 บาท (วันที่ 2026-11-03)');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('QUOTE_MISMATCH'),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback', reason: 'QUOTE_MISMATCH' }),
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
    tx.refund.findMany.mockResolvedValue([{ id: 'rf', amount: new Prisma.Decimal('1'), payment: { installmentNo: 1 } }]);

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
    ['P2034', new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'x' })],
    [
      'P2010 40P01',
      new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2010', clientVersion: 'x', meta: { code: '40P01' } }),
    ],
  ])('serialization/deadlock (%s) → ทั้ง webhook ล้ม (ส่งซ้ำได้) · ไม่ถอยเป็น FIFO · ไม่มีงานแจ้ง', async (_label, error) => {
    const earlyPayoff = jest.fn(async () => {
      throw error;
    });
    const { service, prisma, order } = build({ earlyPayoff });

    await expect(service.handlePaymentCallback(callback())).rejects.toBe(error);
    expect(order).toEqual(['SAVEPOINT paysolutions_gateway_payoff']);
    expect(prisma.todo.upsert).not.toHaveBeenCalled();
  });

  it('P2002 (unique) ไม่ใช่การแข่ง → ถอยเป็น FIFO + งานแจ้ง (ส่งซ้ำก็ได้ผลเดิม — ห้ามทิ้งเงิน)', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
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
      expect.objectContaining({ tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback-todo' }) }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback' }) }),
    );
  });

  it('เงินที่รับต่างยอดปิดในรายการ 0.01 (ภายในเกณฑ์) → JP4 ลงยอดปิด + Sentry warning หลัง commit', async () => {
    const { service } = build();

    await service.handlePaymentCallback(callback('15189.99'));

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: expect.objectContaining({ action: 'paysolutions-payoff-satang-difference' }) }),
    );
  });
});
