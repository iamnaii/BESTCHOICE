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
 * Characterization (golden) tests for OverdueService.getCycleDeadline (~1327-1348).
 * Wave 3 LOW gap-fill. PINS the current behaviour of the shipped code; the service
 * source is NOT modified — every surprising behaviour is encoded as the golden value
 * and called out below so a future reader understands it is intentional, not a bug.
 *
 * getCycleDeadline(contractId) — the GET /overdue/contracts/:id/cycle-deadline reader:
 *   - active promise is fetched via promiseService.findActivePromise (a CallLog with
 *     `slots` included). The whole method only touches that stub + calcCycleDeadline;
 *     it never reads the DB itself, so the Prisma mock here is an empty object.
 *   - deadline = active?.cycleDeadline (truthy)  ?  active.cycleDeadline
 *                                               :  await calcCycleDeadline(contractId).
 *     The method always calls `deadline.toISOString()`, so BOTH branches must yield a
 *     Date — calcCycleDeadline is stubbed to return a Date (it does in prod too).
 *   - calcCycleDeadline is called with ONLY the contractId (no `now` arg) — pinned via
 *     toHaveBeenCalledWith(contractId).
 *   - activeSlots = active?.slots ?? []  (a CallLog with slots:[] -> [] -> never past due).
 *   - slotsPastDue = activeSlots.some(s => s.settlementDate < new Date()) — TRUE when ANY
 *     slot.settlementDate is strictly before now; FALSE when every slot is in the future
 *     OR there are no slots at all.
 *   - activePromise summary (when active):
 *       id               = active.id
 *       settlementDate   = active.settlementDate?.toISOString() ?? null  (null when absent)
 *       settlementAmount = Number(active.settlementAmount ?? 0)          (Decimal|null -> number, null -> 0)
 *       rescheduleCount  = active.rescheduleCount ?? 0
 *       slotsPastDue     = (as above)
 *   - active === null -> activePromise: null, and deadline falls through to
 *     calcCycleDeadline (since null has no cycleDeadline). slotsPastDue is computed but
 *     never surfaced (no activePromise object).
 *
 * Mock-only — no DB, no real Prisma. PrismaService is an empty stub (this method touches
 * no prisma.* call); promiseService is the only meaningful collaborator. Money columns are
 * passed as real Prisma.Decimal wherever the code does Number()/Decimal ops. Sibling style:
 * overdue.dashboard-aggregates.spec.ts + overdue.late-fee-escalation.spec.ts.
 */

// ── Shared no-op stubs for the collaborators this read-path never drives ──────
const mockDunningEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };
const mockKpiService = { invalidate: jest.fn() };
const mockPromiseService = {
  createPromise: jest.fn().mockResolvedValue({ id: 'promise-1' }),
  findActivePromise: jest.fn(),
  calcCycleDeadline: jest.fn(),
};
const mockPaymentsService = { autoAllocatePayment: jest.fn() };
const mockLetterService = { createIfNotExists: jest.fn() };
const mockMdmLockService = { proposeManual: jest.fn() };
const mockOwnerAlertHelper = {
  sendToAllOwners: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
};

type PrismaMock = Record<string, unknown>;

