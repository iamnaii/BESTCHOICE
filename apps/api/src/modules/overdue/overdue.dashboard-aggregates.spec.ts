import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { OverdueService } from './overdue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { OverdueKpiService } from './kpi.service';
import { PromiseService } from './promise.service';
import { PaymentsService } from '../payments/payments.service';
import { ContractLetterService } from './contract-letter.service';
import { MdmLockService } from './mdm-lock.service';
import { OwnerAlertHelper } from './owner-alert.helper';
import { ConsecutiveMissedService } from './consecutive-missed.service';

/**
 * Characterization (golden) tests for OverdueService — dashboard/aggregate readers.
 * Wave 3 MED gap-fill. PINS current behaviour of the shipped code; the service source
 * is NOT modified — every surprising behaviour is encoded as the golden value and called
 * out in the file header so a future reader understands it is intentional, not a bug.
 *
 * Methods locked here (overdue.service.ts):
 *
 * getOverdueSummary (~140-173):
 *   - totalOverdueAmount = Decimal(_sum.amountDue) - Decimal(_sum.amountPaid)  (lateFee NOT added)
 *   - totalLateFees = Decimal(_sum.lateFee)
 *   - null `_sum` columns coalesce via `?? 0` -> 0, never NaN
 *   - SALES / BRANCH_MANAGER + userBranchId inject { branchId } into every where; OWNER does not
 *
 * getBoardData per-card outstanding (~1187-1263):
 *   - outstanding = Decimal(amountDue) - amountPaid + lateFee  (lateFee IS added — the
 *     OPPOSITE of getOverdueSummary, which omits it from the headline figure)
 *   - no past-due payment -> outstanding 0 + oldestDueDate null
 *   - contracts bucketed into the lane whose stage === contract.dunningStage
 *
 * getCollectionPipelineStats (~726-766):
 *   - a stage absent from the groupBy result -> count 0 / totalAmount 0
 *   - totalAmount = sum of per-stage _sum.financedAmount (Decimal -> number)
 *   - SALES / BM branch filter (OWNER unfiltered)
 *
 * getOverdueInstallments (~1350-1375):
 *   - remainingAmount = Number(Decimal(amountDue) - amountPaid)
 *   - daysOverdue = max(0, floor((now - dueDate)/86_400_000)) — future dueDate clamps to 0
 *
 * getBrokenPromiseCount (~1382-1393):
 *   - auditLog.count where entity IN ['contract','Contract'] (dual-casing) + action 'BROKEN_PROMISE'
 *
 * computeFifoTargets (private, ~1152-1181):
 *   - reads payment.findMany (status PENDING/OVERDUE/PARTIALLY_PAID, dueDate asc),
 *     remainingAmount = amountDue.sub(amountPaid), then greedy FIFO until acc >= target
 *
 * updateContractStatuses is deliberately OUT OF SCOPE here — its OVERDUE->DEFAULT branch
 * runs in raw `$queryRaw` SQL that a Prisma mock cannot exercise faithfully (see "uncovered").
 *
 * Mock-only — no DB, no real Prisma. PrismaService is a hand-mocked stub exposing only the
 * methods each path touches; every other injected dep is a no-op stub. Money columns are
 * passed as real Prisma.Decimal wherever the code does Decimal ops, and plain numbers where
 * it does Number(). Sibling style: overdue.service.spec.ts + overdue.late-fee-escalation.spec.ts.
 */

// ── Shared no-op stubs for the collaborators these read-paths never drive ─────
const mockDunningEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };
const mockKpiService = { invalidate: jest.fn() };
const mockPromiseService = {
  createPromise: jest.fn().mockResolvedValue({ id: 'promise-1' }),
  findActivePromise: jest.fn().mockResolvedValue(null),
  calcCycleDeadline: jest.fn(),
};
const mockPaymentsService = { autoAllocatePayment: jest.fn() };
const mockLetterService = { createIfNotExists: jest.fn() };
const mockMdmLockService = { proposeManual: jest.fn() };
const mockOwnerAlertHelper = {
  sendToAllOwners: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
};

type PrismaMock = Record<string, unknown>;

