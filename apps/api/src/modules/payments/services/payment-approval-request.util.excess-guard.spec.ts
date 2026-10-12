import { paymentApprovalSnapshot } from './payment-approval-request.util';
import {
  ADVANCE_EXCESS_INCOME_FLOW,
  ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
} from '../../journal/advance-excess-income.util';

/**
 * ด่าน ต6ข ซ้ำที่จุดสร้างคำขอยกเลิกใบเสร็จ (PR4): คำขอ VOID_RECEIPT ของสัญญาที่ลงรายได้เงินพักส่วนเกินแล้ว
 * ต้องถูกปฏิเสธตั้งแต่ตอนส่งคำขอ ไม่ใช่เข้าคิวแล้วไปตกตอนอนุมัติ.
 */
describe('paymentApprovalSnapshot — ด่าน ต6ข ที่จุดสร้างคำขอ VOID_RECEIPT', () => {
  const setup = (entries: Array<Record<string, unknown>>) => ({
    receipt: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'rcpt-1', contractId: 'contract-1', isVoided: false }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    journalEntry: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          entries.map((metadata, i) => ({ id: `je-${i}`, entryNumber: `JE-${i}`, metadata })),
        ),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CT-0001',
        branchId: 'br-1',
        status: 'ACTIVE',
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        advanceBalance: 0,
        creditBalance: 0,
        rescheduleAdvanceBalance: 0,
      }),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
  });

  it('สัญญามีรายการ advance-excess-income ที่มีผล → ปฏิเสธด้วยข้อความ ต6ข', async () => {
    const tx = setup([{ flow: ADVANCE_EXCESS_INCOME_FLOW }]);
    await expect(paymentApprovalSnapshot(tx as never, 'VOID_RECEIPT', 'rcpt-1')).rejects.toThrow(
      ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
    );
    expect(tx.journalEntry.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      metadata: { path: ['flow'], equals: ADVANCE_EXCESS_INCOME_FLOW },
    });
  });

  it('รายการถูกกลับแล้ว / ไม่มี → คำขอสร้างได้ตามเดิม', async () => {
    const tx = setup([{ flow: ADVANCE_EXCESS_INCOME_FLOW, reversed: true }]);
    const out = await paymentApprovalSnapshot(tx as never, 'VOID_RECEIPT', 'rcpt-1');
    expect(out.contract.id).toBe('contract-1');
  });

  it('คำขอชนิดอื่น (WAIVE_LATE_FEE) ไม่ผ่านด่านนี้', async () => {
    const tx = setup([{ flow: ADVANCE_EXCESS_INCOME_FLOW }]);
    (tx.payment as { findFirst?: jest.Mock }).findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'pay-1', contractId: 'contract-1' });
    await expect(
      paymentApprovalSnapshot(tx as never, 'WAIVE_LATE_FEE', 'pay-1'),
    ).resolves.toBeDefined();
    expect(tx.journalEntry.findMany).not.toHaveBeenCalled();
  });
});