/** Build the service against an (empty) Prisma stub + the shared no-op collaborator stubs. */
const buildService = async (prisma: PrismaMock = {}): Promise<OverdueService> => {
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
// slotsPastDue — any active slot strictly before now -> true; all future / none -> false
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getCycleDeadline — slotsPastDue', () => {
  it('is TRUE when ANY active slot.settlementDate is before now (even if other slots are future)', async () => {
    const cycleDeadline = daysFromNow(5);
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-1',
      cycleDeadline,
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(1000),
      rescheduleCount: 0,
      slots: [{ settlementDate: daysFromNow(3) }, { settlementDate: daysAgo(1) }],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise?.slotsPastDue).toBe(true);
  });

  it('is FALSE when EVERY active slot.settlementDate is in the future', async () => {
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-2',
      cycleDeadline: daysFromNow(5),
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(1000),
      rescheduleCount: 1,
      slots: [{ settlementDate: daysFromNow(1) }, { settlementDate: daysFromNow(3) }],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise?.slotsPastDue).toBe(false);
  });

  it('is FALSE when the active promise has no slots (empty array -> .some -> false)', async () => {
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-3',
      cycleDeadline: daysFromNow(5),
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(500),
      rescheduleCount: 0,
      slots: [],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise?.slotsPastDue).toBe(false);
  });

  it('is FALSE when `slots` is undefined (?? [] fallback prevents a throw)', async () => {
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-4',
      cycleDeadline: daysFromNow(5),
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(500),
      rescheduleCount: 0,
      // slots intentionally omitted
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise?.slotsPastDue).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cycleDeadline — promise.cycleDeadline wins; falls back to calcCycleDeadline otherwise
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getCycleDeadline — deadline source', () => {
  it('uses promise.cycleDeadline (ISO string) when the active promise carries one — calcCycleDeadline NOT called', async () => {
    const cycleDeadline = new Date('2026-09-30T16:59:59.999Z');
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-5',
      cycleDeadline,
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(1000),
      rescheduleCount: 0,
      slots: [{ settlementDate: daysFromNow(1) }],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.cycleDeadline).toBe(cycleDeadline.toISOString());
    expect(mockPromiseService.calcCycleDeadline).not.toHaveBeenCalled();
  });

  it('falls back to calcCycleDeadline(contractId) when the active promise lacks cycleDeadline', async () => {
    const fallback = new Date('2026-10-31T16:59:59.999Z');
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-6',
      cycleDeadline: null, // falsy -> fallback branch
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(1000),
      rescheduleCount: 0,
      slots: [{ settlementDate: daysFromNow(1) }],
    });
    mockPromiseService.calcCycleDeadline.mockResolvedValue(fallback);
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-99');

    expect(res.cycleDeadline).toBe(fallback.toISOString());
    expect(mockPromiseService.calcCycleDeadline).toHaveBeenCalledTimes(1);
    // Pinned: called with ONLY the contractId — no `now` argument is forwarded.
    expect(mockPromiseService.calcCycleDeadline).toHaveBeenCalledWith('contract-99');
  });

  it('treats an undefined cycleDeadline the same as null — also falls back to calcCycleDeadline', async () => {
    const fallback = new Date('2026-11-30T16:59:59.999Z');
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-7',
      // cycleDeadline intentionally omitted (undefined -> falsy)
      settlementDate: daysFromNow(2),
      settlementAmount: new Prisma.Decimal(1000),
      rescheduleCount: 0,
      slots: [],
    });
    mockPromiseService.calcCycleDeadline.mockResolvedValue(fallback);
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-7');

    expect(res.cycleDeadline).toBe(fallback.toISOString());
    expect(mockPromiseService.calcCycleDeadline).toHaveBeenCalledWith('contract-7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// activePromise summary shape — id / settlementDate / settlementAmount / rescheduleCount
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getCycleDeadline — activePromise summary', () => {
  it('maps the full summary: id, settlementDate ISO, Number(settlementAmount), rescheduleCount, slotsPastDue', async () => {
    const cycleDeadline = new Date('2026-08-31T16:59:59.999Z');
    const settlementDate = new Date('2026-08-15T03:00:00.000Z');
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-full',
      cycleDeadline,
      settlementDate,
      settlementAmount: new Prisma.Decimal('1234.56'),
      rescheduleCount: 2,
      slots: [{ settlementDate: daysAgo(2) }],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res).toEqual({
      cycleDeadline: cycleDeadline.toISOString(),
      activePromise: {
        id: 'cl-full',
        settlementDate: settlementDate.toISOString(),
        settlementAmount: 1234.56,
        rescheduleCount: 2,
        slotsPastDue: true,
      },
    });
  });

  it('coalesces a missing settlementDate to null and a missing settlementAmount to 0 (Number(undefined ?? 0))', async () => {
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-sparse',
      cycleDeadline: daysFromNow(5),
      // settlementDate omitted -> ?.toISOString() ?? null -> null
      // settlementAmount omitted -> Number(undefined ?? 0) -> 0
      // rescheduleCount omitted -> ?? 0 -> 0
      slots: [{ settlementDate: daysFromNow(4) }],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise).toEqual({
      id: 'cl-sparse',
      settlementDate: null,
      settlementAmount: 0,
      rescheduleCount: 0,
      slotsPastDue: false,
    });
  });

  it('coalesces an explicit null settlementAmount to 0 (Number(null ?? 0) === 0, NOT Number(null) === 0 by luck)', async () => {
    mockPromiseService.findActivePromise.mockResolvedValue({
      id: 'cl-nullamt',
      cycleDeadline: daysFromNow(5),
      settlementDate: null,
      settlementAmount: null,
      rescheduleCount: null,
      slots: [],
    });
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-1');

    expect(res.activePromise).toEqual({
      id: 'cl-nullamt',
      settlementDate: null,
      settlementAmount: 0,
      rescheduleCount: 0,
      slotsPastDue: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// null active promise — activePromise: null, deadline via calcCycleDeadline
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.getCycleDeadline — no active promise', () => {
  it('returns activePromise: null and sources the deadline from calcCycleDeadline', async () => {
    const fallback = new Date('2026-12-31T16:59:59.999Z');
    mockPromiseService.findActivePromise.mockResolvedValue(null);
    mockPromiseService.calcCycleDeadline.mockResolvedValue(fallback);
    const svc = await buildService();

    const res = await svc.getCycleDeadline('contract-none');

    expect(res).toEqual({
      cycleDeadline: fallback.toISOString(),
      activePromise: null,
    });
    expect(mockPromiseService.calcCycleDeadline).toHaveBeenCalledWith('contract-none');
  });
});
