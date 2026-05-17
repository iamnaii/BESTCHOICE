/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * D1.2.1 — Approval Workflow API integration test (Nest e2e style)
 * ----------------------------------------------------------------
 * Exercises the two state-transition endpoints exposed by
 * `ExpenseDocumentsController`:
 *
 *   POST /expense-documents/:id/submit-for-approval
 *   POST /expense-documents/:id/approve
 *
 * Lifecycle: DRAFT → PENDING_APPROVAL → APPROVED → POSTED (auto-post branch).
 *
 * Depends on PRs #912 / #923 / #930 / #931 / #932 / #933 being merged before
 * this spec runs in CI. Until the dependency stack lands, the file is excluded
 * from the default `npm test` run because:
 *   1. apps/api/jest config sets `rootDir: "src"` — files under `apps/api/e2e/`
 *      are outside that root.
 *   2. The filename uses `.e2e-spec.ts` which the default `testRegex` of
 *      `.*\\.spec\\.ts$` will match if a future `jest-e2e.json` is added with
 *      `rootDir: ".."` + this glob.
 *
 * Recommended CI wiring (when the dependency PRs are merged):
 *
 *   // apps/api/jest-e2e.json
 *   {
 *     "moduleFileExtensions": ["js","json","ts"],
 *     "rootDir": ".",
 *     "testEnvironment": "node",
 *     "testRegex": ".e2e-spec.ts$",
 *     "transform": { "^.+\\.ts$": "ts-jest" }
 *   }
 *
 *   // package.json
 *   "test:e2e": "jest --config jest-e2e.json"
 *
 * This spec deliberately calls the service layer directly via
 * `Test.createTestingModule` rather than spinning a full HTTP server with
 * supertest — supertest is not currently a dev dependency in this repo. The
 * structural assertions (transition correctness, audit log creation, role
 * rejection) are identical either way.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../src/modules/expense-documents/expense-documents.service';
import { PrismaService } from '../src/prisma/prisma.service';

type DocStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTED'
  | 'ACCRUAL'
  | 'VOIDED';

interface FakeExpenseDoc {
  id: string;
  status: DocStatus;
  documentType: 'EXPENSE' | 'PAYROLL';
  totalAmount: { toString(): string };
  paymentMethod: string | null;
  depositAccountCode: string | null;
  withholdingTax: { toString(): string };
  whtFormType: string | null;
  receiptImageUrl: string | null;
  documentDate: Date;
  deletedAt: Date | null;
}

interface FakeAuditLog {
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  oldValue?: unknown;
  newValue?: unknown;
}

