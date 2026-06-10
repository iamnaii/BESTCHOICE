/**
 * Test factory for ExpenseDocumentsService.
 *
 * Slice 0 of the transactional-core decompose. This is the SINGLE positional
 * facade construction site in the codebase (see the lone `new` below) — every
 * spec constructs through this factory using a named-object interface keyed by
 * the constructor parameter NAMES (see expense-documents.service.ts:87-107).
 *
 * Why: the facade has a 15-required + 1-optional positional constructor that
 * later slices will reshape (injecting extracted sub-services). Routing all
 * spec construction through one named-object factory means a future
 * constructor change touches ONE place instead of 16 call sites across 7 files.
 *
 * Typing is intentionally loose (`any`) to match the existing `as never` style
 * used by the specs — these are test doubles, not production wiring.
 *
 * NOT a test file: lives under `support/` with a non-`.spec.ts` name so jest's
 * `testRegex: ".*\.spec\.ts$"` never collects it.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../../expense-documents.service';
import { LineAggregatorService } from '../../services/line-aggregator.service';
import { ExpenseDocumentQueryService } from '../../services/expense-document-query.service';
import { ExpenseDocumentLifecycleService } from '../../services/expense-document-lifecycle.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Overrides keyed by the constructor PARAMETER names. All optional. Anything
 * omitted falls back to the minimal default below. The two exceptions to "mock
 * default" are:
 *   - `aggregator` defaults to a REAL `new LineAggregatorService()` (every site
 *     uses the real aggregator today).
 *   - `notifications` defaults to `undefined` (the facade early-returns from
 *     notifyApprovers when it is undefined — preserves the 15-arg behavior of
 *     the specs that omit it).
 */
export interface ExpenseDocumentsServiceOverrides {
  prisma?: any;
  docNumber?: any;
  transition?: any;
  sameDayTemplate?: any;
  accrualTemplate?: any;
  creditNoteTemplate?: any;
  payrollTemplate?: any;
  settlementTemplate?: any;
  journal?: any;
  aggregator?: any;
  jePreview?: any;
  ssoConfig?: any;
  pettyCashTemplate?: any;
  pettyCash?: any;
  payrollCustom?: any;
  notifications?: any;
  // Phase 1 decompose — the read-method sub-service. Defaults to a REAL
  // ExpenseDocumentQueryService built from the same resolved `prisma` +
  // `jePreview`, so existing specs' prisma/jePreview mocks flow through the
  // facade's delegating read methods unchanged.
  query?: any;
  // Phase 2a decompose — the lifecycle sub-service (submitForApproval /
  // softDelete + the private notifyApprovers fan-out). Defaults to a REAL
  // ExpenseDocumentLifecycleService built from the SAME resolved `prisma` +
  // `notifications`, so existing specs' prisma/notifications mocks flow through
  // the facade's delegating lifecycle methods unchanged.
  lifecycle?: any;
}

export interface MadeExpenseDocumentsService {
  service: ExpenseDocumentsService;
  prisma: any;
  docNumber: any;
  transition: any;
  sameDayTemplate: any;
  accrualTemplate: any;
  creditNoteTemplate: any;
  payrollTemplate: any;
  settlementTemplate: any;
  journal: any;
  aggregator: any;
  jePreview: any;
  ssoConfig: any;
  pettyCashTemplate: any;
  pettyCash: any;
  payrollCustom: any;
  notifications: any;
  query: any;
  lifecycle: any;
}

export function makeExpenseDocumentsService(
  overrides: ExpenseDocumentsServiceOverrides = {},
): MadeExpenseDocumentsService {
  const prisma = overrides.prisma ?? {};
  const docNumber = overrides.docNumber ?? { next: jest.fn() };
  const transition =
    overrides.transition ??
    {
      assertCanPost: jest.fn(),
      assertCanVoid: jest.fn(),
      assertCanEdit: jest.fn(),
      assertCanApprove: jest.fn(),
      resolveTargetStatus: jest.fn(),
    };
  const sameDayTemplate = overrides.sameDayTemplate ?? { execute: jest.fn() };
  const accrualTemplate = overrides.accrualTemplate ?? { execute: jest.fn() };
  const creditNoteTemplate = overrides.creditNoteTemplate ?? { execute: jest.fn() };
  const payrollTemplate = overrides.payrollTemplate ?? { execute: jest.fn() };
  const settlementTemplate = overrides.settlementTemplate ?? { execute: jest.fn() };
  const journal = overrides.journal ?? { createAndPost: jest.fn() };
  // REAL aggregator by default — every construction site uses it today.
  const aggregator = overrides.aggregator ?? new LineAggregatorService();
  const jePreview = overrides.jePreview ?? { preview: jest.fn() };
  const ssoConfig =
    overrides.ssoConfig ?? { validateContribution: jest.fn().mockResolvedValue(undefined) };
  const pettyCashTemplate = overrides.pettyCashTemplate ?? { execute: jest.fn() };
  const pettyCash = overrides.pettyCash ?? { getConfig: jest.fn(), validate: jest.fn() };
  const payrollCustom =
    overrides.payrollCustom ??
    {
      loadWhitelist: jest.fn().mockResolvedValue(new Set()),
      validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }),
    };
  // notifications: undefined unless explicitly provided — preserves the
  // early-return behavior of specs that omit it.
  const notifications = overrides.notifications;
  // Phase 1 decompose — REAL query sub-service by default, built from the SAME
  // resolved `prisma` + `jePreview` instances so existing specs' mocks flow
  // through the facade's now-delegating read methods. `jePreview` is no longer
  // a facade constructor arg (it moved into the query service).
  const query = overrides.query ?? new ExpenseDocumentQueryService(prisma, jePreview);
  // Phase 2a/2b decompose — REAL lifecycle sub-service by default. Phase 2b
  // moved the JE-posting core (post / executePostBody / approve) here, so the
  // lifecycle ctor now also takes `transition` + the 6 JE templates. They are
  // built from the SAME resolved mock instances the facade specs assert on
  // (e.g. `sameDayTemplate.execute`), so the facade's delegating post/approve
  // reach the same mocks. `notifications` stays the trailing-optional param.
  const lifecycle =
    overrides.lifecycle ??
    new ExpenseDocumentLifecycleService(
      prisma,
      transition,
      sameDayTemplate,
      accrualTemplate,
      creditNoteTemplate,
      payrollTemplate,
      settlementTemplate,
      pettyCashTemplate,
      notifications,
    );

  // THE single positional construction in the codebase. Phase 2b removed the 6
  // JE-template args from the facade ctor (they now feed the lifecycle service).
  const service = new ExpenseDocumentsService(
    prisma,
    docNumber,
    transition,
    journal,
    aggregator,
    ssoConfig,
    pettyCash,
    payrollCustom,
    query,
    lifecycle,
  );

  return {
    service,
    prisma,
    docNumber,
    transition,
    sameDayTemplate,
    accrualTemplate,
    creditNoteTemplate,
    payrollTemplate,
    settlementTemplate,
    journal,
    aggregator,
    jePreview,
    ssoConfig,
    pettyCashTemplate,
    pettyCash,
    payrollCustom,
    notifications,
    query,
    lifecycle,
  };
}
