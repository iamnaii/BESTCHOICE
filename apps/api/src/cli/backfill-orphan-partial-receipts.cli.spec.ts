import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PaymentReceiptTemplate } from '../modules/journal/cpa-templates/payment-receipt.template';
import type { DeferredWarning } from '../modules/journal/deferred-warning';
import { backfillOrphanPartialReceipts } from './backfill-orphan-partial-receipts.cli';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
// เครื่องมือสร้าง template เอง (`new PaymentReceiptTemplate(journal, prisma)`) — แทนทั้งโมดูลเพื่อคุมผลของ execute
jest.mock('../modules/journal/journal-auto.service', () => ({ JournalAutoService: jest.fn() }));
jest.mock('../modules/journal/cpa-templates/payment-receipt.template', () => ({
  PaymentReceiptTemplate: jest.fn(),
}));

/**
 * เครื่องมือเติมใบรับชำระที่ตกหล่น (backfill-orphan-partial-receipts) — สัญญาณเตือนที่ template คืนมา
 * (ตั้งลูกหนี้งวด ณ วันรับเงิน — PR2ข B11) ต้องส่งเข้า Sentry หลังธุรกรรมของใบนั้น commit แล้วเท่านั้น:
 * ใบที่ commit ไม่ผ่านถูกนับเป็น failed และต้องไม่ทิ้งสัญญาณของงานที่ไม่ได้เกิดขึ้นจริง.
 */
describe('backfillOrphanPartialReceipts — สัญญาณเตือนส่งหลังธุรกรรม commit เท่านั้น', () => {
  const SKIPPED_STATUS = 'accrue-at-receipt-skipped-status';
  const warning: DeferredWarning = {
    message: '[accrue-at-receipt] receipt on a contract the accrual does not serve — 2A not posted',
    tags: { module: 'journal', action: SKIPPED_STATUS },
    extra: { contractId: 'ct-1', contractStatus: 'TERMINATED', paymentId: 'pay-1' },
  };
  const captureMessage = Sentry.captureMessage as jest.Mock;
  let execute: jest.Mock;

  /** ใบบางส่วนที่ยังไม่มีใบรับชำระ 1 ใบ · `$transaction` = ธุรกรรมต่อใบของเครื่องมือ (แต่ละเทสกำหนดผลเอง) */
  function buildPrisma() {
    const tx = {
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) }, // ยังไม่มีใบรับชำระ
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'pay-1',
          contract_id: 'ct-1',
          installment_no: 1,
          amount_paid: '1000.00',
          deposit_account_code: '11-1201',
          contract_number: 'CT-0001',
        },
      ]),
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-user' }) },
      installmentSchedule: { findFirst: jest.fn().mockResolvedValue({ id: 'inst-1' }) },
      $transaction: jest.fn(),
    };
    return { prisma, tx };
  }

  beforeEach(() => {
    captureMessage.mockClear();
    execute = jest
      .fn()
      .mockResolvedValue({ entryNo: 'JE-202610-00001', split: {}, warnings: [warning] });
    (PaymentReceiptTemplate as unknown as jest.Mock).mockImplementation(() => ({ execute }));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('ใบที่ลงสำเร็จ → ส่งสัญญาณเตือนที่ template คืนมาครั้งเดียว หลังธุรกรรมของใบนั้น commit', async () => {
    const committed = jest.fn();
    const { prisma, tx } = buildPrisma();
    prisma.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => {
      const result = await cb(tx);
      committed();
      return result;
    });

    const result = await backfillOrphanPartialReceipts(prisma as never, { dryRun: false });

    expect(result.backfilled).toBe(1);
    expect(result.failed).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(warning.message, {
      level: 'warning',
      tags: warning.tags,
      extra: warning.extra,
    });
    const commitOrder = committed.mock.invocationCallOrder[0];
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(commitOrder);
    expect(captureMessage.mock.invocationCallOrder[0]).toBeGreaterThan(commitOrder);
  });

  it('commit ไม่ผ่าน (P2034) หลัง template คืนสัญญาณเตือนแล้ว → นับเป็น failed และไม่ส่ง', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      { code: 'P2034', clientVersion: 'test' },
    );
    const { prisma, tx } = buildPrisma();
    prisma.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => {
      await cb(tx);
      throw conflict;
    });

    const result = await backfillOrphanPartialReceipts(prisma as never, { dryRun: false });

    expect(result.failed).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1); // สัญญาณเตือนเกิดแล้วในธุรกรรม
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