/** Build the service against a hand-mocked Prisma + the shared no-op collaborator stubs. */
const buildService = async (prisma: PrismaMock): Promise<OverdueService> => {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      OverdueService,
      { provide: PrismaService, useValue: prisma },
      { provide: DunningEngineService, useValue: mockDunningEngine },
      { provide: OverdueKpiService, useValue: mockKpiService },
      { provide: PromiseService, useValue: mockPromiseService },
      { provide: PaymentsService, useValue: mockPaymentsService },
      { provide: ContractLetterService, useValue: mockLetterService },
      { provide: MdmLockService, useValue: mockMdmLockService },
      { provide: OwnerAlertHelper, useValue: mockOwnerAlertHelper },
      { provide: ConsecutiveMissedService, useValue: { getStreaks: jest.fn().mockResolvedValue(new Map()) } },
    ],
  }).compile();
  return mod.get(OverdueService);
};

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const daysFromNow = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// getOverdueSummary — totalOverdueAmount excludes lateFee; null _sum coalesces to 0
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getOverdueSummary', () => {
  /** aggregateSum is whatever payment.aggregate(..)._sum should resolve to. */
  const makePrisma = (
    aggregateSum: {
      amountDue: Prisma.Decimal | number | null;
      amountPaid: Prisma.Decimal | number | null;
      lateFee: Prisma.Decimal | number | null;
    },
    counts: { overdue: number; default: number } = { overdue: 2, default: 1 },
  ): PrismaMock => ({
    contract: {
      // Promise.all resolves count() twice (OVERDUE then DEFAULT) then aggregate().
      count: jest
        .fn()
        .mockResolvedValueOnce(counts.overdue)
        .mockResolvedValueOnce(counts.default),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: aggregateSum }),
    },
  });

  it('computes totalOverdueAmount = amountDue - amountPaid and totalLateFees = lateFee (lateFee NOT folded into the headline)', async () => {
    const prisma = makePrisma({
      amountDue: new Prisma.Decimal(5000),
      amountPaid: new Prisma.Decimal(1200),
      lateFee: new Prisma.Decimal(350),
    });
    const svc = await buildService(prisma);

    const out = await svc.getOverdueSummary('OWNER');

    // 5000 - 1200 = 3800; lateFee (350) is reported SEPARATELY, not added in.
    expect(out.totalOverdueAmount).toBe(3800);
    expect(out.totalLateFees).toBe(350);
    expect(out.overdueCount).toBe(2);
    expect(out.defaultCount).toBe(1);
  });

  it('coalesces null _sum columns to 0 (never NaN)', async () => {
    const prisma = makePrisma({ amountDue: null, amountPaid: null, lateFee: null });
    const svc = await buildService(prisma);

    const out = await svc.getOverdueSummary('OWNER');

    expect(out.totalOverdueAmount).toBe(0);
    expect(out.totalLateFees).toBe(0);
    expect(Number.isNaN(out.totalOverdueAmount)).toBe(false);
    expect(Number.isNaN(out.totalLateFees)).toBe(false);
  });

  it('SALES + userBranchId injects { branchId } into both counts AND the aggregate where', async () => {
    const prisma = makePrisma({
      amountDue: new Prisma.Decimal(0),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
    });
    const svc = await buildService(prisma);

    await svc.getOverdueSummary('SALES', 'branch-7');

    const countCalls = (prisma.contract as { count: jest.Mock }).count.mock.calls;
    expect(countCalls[0][0].where.branchId).toBe('branch-7');
    expect(countCalls[1][0].where.branchId).toBe('branch-7');
    const aggWhere = (prisma.payment as { aggregate: jest.Mock }).aggregate.mock.calls[0][0].where;
    expect(aggWhere.contract.branchId).toBe('branch-7');
  });

  it('OWNER does NOT inject a branch filter even when a branchId is passed', async () => {
    const prisma = makePrisma({
      amountDue: new Prisma.Decimal(0),
      amountPaid: new Prisma.Decimal(0),
      lateFee: new Prisma.Decimal(0),
    });
    const svc = await buildService(prisma);

    await svc.getOverdueSummary('OWNER', 'branch-7');

    const countWhere = (prisma.contract as { count: jest.Mock }).count.mock.calls[0][0].where;
    expect(countWhere.branchId).toBeUndefined();
    const aggWhere = (prisma.payment as { aggregate: jest.Mock }).aggregate.mock.calls[0][0].where;
    expect(aggWhere.contract.branchId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBoardData — per-card outstanding ADDS lateFee (opposite of getOverdueSummary)
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getBoardData', () => {
  const stageOf = (out: { lanes: { stage: string; contracts: unknown[] }[] }, stage: string) =>
    out.lanes.find((l) => l.stage === stage)!;

  const makePrisma = (contracts: unknown[]): PrismaMock => ({
    contract: { findMany: jest.fn().mockResolvedValue(contracts) },
  });

  it('per-card outstanding = amountDue - amountPaid + lateFee (850 for 1000/200/50)', async () => {
    const prisma = makePrisma([
      {
        id: 'c-1',
        contractNumber: 'BC-001',
        status: 'OVERDUE',
        dunningStage: 'REMINDER',
        dunningEscalatedAt: null,
        lastContactDate: null,
        collectionNotes: null,
        financedAmount: new Prisma.Decimal(20000),
        customer: { id: 'cust-1', name: 'สมชาย', phone: '0800000000' },
        branch: { id: 'b-1', name: 'สาขาลาดพร้าว' },
        assignedTo: null,
        payments: [
          {
            amountDue: new Prisma.Decimal(1000),
            amountPaid: new Prisma.Decimal(200),
            lateFee: new Prisma.Decimal(50),
            dueDate: daysAgo(10),
          },
        ],
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getBoardData('OWNER');

    const reminder = stageOf(out, 'REMINDER');
    expect(reminder.contracts).toHaveLength(1);
    const card = reminder.contracts[0] as { outstanding: number; oldestDueDate: Date | null };
    // lateFee IS added here — contrast with getOverdueSummary which omits it.
    expect(card.outstanding).toBe(850);
    expect(card.oldestDueDate).toBeInstanceOf(Date);
    expect(out.totalContracts).toBe(1);
  });

  it('no past-due payment -> outstanding 0 + oldestDueDate null', async () => {
    const prisma = makePrisma([
      {
        id: 'c-2',
        contractNumber: 'BC-002',
        status: 'DEFAULT',
        dunningStage: 'NOTICE',
        dunningEscalatedAt: null,
        lastContactDate: null,
        collectionNotes: null,
        financedAmount: new Prisma.Decimal(0),
        customer: { id: 'cust-2', name: 'สมหญิง', phone: '0810000000' },
        branch: { id: 'b-1', name: 'สาขาลาดพร้าว' },
        assignedTo: null,
        payments: [], // overduePayment === undefined
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getBoardData('OWNER');

    const card = stageOf(out, 'NOTICE').contracts[0] as {
      outstanding: number;
      oldestDueDate: Date | null;
    };
    expect(card.outstanding).toBe(0);
    expect(card.oldestDueDate).toBeNull();
  });

  it('buckets each contract into the lane matching its dunningStage and leaves the others empty', async () => {
    const prisma = makePrisma([
      {
        id: 'c-legal',
        contractNumber: 'BC-003',
        status: 'DEFAULT',
        dunningStage: 'LEGAL_ACTION',
        dunningEscalatedAt: null,
        lastContactDate: null,
        collectionNotes: null,
        financedAmount: new Prisma.Decimal(0),
        customer: { id: 'cust-3', name: 'ลูกค้า', phone: '0820000000' },
        branch: { id: 'b-1', name: 'สาขา' },
        assignedTo: null,
        payments: [],
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getBoardData('OWNER');

    // All five lanes exist; only LEGAL_ACTION holds the card.
    expect(out.lanes.map((l) => l.stage)).toEqual([
      'NONE',
      'REMINDER',
      'NOTICE',
      'FINAL_WARNING',
      'LEGAL_ACTION',
    ]);
    expect(stageOf(out, 'LEGAL_ACTION').contracts).toHaveLength(1);
    expect(stageOf(out, 'NONE').contracts).toHaveLength(0);
    expect(stageOf(out, 'REMINDER').contracts).toHaveLength(0);
  });

  it('SALES + userBranchId injects { branchId } into the findMany where; OWNER does not', async () => {
    const prismaSales = makePrisma([]);
    const svcSales = await buildService(prismaSales);
    await svcSales.getBoardData('SALES', 'branch-9');
    const salesWhere = (prismaSales.contract as { findMany: jest.Mock }).findMany.mock.calls[0][0]
      .where;
    expect(salesWhere.branchId).toBe('branch-9');

    const prismaOwner = makePrisma([]);
    const svcOwner = await buildService(prismaOwner);
    await svcOwner.getBoardData('OWNER', 'branch-9');
    const ownerWhere = (prismaOwner.contract as { findMany: jest.Mock }).findMany.mock.calls[0][0]
      .where;
    expect(ownerWhere.branchId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCollectionPipelineStats — absent stage -> 0/0; totalAmount = sum of _sum.financedAmount
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getCollectionPipelineStats', () => {
  const stageOf = (
    out: { stages: { stage: string; count: number; totalAmount: number }[] },
    stage: string,
  ) => out.stages.find((s) => s.stage === stage)!;

  const makePrisma = (grouped: unknown[]): PrismaMock => ({
    contract: { groupBy: jest.fn().mockResolvedValue(grouped) },
  });

  it('absent stages collapse to count 0 / totalAmount 0; present stages carry their groupBy sums', async () => {
    const prisma = makePrisma([
      {
        dunningStage: 'REMINDER',
        _count: { _all: 3 },
        _sum: { financedAmount: new Prisma.Decimal(30000) },
      },
      {
        dunningStage: 'LEGAL_ACTION',
        _count: { _all: 1 },
        _sum: { financedAmount: new Prisma.Decimal(12000) },
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getCollectionPipelineStats('OWNER');

    // Stage with no group -> defaulted to 0/0.
    expect(stageOf(out, 'NONE')).toMatchObject({ count: 0, totalAmount: 0 });
    expect(stageOf(out, 'NOTICE')).toMatchObject({ count: 0, totalAmount: 0 });
    expect(stageOf(out, 'FINAL_WARNING')).toMatchObject({ count: 0, totalAmount: 0 });
    // Present stages reflect the group sums.
    expect(stageOf(out, 'REMINDER')).toMatchObject({ count: 3, totalAmount: 30000 });
    expect(stageOf(out, 'LEGAL_ACTION')).toMatchObject({ count: 1, totalAmount: 12000 });

    // Roll-ups sum across the five lanes.
    expect(out.totalContracts).toBe(4); // 3 + 1
    expect(out.totalAmount).toBe(42000); // 30000 + 12000
  });

  it('coalesces a null _sum.financedAmount on a present stage to 0', async () => {
    const prisma = makePrisma([
      { dunningStage: 'NONE', _count: { _all: 2 }, _sum: { financedAmount: null } },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getCollectionPipelineStats('OWNER');

    expect(stageOf(out, 'NONE')).toMatchObject({ count: 2, totalAmount: 0 });
    expect(out.totalContracts).toBe(2);
    expect(out.totalAmount).toBe(0);
  });

  it('SALES + userBranchId injects the branch filter into groupBy; OWNER does not', async () => {
    const prismaSales = makePrisma([]);
    const svcSales = await buildService(prismaSales);
    await svcSales.getCollectionPipelineStats('BRANCH_MANAGER', 'branch-3');
    const salesWhere = (prismaSales.contract as { groupBy: jest.Mock }).groupBy.mock.calls[0][0]
      .where;
    expect(salesWhere.branchId).toBe('branch-3');

    const prismaOwner = makePrisma([]);
    const svcOwner = await buildService(prismaOwner);
    await svcOwner.getCollectionPipelineStats('OWNER', 'branch-3');
    const ownerWhere = (prismaOwner.contract as { groupBy: jest.Mock }).groupBy.mock.calls[0][0]
      .where;
    expect(ownerWhere.branchId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOverdueInstallments — remainingAmount + daysOverdue (clamped at 0 for future dates)
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getOverdueInstallments', () => {
  const makePrisma = (payments: unknown[]): PrismaMock => ({
    payment: { findMany: jest.fn().mockResolvedValue(payments) },
  });

  it('remainingAmount = amountDue - amountPaid (1200 for 1500/300) and daysOverdue counts whole days', async () => {
    const prisma = makePrisma([
      {
        id: 'p-1',
        installmentNo: 3,
        dueDate: daysAgo(10),
        amountDue: new Prisma.Decimal(1500),
        amountPaid: new Prisma.Decimal(300),
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getOverdueInstallments('c-1');

    expect(out).toHaveLength(1);
    expect(out[0].remainingAmount).toBe(1200);
    expect(out[0].installmentNumber).toBe(3);
    // dueDate exactly 10 days ago -> floor(10.xxx?) — daysAgo(10) is exactly 10*86_400_000 ms ago
    // at construction; by the time the service reads Date.now() a few ms have elapsed, so the
    // delta is >= 10 days and floors to 10.
    expect(out[0].daysOverdue).toBe(10);
    expect(typeof out[0].dueDate).toBe('string'); // .toISOString()
  });

  it('clamps daysOverdue to 0 for a future dueDate (Math.max(0, ...))', async () => {
    const prisma = makePrisma([
      {
        id: 'p-2',
        installmentNo: 4,
        dueDate: daysFromNow(5),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(0),
      },
    ]);
    const svc = await buildService(prisma);

    const out = await svc.getOverdueInstallments('c-1');

    expect(out[0].daysOverdue).toBe(0);
    expect(out[0].remainingAmount).toBe(1000);
  });

  it('queries only unpaid installments (PENDING/OVERDUE/PARTIALLY_PAID) ordered by dueDate asc', async () => {
    const prisma = makePrisma([]);
    const svc = await buildService(prisma);

    await svc.getOverdueInstallments('c-1');

    const args = (prisma.payment as { findMany: jest.Mock }).findMany.mock.calls[0][0];
    expect(args.where.status.in).toEqual(['PENDING', 'OVERDUE', 'PARTIALLY_PAID']);
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.contractId).toBe('c-1');
    expect(args.orderBy).toEqual({ dueDate: 'asc' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBrokenPromiseCount — dual-casing entity filter (contract / Contract)
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getBrokenPromiseCount', () => {
  it('counts BROKEN_PROMISE audit rows under BOTH entity casings for the contract', async () => {
    const prisma: PrismaMock = {
      auditLog: { count: jest.fn().mockResolvedValue(4) },
    };
    const svc = await buildService(prisma);

    const out = await svc.getBrokenPromiseCount('c-1');

    expect(out).toBe(4);
    const where = (prisma.auditLog as { count: jest.Mock }).count.mock.calls[0][0].where;
    expect(where.entity.in).toEqual(['contract', 'Contract']);
    expect(where.entityId).toBe('c-1');
    expect(where.action).toBe('BROKEN_PROMISE');
  });

  it('returns 0 when there are no broken-promise audit rows', async () => {
    const prisma: PrismaMock = {
      auditLog: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = await buildService(prisma);

    await expect(svc.getBrokenPromiseCount('c-1')).resolves.toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeFifoTargets (private) — exercised through logContact's PROMISED path
// (which calls it when no targetInstallmentIds are supplied).
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.computeFifoTargets (via logContact PROMISED FIFO allocation)', () => {
  /**
   * computeFifoTargets is private. It is the function logContact invokes to pick which
   * installments a PROMISED amount covers when the caller omits targetInstallmentIds.
   * We drive it through logContact and assert on the targetInstallmentIds handed to
   * promiseService.createPromise — that array IS computeFifoTargets' return value.
   *
   * FIFO greedy (allocateFifo): push oldest first, stop once accumulated remaining >= target.
   * Each payment's remainingAmount = amountDue.sub(amountPaid).
   */
  const setup = async (payments: unknown[]) => {
    const tx: PrismaMock = {
      contract: { update: jest.fn().mockResolvedValue({ id: 'c-1' }) },
    };
    const createPromise = jest.fn().mockResolvedValue({ id: 'promise-fifo' });
    const prisma: PrismaMock = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1', contractNumber: 'BC-001' }),
      },
      auditLog: { count: jest.fn().mockResolvedValue(0) }, // below broken-promise threshold
      payment: { findMany: jest.fn().mockResolvedValue(payments) },
      // interactive form: logContact wraps contract.update + createPromise in $transaction(cb).
      $transaction: jest.fn((cb: (t: PrismaMock) => Promise<unknown>) => cb(tx)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueService,
        { provide: PrismaService, useValue: prisma },
        { provide: DunningEngineService, useValue: mockDunningEngine },
        { provide: OverdueKpiService, useValue: mockKpiService },
        { provide: PromiseService, useValue: { ...mockPromiseService, createPromise } },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: ContractLetterService, useValue: mockLetterService },
        { provide: MdmLockService, useValue: mockMdmLockService },
        { provide: OwnerAlertHelper, useValue: mockOwnerAlertHelper },
        { provide: ConsecutiveMissedService, useValue: { getStreaks: jest.fn().mockResolvedValue(new Map()) } },
      ],
    }).compile();
    const svc = mod.get(OverdueService);
    return { svc, prisma, createPromise };
  };

  it('returns the first 2 installment ids (dueDate order) when the target spans ~1.5 installments', async () => {
    // Two unpaid installments of remaining 1000 each (amountDue 1000, amountPaid 0).
    // Target 1500 spans 1.5 of them: acc after #1 = 1000 (< 1500, keep #2);
    // acc after #2 = 2000 (>= 1500, stop). -> [p-1, p-2]; p-3 never pushed.
    const { svc, createPromise } = await setup([
      {
        id: 'p-1',
        dueDate: daysAgo(30),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(0),
      },
      {
        id: 'p-2',
        dueDate: daysAgo(20),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(0),
      },
      {
        id: 'p-3',
        dueDate: daysAgo(10),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(0),
      },
    ]);

    await svc.logContact('c-1', 'u-1', {
      result: 'PROMISED',
      slots: [{ settlementDate: daysFromNow(3).toISOString(), settlementAmount: 1500 }],
    });

    expect(createPromise).toHaveBeenCalledTimes(1);
    const targetIds = createPromise.mock.calls[0][0].targetInstallmentIds;
    expect(targetIds).toEqual(['p-1', 'p-2']);
  });

  it('remainingAmount nets amountPaid (PARTIALLY_PAID): a 700-remaining first installment is covered by a 600 target', async () => {
    // p-1: amountDue 1000, amountPaid 300 -> remaining 700. Target 600 < 700, so the very
    // first installment already satisfies it: acc starts 0 (< 600) push p-1; acc 700 (>= 600) stop.
    const { svc, createPromise } = await setup([
      {
        id: 'p-1',
        dueDate: daysAgo(15),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(300),
      },
      {
        id: 'p-2',
        dueDate: daysAgo(5),
        amountDue: new Prisma.Decimal(1000),
        amountPaid: new Prisma.Decimal(0),
      },
    ]);

    await svc.logContact('c-1', 'u-1', {
      result: 'PROMISED',
      slots: [{ settlementDate: daysFromNow(2).toISOString(), settlementAmount: 600 }],
    });

    const targetIds = createPromise.mock.calls[0][0].targetInstallmentIds;
    expect(targetIds).toEqual(['p-1']);
  });

  it('reads only PENDING/OVERDUE/PARTIALLY_PAID installments, dueDate asc (the FIFO source query)', async () => {
    const { svc, prisma } = await setup([]);

    // Empty payment set -> allocateFifo returns [] -> createPromise gets targetInstallmentIds: [].
    await svc.logContact('c-1', 'u-1', {
      result: 'PROMISED',
      slots: [{ settlementDate: daysFromNow(2).toISOString(), settlementAmount: 500 }],
    });

    const args = (prisma.payment as { findMany: jest.Mock }).findMany.mock.calls[0][0];
    expect(args.where.status.in).toEqual(['PENDING', 'OVERDUE', 'PARTIALLY_PAID']);
    expect(args.where.contractId).toBe('c-1');
    expect(args.where.deletedAt).toBeNull();
    expect(args.orderBy).toEqual({ dueDate: 'asc' });
  });
});
