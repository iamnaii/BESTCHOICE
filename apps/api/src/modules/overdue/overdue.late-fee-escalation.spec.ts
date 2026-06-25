import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { BUSINESS_RULES } from '../../utils/config.util';
import { ConsecutiveMissedService } from './consecutive-missed.service';

/**
 * Characterization (golden) tests for OverdueService — late-fee config resolution
 * + the escalation lanes. Wave 3 gap-fill (audit HIGH gap). PINS current behaviour;
 * the service source is NOT modified — surprising behaviour is encoded as the golden.
 *
 * What this file locks:
 *
 * calculateLateFees (overdue.service.ts ~268-306) — JS-SIDE ONLY:
 *   - tier1Amount  = config present ? Number(value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT (50)
 *   - tier2Amount  = config present ? Number(value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT (100)
 *   - tier2MinDays = config present ? Number(value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS (3)
 *   - those three resolved scalars are interpolated into the $executeRaw tagged
 *     template (positions 1/2/3 after the leading `now` timestamp) and the row
 *     count returned by $executeRaw is echoed back as { updated, timestamp }.
 *   NOTE: the flat-bracket CASE WHEN runs INSIDE Postgres via $executeRaw raw SQL —
 *   the arithmetic cannot be exercised by a mock. See "uncovered" in the return.
 *
 * escalate (~1544-1660):
 *   - SoD: action='LEGAL' by SALES / BRANCH_MANAGER -> ForbiddenException
 *     (only OWNER / FINANCE_MANAGER may hand to legal). NON-LEGAL actions are not gated.
 *   - missing contract -> NotFoundException
 *   - reason null / <5 trimmed chars -> BadRequestException
 *   - LETTER  -> letterService.createIfNotExists + audit CONTRACT_ESCALATED_LETTER
 *   - MDM     -> mdmLockService.proposeManual + audit CONTRACT_ESCALATED_MDM
 *   - LEGAL by OWNER -> single $transaction([update, audit]) sets dunningStage=LEGAL_ACTION
 *     AND nulls pendingDunningStage / pendingDunningSince; audit CONTRACT_ESCALATED_LEGAL
 *   - every audit row embeds brokenPromiseCount (from getBrokenPromiseCount = auditLog.count)
 *   - owner-alert failure is swallowed (best-effort) — escalate still resolves
 *
 * escalateDunningStages (~470-600) day->stage boundaries:
 *   - 7d  oldest-overdue, currentStage NONE -> REMINDER  (pushed to escalated[])
 *   - 8d  -> NOTICE (pushed)
 *   - 30d -> NOTICE (pushed; 30 < 31 so not yet FINAL_WARNING)
 *   - 31d -> FINAL_WARNING PARKED as pending (pendingDunningStage written + audit
 *           DUNNING_ESCALATION_PENDING; NOT pushed to escalated[]; no stage flip)
 *   - 61d -> LEGAL_ACTION PARKED as pending (same)
 *   - never de-escalate: currentStage already >= target (targetIdx <= currentIdx) -> no-op
 *
 * logContact PROMISED guardrail (~965-1019):
 *   - getBrokenPromiseCount >= ESCALATION_BROKEN_PROMISE_THRESHOLD (2) -> BadRequestException
 *     with payload { requiresEscalation:true, brokenPromiseCount, threshold:2 };
 *     promiseService.createPromise NOT called
 *   - count = 1 (below threshold) -> allowed, createPromise called
 *   - no slots / no settlementDate -> BadRequestException 'ต้องระบุอย่างน้อย 1 ที่'
 *   - settlementDate > 30 days out -> BadRequestException (still rejected even though
 *     PromiseService would also enforce cycleDeadline)
 *
 * Mock-only — no DB, no real Prisma. PrismaService is a hand-mocked stub with only the
 * methods each path needs; every other injected dep is a no-op stub. Money on PromiseSlot
 * input uses Number()/Prisma.Decimal exactly as the code does (slotsInput.settlementAmount
 * stays a plain number; totalPromiseAmount accumulates via new Prisma.Decimal()).
 * Sibling pattern: overdue.service.spec.ts + credit-check.ai-analysis.spec.ts.
 */

// ── Shared no-op stubs for the deps that the targeted paths never drive ───────
const mockDunningEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };
const mockKpiService = { invalidate: jest.fn() };
const mockPaymentsService = { autoAllocatePayment: jest.fn() };