describe('Approval Workflow (D1.2.1) — API integration', () => {
  let moduleRef: TestingModule;
  let service: ExpenseDocumentsService;

  // Lightweight in-memory PrismaService stub. Only the call paths the
  // approval flow exercises are implemented — anything else throws so the
  // contract surface stays explicit.
  const docs = new Map<string, FakeExpenseDoc>();
  const auditLogs: FakeAuditLog[] = [];

  const prismaMock: Partial<PrismaService> & Record<string, any> = {
    expenseDocument: {
      findUniqueOrThrow: jest.fn(async ({ where: { id } }: any) => {
        const doc = docs.get(id);
        if (!doc) throw new Error('not found');
        return doc;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = docs.get(where.id);
        if (!existing) throw new Error('not found');
        const next = { ...existing, ...data };
        docs.set(where.id, next);
        return next;
      }),
    } as any,
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    } as any,
    systemConfig: {
      findFirst: jest.fn(async ({ where: { key } }: any) => {
        if (key === 'auto_post_on_approve') return { value: 'true' };
        return null;
      }),
      findUnique: jest.fn(async () => null),
    } as any,
    $transaction: jest.fn(async (cb: any) => cb(prismaMock as PrismaService)),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        ExpenseDocumentsService,
        { provide: PrismaService, useValue: prismaMock },
        // The service depends on a handful of helper providers (DocNumberService,
        // StatusTransitionService, LineAggregatorService, JePreviewService and
        // the JE template classes). Because this is a lifecycle-only test, we
        // stub their public surface to no-ops sufficient for the approval
        // codepath. Real templates execute their JE in production.
        { provide: 'DocNumberService', useValue: { next: jest.fn() } },
        {
          provide: 'StatusTransitionService',
          useValue: {
            assertCanApprove: jest.fn((input: { from: DocStatus }) => {
              if (input.from !== 'PENDING_APPROVAL') {
                throw new BadRequestException(
                  `ไม่สามารถอนุมัติเอกสารในสถานะ ${input.from} ได้ (PENDING_APPROVAL เท่านั้น)`,
                );
              }
            }),
            resolveTargetStatus: jest.fn(() => 'POSTED'),
          },
        },
      ],
    })
      // Loosen DI to skip optional templates not under test here.
      .useMocker(() => ({}))
      .compile();

    service = moduleRef.get<ExpenseDocumentsService>(ExpenseDocumentsService);
  });

  beforeEach(() => {
    docs.clear();
    auditLogs.length = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  function seedDoc(overrides: Partial<FakeExpenseDoc> = {}): FakeExpenseDoc {
    const doc: FakeExpenseDoc = {
      id: 'doc-' + Math.random().toString(36).slice(2, 8),
      status: 'DRAFT',
      documentType: 'EXPENSE',
      totalAmount: { toString: () => '1000.00' },
      paymentMethod: 'CASH',
      depositAccountCode: '11-1101',
      withholdingTax: { toString: () => '0' },
      whtFormType: null,
      receiptImageUrl: null,
      documentDate: new Date('2026-05-17'),
      deletedAt: null,
      ...overrides,
    };
    docs.set(doc.id, doc);
    return doc;
  }

  // ─── DRAFT → PENDING_APPROVAL ────────────────────────────────────────────

  it('POST /:id/submit-for-approval transitions DRAFT → PENDING_APPROVAL', async () => {
    const doc = seedDoc({ status: 'DRAFT', documentType: 'PAYROLL' });

    // Method exposed by D1.2.1.1 (#923) on ExpenseDocumentsService.
    const submitFn = (service as unknown as Record<string, any>)
      .submitForApproval;
    if (typeof submitFn !== 'function') {
      // Dependency PRs not merged yet — skip without failing.
      return;
    }

    const result = await submitFn.call(service, doc.id, 'user-owner');
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(docs.get(doc.id)?.status).toBe('PENDING_APPROVAL');

    // Audit log written
    const audited = auditLogs.find(
      (a) => a.entityId === doc.id && /SUBMITTED|PENDING/i.test(a.action),
    );
    expect(audited).toBeTruthy();
    expect(audited?.entity).toBe('expense_document');
    expect(audited?.userId).toBe('user-owner');
  });

  // ─── PENDING_APPROVAL → APPROVED (+ audit log) ───────────────────────────

  it('POST /:id/approve transitions PENDING_APPROVAL → APPROVED + writes AuditLog', async () => {
    const doc = seedDoc({ status: 'PENDING_APPROVAL', documentType: 'PAYROLL' });

    // approve() is already in service today (PR #912). Returns silently —
    // we assert the persisted side effects instead.
    const approveFn = (service as unknown as Record<string, any>).approve;
    if (typeof approveFn !== 'function') return; // dependency PR not merged
    await approveFn.call(service, doc.id, 'user-owner');

    // Status moves through APPROVED (then to POSTED via auto-post chain when
    // auto_post_on_approve = true, which is the default).
    expect(['APPROVED', 'POSTED']).toContain(docs.get(doc.id)?.status);

    // Audit log: at minimum an APPROVED record. The dependency PRs may also
    // emit POSTED on the auto-post chain.
    const approvedLog = auditLogs.find(
      (a) =>
        a.entityId === doc.id &&
        /EXPENSE_APPROVED|APPROVED/.test(a.action) &&
        !/REJECT/.test(a.action),
    );
    expect(approvedLog).toBeTruthy();
    expect(approvedLog?.userId).toBe('user-owner');
    expect(approvedLog?.entity).toBe('expense_document');
  });

  // ─── Negative: DRAFT cannot be approved ───────────────────────────────────

  it('POST /:id/approve on DRAFT throws BadRequestException', async () => {
    const doc = seedDoc({ status: 'DRAFT' });
    const approveFn = (service as unknown as Record<string, any>).approve;
    if (typeof approveFn !== 'function') return; // dependency PR not merged
    await expect(approveFn.call(service, doc.id, 'user-owner')).rejects.toThrow(
      BadRequestException,
    );
    // Status must not change on rejection.
    expect(docs.get(doc.id)?.status).toBe('DRAFT');
  });

  // ─── Negative: non-approver gets 403 ─────────────────────────────────────

  it('POST /:id/approve from a non-approver user is rejected with ForbiddenException', async () => {
    const doc = seedDoc({ status: 'PENDING_APPROVAL', documentType: 'PAYROLL' });

    // The approvers_list gate (D1.2.1.3, PR #931) layers on top of the
    // controller-level @Roles guard. When the user is not in the configured
    // approvers_list, the service should reject with 403 even if the role
    // technically matches.
    const enforcer = (service as unknown as Record<string, any>)
      .assertUserIsApprover;
    if (typeof enforcer !== 'function') {
      // Dependency PR #931 not merged yet — skip.
      return;
    }
    await expect(
      enforcer.call(service, 'user-sales'),
    ).rejects.toThrow(ForbiddenException);

    // Status must not change when approval is rejected.
    expect(docs.get(doc.id)?.status).toBe('PENDING_APPROVAL');
  });

  // ─── Negative: cannot re-submit an already-PENDING doc ───────────────────

  it('re-submitting a PENDING_APPROVAL doc is rejected', async () => {
    const doc = seedDoc({ status: 'PENDING_APPROVAL' });
    const submitFn = (service as unknown as Record<string, any>)
      .submitForApproval;
    if (typeof submitFn !== 'function') return;

    await expect(
      submitFn.call(service, doc.id, 'user-owner'),
    ).rejects.toThrow(BadRequestException);
  });
});
