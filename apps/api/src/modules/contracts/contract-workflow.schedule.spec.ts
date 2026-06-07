import { Prisma } from '@prisma/client';
import { ContractWorkflowService } from './contract-workflow.service';

/**
 * Characterization tests for ContractWorkflowService.generateInstallmentSchedules
 * (Wave 3 backfill + review finding #9).
 *
 * The method now runs INSIDE the activation $transaction (it takes `tx` and is
 * awaited at the call site) so a failure rolls the whole activation back instead
 * of leaving an ACTIVE contract with no schedule rows. These tests:
 *   - lock the per-installment money math (principal ROUND_DOWN, interest
 *     ROUND_HALF_UP — matches the CPA golden 17000/12 = 1416.66, 1190/12 = 99.17),
 *   - prove it writes via the passed `tx` (not this.prisma),
 *   - cover the idempotency skip and the totalMonths<=0 guard.
 *
 * It's a private method that only touches `tx`, so the service is built with stub
 * deps and the method is invoked via a typed accessor.
 */

const stub = {} as never;
const service = new ContractWorkflowService(stub, stub, stub, stub, stub, stub);

type Rows = Prisma.InstallmentScheduleCreateManyInput[];

const makeTx = (existing: number, contract: unknown) => {
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
    installmentSchedule: {
      count: jest.fn().mockResolvedValue(existing),
      createMany,
    },
  };
  return { tx, createMany };
};

const gen = (contract: { id: string; contractNumber: string }, tx: unknown) =>
  (service as unknown as {
    generateInstallmentSchedules: (c: typeof contract, t: unknown) => Promise<void>;
  }).generateInstallmentSchedules(contract, tx);

describe('ContractWorkflowService.generateInstallmentSchedules', () => {
  it('writes 12 rows with CPA rounding via the passed tx', async () => {
    const contract = {
      id: 'c1',
      contractNumber: 'CT-001',
      totalMonths: 12,
      financedAmount: new Prisma.Decimal('17000'),
      interestTotal: new Prisma.Decimal('1190'),
      monthlyPayment: new Prisma.Decimal('1515.83'),
      createdAt: new Date(2026, 0, 15), // 15 Jan 2026
      paymentDueDay: 5,
    };
    const { tx, createMany } = makeTx(0, contract);

    await gen({ id: 'c1', contractNumber: 'CT-001' }, tx);

    expect(createMany).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls[0][0].data as Rows;
    expect(rows).toHaveLength(12);

    const first = rows[0];
    expect(first.installmentNo).toBe(1);
    expect(first.contractId).toBe('c1');
    expect((first.principal as Prisma.Decimal).toFixed(2)).toBe('1416.66'); // 17000/12 ROUND_DOWN
    expect((first.interest as Prisma.Decimal).toFixed(2)).toBe('99.17'); // 1190/12 ROUND_HALF_UP
    expect((first.amountDue as Prisma.Decimal).toFixed(2)).toBe('1515.83'); // = monthlyPayment

    // due dates: startDate (createdAt) month + i, on paymentDueDay
    const d1 = first.dueDate as Date;
    expect([d1.getFullYear(), d1.getMonth(), d1.getDate()]).toEqual([2026, 1, 5]); // 5 Feb 2026
    const d12 = rows[11].dueDate as Date;
    expect([d12.getFullYear(), d12.getMonth(), d12.getDate()]).toEqual([2027, 0, 5]); // 5 Jan 2027
  });

  it('is idempotent: skips when schedule rows already exist', async () => {
    const contract = { id: 'c2', contractNumber: 'CT-002', totalMonths: 12 };
    const { tx, createMany } = makeTx(12, contract); // existing > 0
    await gen({ id: 'c2', contractNumber: 'CT-002' }, tx);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does nothing when totalMonths <= 0', async () => {
    const contract = {
      id: 'c3',
      contractNumber: 'CT-003',
      totalMonths: 0,
      financedAmount: new Prisma.Decimal('0'),
      interestTotal: new Prisma.Decimal('0'),
      monthlyPayment: new Prisma.Decimal('0'),
      createdAt: new Date(2026, 0, 15),
      paymentDueDay: 5,
    };
    const { tx, createMany } = makeTx(0, contract);
    await gen({ id: 'c3', contractNumber: 'CT-003' }, tx);
    expect(createMany).not.toHaveBeenCalled();
  });
});
