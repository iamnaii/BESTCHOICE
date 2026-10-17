import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { applyExchangeCreditAfterActivation } from './exchange-credit-autoapply';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

const contract = { id: 'ct-new', contractNumber: 'CT-NEW', parentContractId: 'ct-old', creditBalance: new Prisma.Decimal('1515.83') };
const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-1' }) } };

describe('applyExchangeCreditAfterActivation (spec §6)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('สัญญาจากการเปลี่ยนเครื่องที่มีเครดิต → เรียก applyCreditBalance ด้วยผู้ใช้ที่กดเปิดใช้', async () => {
    const applyCreditBalance = jest.fn().mockResolvedValue({ allocatedPayments: [{}], creditUsed: 1515.83, creditRemaining: 0 });
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract, 'mgr-1');
    expect(applyCreditBalance).toHaveBeenCalledWith('ct-new', 'mgr-1');
    expect(out).toEqual({ applied: true, installments: 1, creditUsed: 1515.83, creditRemaining: 0, actorId: 'mgr-1' });
  });

  it('ไม่ส่ง actor → ใช้ admin@bestchoice.com · ไม่มีผู้ใช้ระบบ → NO_ACTOR + Sentry', async () => {
    const applyCreditBalance = jest.fn().mockResolvedValue({ allocatedPayments: [], creditUsed: 0, creditRemaining: 0 });
    await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'admin@bestchoice.com', deletedAt: null }, select: { id: true } });
    expect(applyCreditBalance).toHaveBeenCalledWith('ct-new', 'admin-1');
    const none = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const out = await applyExchangeCreditAfterActivation({ prisma: none as never, payments: { applyCreditBalance } }, contract);
    expect(out).toEqual({ applied: false, reason: 'NO_ACTOR' });
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('ไม่ใช่สัญญาจากการเปลี่ยนเครื่อง / ไม่มีเครดิต → ไม่เรียก', async () => {
    const applyCreditBalance = jest.fn();
    expect(await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, { ...contract, parentContractId: null })).toEqual({ applied: false, reason: 'NOT_EXCHANGE' });
    expect(await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, { ...contract, creditBalance: new Prisma.Decimal(0) })).toEqual({ applied: false, reason: 'NO_CREDIT' });
    expect(applyCreditBalance).not.toHaveBeenCalled();
  });

  it('applyCreditBalance ล้ม → FAILED + Sentry warning action defect-exchange-credit-autoapply-failed · ไม่ throw', async () => {
    const applyCreditBalance = jest.fn().mockRejectedValue(new Error('งวดบัญชีปิด'));
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: { applyCreditBalance } }, contract, 'mgr-1');
    expect(out).toEqual({ applied: false, reason: 'FAILED', message: 'งวดบัญชีปิด' });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      level: 'warning', tags: expect.objectContaining({ action: 'defect-exchange-credit-autoapply-failed' }),
    }));
  });

  it('ไม่มี PaymentsService (ผู้เรียกไม่ได้ฉีด) → NO_PAYMENTS_SERVICE + Sentry', async () => {
    const out = await applyExchangeCreditAfterActivation({ prisma: prisma as never, payments: null }, contract, 'mgr-1');
    expect(out).toEqual({ applied: false, reason: 'NO_PAYMENTS_SERVICE' });
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