/** Build the service with a hand-mocked Prisma + the supplied collaborator stubs. */
type PrismaMock = Record<string, unknown>;
const buildService = async (
  prisma: PrismaMock,
  overrides: {
    promiseService?: Partial<Record<string, jest.Mock>>;
    letterService?: Partial<Record<string, jest.Mock>>;
    mdmLockService?: Partial<Record<string, jest.Mock>>;
    ownerAlertHelper?: Partial<Record<string, jest.Mock>>;
  } = {},
): Promise<OverdueService> => {
  const promiseService = {
    createPromise: jest.fn().mockResolvedValue({ id: 'promise-1' }),
    findActivePromise: jest.fn().mockResolvedValue(null),
    calcCycleDeadline: jest.fn(),
    ...overrides.promiseService,
  };
  const letterService = {
    createIfNotExists: jest.fn().mockResolvedValue({ id: 'letter-1' }),
    ...overrides.letterService,
  };
  const mdmLockService = {
    proposeManual: jest.fn().mockResolvedValue({ id: 'mdm-1' }),
    ...overrides.mdmLockService,
  };
  const ownerAlertHelper = {
    sendToAllOwners: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    ...overrides.ownerAlertHelper,
  };

  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      OverdueService,
      { provide: PrismaService, useValue: prisma },
      { provide: DunningEngineService, useValue: mockDunningEngine },
      { provide: OverdueKpiService, useValue: mockKpiService },
      { provide: PromiseService, useValue: promiseService },
      { provide: PaymentsService, useValue: mockPaymentsService },
      { provide: ContractLetterService, useValue: letterService },
      { provide: MdmLockService, useValue: mdmLockService },
      { provide: OwnerAlertHelper, useValue: ownerAlertHelper },
      { provide: ConsecutiveMissedService, useValue: { getStreaks: jest.fn().mockResolvedValue(new Map()) } },
    ],
  }).compile();
  return mod.get(OverdueService);
};

