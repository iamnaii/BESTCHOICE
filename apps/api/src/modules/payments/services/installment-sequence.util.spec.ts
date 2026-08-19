/**
 * ต้องบันทึกชำระค่างวดตามลำดับงวดเท่านั้น — ห้ามข้ามงวด (owner directive
 * 2026-08-19). The rule is "record only on the contract's EARLIEST unpaid
 * installment", NOT "installmentNo must equal lastPaid + 1":
 *   - a fresh contract records งวด 1 first, then 2, ...
 *   - after a receipt VOID re-opens งวด 2 while 3-6 are already PAID, re-paying
 *     งวด 2 must be ALLOWED (it is the earliest unpaid) — the void flow's
 *     "re-open the wizard on the voided installment" UX depends on it.
 * Gateway-driven recordings (PaySolutions webhook) bypass the guard — the money
 * has already been received; the sequence is enforced at QR-SEND time instead.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertSequentialInstallment } from './installment-sequence.util';

function clientWith(earliestUnpaid: { installmentNo: number } | null) {
  const findFirst = jest.fn().mockResolvedValue(earliestUnpaid);
  return {
    client: { payment: { findFirst } } as unknown as Prisma.TransactionClient,
    findFirst,
  };
}

describe('assertSequentialInstallment', () => {
  it('allows recording when no earlier installment is unpaid', async () => {
    const { client, findFirst } = clientWith(null);
    await expect(assertSequentialInstallment(client, 'contract-1', 3)).resolves.toBeUndefined();
    const where = findFirst.mock.calls[0][0].where;
    expect(where.contractId).toBe('contract-1');
    expect(where.installmentNo).toEqual({ lt: 3 });
    expect(where.deletedAt).toBeNull();
    expect(where.status).toEqual({ in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] });
  });

  it('rejects skipping over an unpaid earlier installment, naming it in Thai', async () => {
    const { client, findFirst } = clientWith({ installmentNo: 2 });
    await expect(assertSequentialInstallment(client, 'contract-1', 3)).rejects.toThrow(
      BadRequestException,
    );
    await expect(assertSequentialInstallment(client, 'contract-1', 3)).rejects.toThrow(
      /งวดที่ 2/,
    );
  });

  it('rejects a PARTIALLY_PAID earlier installment too (must be closed first)', async () => {
    const { client, findFirst } = clientWith({ installmentNo: 4 });
    await expect(assertSequentialInstallment(client, 'contract-1', 5)).rejects.toThrow(
      /ตามลำดับงวด/,
    );
  });

  it('installment 1 short-circuits — no earlier installment can exist', async () => {
    const { client, findFirst } = clientWith({ installmentNo: 0 }); // even a poisoned mock must not matter
    await expect(assertSequentialInstallment(client, 'contract-1', 1)).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('picks the EARLIEST unpaid installment for the error message', async () => {
    const { client, findFirst } = clientWith({ installmentNo: 2 });
    await expect(assertSequentialInstallment(client, 'contract-1', 6)).rejects.toThrow(/งวดที่ 2/);
    const call = findFirst.mock.calls[0][0];
    expect(call.orderBy).toEqual({ installmentNo: 'asc' });
  });
});