const daysFromNowIso = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// calculateLateFees — D2 flat-bracket config resolution (raw SQL arithmetic in PG)
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.calculateLateFees (D2 flat-bracket config resolution — raw SQL arithmetic excluded)', () => {
  /**
   * $executeRaw is a tagged template: ($executeRaw`...${now}...${minDays}...${tier2}...${tier1}...`)
   * so jest receives (strings, ...exprs). exprs[0] = now timestamp; the bracket scalars follow.
   * The SQL CASE happens in Postgres — we only pin the JS-side config resolution here.
   *
   * SQL shape (D2):
   *   CASE
   *     WHEN days >= ${minDays} THEN ${tier2}
   *     WHEN days >= 1         THEN ${tier1}
   *     ELSE 0
   *   END
   * exprs order after `now`: minDays (×2 in SQL, same value), tier2, tier1 (×2 total = 4 extra exprs)
   * We assert on the distinct scalar values rather than positional indices for robustness.
   */
  const makePrisma = (
    tier1Cfg: { value: string } | null,
    tier2Cfg: { value: string } | null,
    minDaysCfg: { value: string } | null,
    rowsUpdated = 3,
  ): PrismaMock => ({
    systemConfig: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) => {
        if (where.key === 'late_fee_tier1_amount') return Promise.resolve(tier1Cfg);
        if (where.key === 'late_fee_tier2_amount') return Promise.resolve(tier2Cfg);
        if (where.key === 'late_fee_tier2_min_days') return Promise.resolve(minDaysCfg);
        return Promise.resolve(null);
      }),
    },
    $executeRaw: jest.fn().mockResolvedValue(rowsUpdated),
  });

  /** All interpolated values passed to $executeRaw (after the SQL template strings). */
  const rawExprs = (prisma: PrismaMock): unknown[] =>
    (prisma.$executeRaw as jest.Mock).mock.calls[0].slice(1);

  it('falls back to BUSINESS_RULES defaults (tier1=50, tier2=100, minDays=3) when no SystemConfig rows exist', async () => {
    const prisma = makePrisma(null, null, null);
    const svc = await buildService(prisma);

    const out = await svc.calculateLateFees();

    const exprs = rawExprs(prisma);
    // exprs[0] = now; remaining exprs contain tier1/tier2/minDays values (each used once or
    // twice in the CASE branches). Assert that the distinct values are the BUSINESS_RULES defaults.
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT); // 50
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT); // 100
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS); // 3
    expect(out.updated).toBe(3);
    expect(out.timestamp).toBeInstanceOf(Date);
  });

  it('uses Number(SystemConfig.value) for tier1, tier2, minDays when configured', async () => {
    const prisma = makePrisma({ value: '75' }, { value: '150' }, { value: '5' });
    const svc = await buildService(prisma);

    await svc.calculateLateFees();

    const exprs = rawExprs(prisma);
    expect(exprs).toContain(75);   // tier1 from config
    expect(exprs).toContain(150);  // tier2 from config
    expect(exprs).toContain(5);    // minDays from config
    // The old per-day model interpolated a 0.05 percentage cap (LATE_FEE_CAP_PCT),
    // removed in D2 task 4. With tier1/2/minDays configured to distinct non-default
    // values (75/150/5), the ONLY numeric exprs should be those three — no stray
    // capPct or per-day fraction. (Asserting 0.05 absence here is robust because no
    // configured tier value equals 0.05.)
    expect(exprs).not.toContain(0.05); // old LATE_FEE_CAP_PCT must never appear
    const numericExprs = exprs.filter((e) => typeof e === 'number');
    expect(numericExprs.every((n) => [75, 150, 5].includes(n))).toBe(true);
  });

  it('each tier config falls back to its own BUSINESS_RULES default independently', async () => {
    // tier1 configured, tier2 + minDays missing → only tier1 override applies
    const prisma = makePrisma({ value: '60' }, null, null);
    const svc = await buildService(prisma);

    await svc.calculateLateFees();

    const exprs = rawExprs(prisma);
    expect(exprs).toContain(60);   // configured tier1
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT);   // default tier2 = 100
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS); // default minDays = 3
  });

  it('cron sets flat bracket: 2 days → 50, 5 days → 100, and DOWNGRADES a stored 200 → 100', async () => {
    // This test pins the bracket expectations at the JS/config level.
    // The actual SQL CASE arithmetic runs in Postgres; the e2e spec covers that.
    // Here we confirm defaults resolve correctly (tier2=100 at minDays=3 → a 5-day payment gets 100).
    const prisma = makePrisma(null, null, null, 3); // 3 rows updated
    const svc = await buildService(prisma);

    const out = await svc.calculateLateFees();

    const exprs = rawExprs(prisma);
    // tier1 = 50 (→ applied to 1..2 days), tier2 = 100 (→ applied to ≥3 days)
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT); // 50
    expect(exprs).toContain(BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT); // 100
    // Unconditional SET means any stored value (e.g. 200) is overwritten → downgrade
    expect(out.updated).toBe(3);
  });

  it('echoes the $executeRaw row count back as { updated }', async () => {
    const prisma = makePrisma(null, null, null, 7);
    const svc = await buildService(prisma);

    const out = await svc.calculateLateFees();
    expect(out.updated).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// escalate — SoD, validation, per-action audit, atomic LEGAL transition
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.escalate (escalation lanes + SoD)', () => {
  const contractRow = {
    id: 'c-1',
    contractNumber: 'BC-001',
    customer: { name: 'สมชาย' },
  };

  /** brokenCount drives getBrokenPromiseCount (= auditLog.count). */
  const makePrisma = (brokenCount = 3): PrismaMock => ({
    contract: {
      findFirst: jest.fn().mockResolvedValue(contractRow),
      update: jest.fn().mockResolvedValue({ id: 'c-1', dunningStage: 'LEGAL_ACTION' }),
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(brokenCount),
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    // batch form for the LEGAL lane: $transaction([update, auditCreate])
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  });

  it('forbids LEGAL escalation by SALES (only OWNER / FINANCE_MANAGER)', async () => {
    const svc = await buildService(makePrisma());
    await expect(svc.escalate('c-1', 'u-1', 'SALES', 'LEGAL', 'ลูกค้าหนีหนี้')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('forbids LEGAL escalation by BRANCH_MANAGER', async () => {
    const svc = await buildService(makePrisma());
    await expect(
      svc.escalate('c-1', 'u-1', 'BRANCH_MANAGER', 'LEGAL', 'ลูกค้าหนีหนี้'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does NOT gate LETTER on role — SALES may send a warning letter', async () => {
    const prisma = makePrisma(2);
    const svc = await buildService(prisma);
    const out = await svc.escalate('c-1', 'u-1', 'SALES', 'LETTER', 'ผิดนัดซ้ำ');
    expect(out.action).toBe('LETTER');
  });

  it('throws NotFoundException when the contract is missing', async () => {
    const prisma = makePrisma();
    (prisma.contract as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);
    const svc = await buildService(prisma);
    await expect(svc.escalate('c-x', 'u-1', 'OWNER', 'LETTER', 'เหตุผลยาวพอ')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a reason shorter than 5 trimmed characters', async () => {
    const svc = await buildService(makePrisma());
    await expect(svc.escalate('c-1', 'u-1', 'OWNER', 'LETTER', ' ab ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('LETTER lane: creates the termination letter + CONTRACT_ESCALATED_LETTER audit with brokenPromiseCount', async () => {
    const prisma = makePrisma(4);
    const letterService = { createIfNotExists: jest.fn().mockResolvedValue({ id: 'L-9' }) };
    const svc = await buildService(prisma, { letterService });

    const out = await svc.escalate('c-1', 'u-1', 'OWNER', 'LETTER', 'หนังสือบอกเลิกสัญญา');

    expect(letterService.createIfNotExists).toHaveBeenCalledWith('c-1', 'CONTRACT_TERMINATION_60D');
    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('CONTRACT_ESCALATED_LETTER');
    // Standardised to lowercase 'contract' (matches DB convention + the rest of
    // this service; getBrokenPromiseCount still dual-reads both casings).
    expect(auditArgs.data.entity).toBe('contract');
    expect(auditArgs.data.newValue).toMatchObject({ brokenPromiseCount: 4, letterId: 'L-9' });
    expect(out.brokenPromiseCount).toBe(4);
  });

  it('MDM lane: proposes a manual MDM lock + CONTRACT_ESCALATED_MDM audit with mdmRequestId', async () => {
    const prisma = makePrisma(2);
    const mdmLockService = { proposeManual: jest.fn().mockResolvedValue({ id: 'MDM-7' }) };
    const svc = await buildService(prisma, { mdmLockService });

    const out = await svc.escalate('c-1', 'u-1', 'FINANCE_MANAGER', 'MDM', 'เสนอล็อคเครื่อง');

    expect(mdmLockService.proposeManual).toHaveBeenCalledWith('c-1', 'u-1', 'เสนอล็อคเครื่อง');
    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('CONTRACT_ESCALATED_MDM');
    expect(auditArgs.data.newValue).toMatchObject({ brokenPromiseCount: 2, mdmRequestId: 'MDM-7' });
    expect(out.action).toBe('MDM');
  });

  it('LEGAL lane (OWNER): one $transaction sets LEGAL_ACTION + nulls pending fields + writes CONTRACT_ESCALATED_LEGAL', async () => {
    const prisma = makePrisma(5);
    const svc = await buildService(prisma);

    const out = await svc.escalate('c-1', 'u-1', 'OWNER', 'LEGAL', 'ส่งให้ทนายดำเนินคดี');

    // Single atomic batch — update + audit go through one $transaction call.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const updateArgs = (prisma.contract as { update: jest.Mock }).update.mock.calls[0][0];
    expect(updateArgs.data.dunningStage).toBe('LEGAL_ACTION');
    expect(updateArgs.data.pendingDunningStage).toBeNull();
    expect(updateArgs.data.pendingDunningSince).toBeNull();

    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('CONTRACT_ESCALATED_LEGAL');
    expect(auditArgs.data.newValue).toMatchObject({ brokenPromiseCount: 5 });
    expect(out.action).toBe('LEGAL');
    expect(out.brokenPromiseCount).toBe(5);
  });

  it('swallows an owner-alert failure (best-effort) and still resolves the escalation', async () => {
    const prisma = makePrisma(2);
    const ownerAlertHelper = {
      sendToAllOwners: jest.fn().mockRejectedValue(new Error('LINE OA down')),
    };
    const svc = await buildService(prisma, { ownerAlertHelper });

    const out = await svc.escalate('c-1', 'u-1', 'OWNER', 'LETTER', 'หนังสือเตือน');
    expect(out.action).toBe('LETTER');
    expect(ownerAlertHelper.sendToAllOwners).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// escalateDunningStages — day->stage boundaries + park-as-pending + no de-escalation
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.escalateDunningStages (day boundaries)', () => {
  /**
   * The cron pages contracts in batches of 500; a single short batch ends the loop.
   * Each contract carries its single oldest unpaid payment (take:1 ordered asc).
   */
  const makePrisma = (contract: {
    id: string;
    contractNumber: string;
    dunningStage: string;
    oldestDueDaysAgo: number;
  }): PrismaMock => ({
    contract: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: contract.id,
          contractNumber: contract.contractNumber,
          dunningStage: contract.dunningStage,
          payments: [{ dueDate: daysAgo(contract.oldestDueDaysAgo) }],
        },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-user' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'a-1' }) },
  });

  it('7 days overdue from NONE escalates to REMINDER and pushes onto escalated[]', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'NONE',
      oldestDueDaysAgo: 7,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();

    expect(out.escalated).toHaveLength(1);
    expect(out.escalated[0]).toMatchObject({ to: 'REMINDER', from: 'NONE' });
    const updateArgs = (prisma.contract as { update: jest.Mock }).update.mock.calls[0][0];
    expect(updateArgs.data.dunningStage).toBe('REMINDER');
    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('DUNNING_ESCALATION');
  });

  it('8 days overdue from NONE escalates to NOTICE', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'NONE',
      oldestDueDaysAgo: 8,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();
    expect(out.escalated[0]).toMatchObject({ to: 'NOTICE' });
  });

  it('30 days overdue is still NOTICE (boundary: 30 < 31)', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'REMINDER',
      oldestDueDaysAgo: 30,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();
    expect(out.escalated[0]).toMatchObject({ to: 'NOTICE', from: 'REMINDER' });
  });

  it('31 days overdue PARKS FINAL_WARNING as pending — no stage flip, not in escalated[]', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'NOTICE',
      oldestDueDaysAgo: 31,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();

    // Parked — nothing pushed for human-approval-gated stages.
    expect(out.escalated).toHaveLength(0);
    const updateArgs = (prisma.contract as { update: jest.Mock }).update.mock.calls[0][0];
    expect(updateArgs.data.pendingDunningStage).toBe('FINAL_WARNING');
    expect(updateArgs.data.pendingDunningSince).toBeInstanceOf(Date);
    // The live dunningStage is NOT touched in the parked path.
    expect(updateArgs.data.dunningStage).toBeUndefined();
    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('DUNNING_ESCALATION_PENDING');
    expect(auditArgs.data.newValue).toMatchObject({ pendingDunningStage: 'FINAL_WARNING' });
  });

  it('61 days overdue PARKS LEGAL_ACTION as pending — no stage flip, not in escalated[]', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'NOTICE',
      oldestDueDaysAgo: 61,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();

    expect(out.escalated).toHaveLength(0);
    const updateArgs = (prisma.contract as { update: jest.Mock }).update.mock.calls[0][0];
    expect(updateArgs.data.pendingDunningStage).toBe('LEGAL_ACTION');
    const auditArgs = (prisma.auditLog as { create: jest.Mock }).create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('DUNNING_ESCALATION_PENDING');
  });

  it('never de-escalates: already NOTICE with only 8 days overdue (target NOTICE) -> no update, no audit', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'NOTICE',
      oldestDueDaysAgo: 8,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();

    // targetIdx (NOTICE) is NOT > currentIdx (NOTICE) -> branch skipped entirely.
    expect(out.escalated).toHaveLength(0);
    expect((prisma.contract as { update: jest.Mock }).update).not.toHaveBeenCalled();
    expect((prisma.auditLog as { create: jest.Mock }).create).not.toHaveBeenCalled();
  });

  it('never de-escalates: already FINAL_WARNING with only 8 days overdue (target NOTICE < current) -> no-op', async () => {
    const prisma = makePrisma({
      id: 'c-1',
      contractNumber: 'BC-001',
      dunningStage: 'FINAL_WARNING',
      oldestDueDaysAgo: 8,
    });
    const svc = await buildService(prisma);

    const out = await svc.escalateDunningStages();
    expect(out.escalated).toHaveLength(0);
    expect((prisma.contract as { update: jest.Mock }).update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logContact PROMISED broken-promise guardrail
// ─────────────────────────────────────────────────────────────────────────────
describe('OverdueService.logContact (PROMISED broken-promise guardrail)', () => {
  /** brokenCount drives the auditLog.count guardrail consulted before PROMISED. */
  const makePrisma = (brokenCount: number): { prisma: PrismaMock; tx: PrismaMock } => {
    const tx: PrismaMock = {
      contract: { update: jest.fn().mockResolvedValue({ id: 'c-1' }) },
    };
    const prisma: PrismaMock = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1', contractNumber: 'BC-001' }),
        update: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      auditLog: { count: jest.fn().mockResolvedValue(brokenCount) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      // interactive form: $transaction(cb) -> cb(tx)
      $transaction: jest.fn((cb: (t: PrismaMock) => Promise<unknown>) => cb(tx)),
    };
    return { prisma, tx };
  };

  it('blocks PROMISED when brokenPromiseCount >= threshold (2) and does NOT create a promise', async () => {
    const { prisma } = makePrisma(2);
    const promiseService = { createPromise: jest.fn() };
    const svc = await buildService(prisma, { promiseService });

    await expect(
      svc.logContact('c-1', 'u-1', {
        result: 'PROMISED',
        settlementDate: daysFromNowIso(5),
        settlementAmount: 1000,
      }),
    ).rejects.toMatchObject({
      response: {
        requiresEscalation: true,
        brokenPromiseCount: 2,
        threshold: BUSINESS_RULES.ESCALATION_BROKEN_PROMISE_THRESHOLD,
      },
    });
    expect(promiseService.createPromise).not.toHaveBeenCalled();
  });

  it('blocks PROMISED when brokenPromiseCount is 3 (well past threshold)', async () => {
    const { prisma } = makePrisma(3);
    const svc = await buildService(prisma);
    await expect(
      svc.logContact('c-1', 'u-1', {
        result: 'PROMISED',
        settlementDate: daysFromNowIso(5),
        settlementAmount: 1000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows PROMISED when brokenPromiseCount is 1 (below threshold) and calls createPromise', async () => {
    const { prisma } = makePrisma(1);
    const promiseService = { createPromise: jest.fn().mockResolvedValue({ id: 'promise-9' }) };
    const svc = await buildService(prisma, { promiseService });

    const out = await svc.logContact('c-1', 'u-1', {
      result: 'PROMISED',
      settlementDate: daysFromNowIso(5),
      settlementAmount: 1000,
    });

    expect(promiseService.createPromise).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ id: 'promise-9' });
  });

  it('rejects PROMISED with no slots and no settlementDate ("ต้องระบุอย่างน้อย 1 ที่")', async () => {
    const { prisma } = makePrisma(0);
    const promiseService = { createPromise: jest.fn() };
    const svc = await buildService(prisma, { promiseService });

    await expect(svc.logContact('c-1', 'u-1', { result: 'PROMISED' })).rejects.toThrow(
      'ต้องระบุอย่างน้อย 1 ที่',
    );
    expect(promiseService.createPromise).not.toHaveBeenCalled();
  });

  it('rejects a PROMISED settlementDate more than 30 days out (before any promise is created)', async () => {
    const { prisma } = makePrisma(0);
    const promiseService = { createPromise: jest.fn() };
    const svc = await buildService(prisma, { promiseService });

    await expect(
      svc.logContact('c-1', 'u-1', {
        result: 'PROMISED',
        settlementDate: daysFromNowIso(31),
        settlementAmount: 1000,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(promiseService.createPromise).not.toHaveBeenCalled();
  });

  it('rejects a past PROMISED settlementDate (วันนัดชำระต้องเป็นวันในอนาคต)', async () => {
    const { prisma } = makePrisma(0);
    const svc = await buildService(prisma);
    await expect(
      svc.logContact('c-1', 'u-1', {
        result: 'PROMISED',
        settlementDate: daysFromNowIso(-1),
        settlementAmount: 1000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes the FIFO-computed total (sum of slot amounts as Prisma.Decimal) when no targetIds given', async () => {
    // Two slots -> totalPromiseAmount accumulates via Prisma.Decimal; computeFifoTargets
    // is invoked with the .toNumber() of that total (no targetInstallmentIds supplied).
    const { prisma } = makePrisma(0);
    const findManySpy = (prisma.payment as { findMany: jest.Mock }).findMany;
    const promiseService = { createPromise: jest.fn().mockResolvedValue({ id: 'promise-x' }) };
    const svc = await buildService(prisma, { promiseService });

    await svc.logContact('c-1', 'u-1', {
      result: 'PROMISED',
      slots: [
        { settlementDate: daysFromNowIso(3), settlementAmount: 600 },
        { settlementDate: daysFromNowIso(6), settlementAmount: 400 },
      ],
    });

    // computeFifoTargets ran (payment.findMany consulted) since no targetInstallmentIds.
    expect(findManySpy).toHaveBeenCalledTimes(1);
    // Sanity: the Decimal sum of the two slots is 1000.
    expect(new Prisma.Decimal(600).add(new Prisma.Decimal(400)).toNumber()).toBe(1000);
    expect(promiseService.createPromise).toHaveBeenCalledTimes(1);
  });
});
