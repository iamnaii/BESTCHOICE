/**
 * P3-SP5 — Test helpers for SHOP template unit tests (jest).
 *
 * The legacy specs (deleted in PR P3-SP5 DEEP fix) used vitest + a real
 * PrismaClient. They never ran because jest's testPathIgnorePatterns
 * excluded `cpa-templates/*.spec.ts`, AND because vitest isn't installed
 * in this repo. These replacements are jest unit tests with mocked
 * dependencies — they validate the JE composition (lines, amounts,
 * account codes, idempotency probe) without touching a database, which
 * is enough to catch the C1/C2 balance bugs that were the original
 * motivation for moving the specs out.
 */
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

export interface MockJournalAutoServiceState {
  /** Last input passed to createAndPost. */
  lastInput?: { lines: { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description?: string }[]; description: string; metadata?: unknown; companyId?: string };
  /** Auto-increment id for entries — caller can override. */
  nextId: number;
  /** Records every createAndPost call (for assertions on call count). */
  callCount: number;
}

export function makeMockJournalAuto(state?: Partial<MockJournalAutoServiceState>): {
  service: AnyMock;
  state: MockJournalAutoServiceState;
} {
  const s: MockJournalAutoServiceState = {
    nextId: 1,
    callCount: 0,
    ...state,
  };
  const service = {
    createAndPost: jest.fn().mockImplementation(async (input: MockJournalAutoServiceState['lastInput']) => {
      s.lastInput = input;
      s.callCount += 1;
      // Honour `balanced` invariant the real service enforces.
      let totalDr = new Prisma.Decimal(0);
      let totalCr = new Prisma.Decimal(0);
      for (const l of input!.lines) {
        totalDr = totalDr.add(l.dr);
        totalCr = totalCr.add(l.cr);
      }
      if (!totalDr.equals(totalCr)) {
        throw new Error(`Unbalanced JE (mock): Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)}`);
      }
      const id = `je-${s.nextId++}`;
      return { id, entryNumber: `JE-${id}` };
    }),
  };
  return { service, state: s };
}

export interface MockPrismaState {
  /** Stored journal entries by metadata.flow + metadata.idempotencyKey */
  entries: Map<string, { id: string; entryNumber: string; metadata?: unknown }>;
  /** Override what companyInfo.findFirst returns. Default: `{ id: 'shop-id' }`. */
  companyInfoResults: Map<string, { id: string } | null>;
}

export function makeMockPrisma(state?: Partial<MockPrismaState>): {
  prisma: AnyMock;
  state: MockPrismaState;
} {
  const s: MockPrismaState = {
    entries: new Map(),
    companyInfoResults: new Map([
      ['SHOP', { id: 'shop-co-id' }],
      ['FINANCE', { id: 'finance-co-id' }],
    ]),
    ...state,
  };
  const prismaLikeClient: AnyMock = {
    journalEntry: {
      findFirst: jest.fn().mockImplementation(async (args: AnyMock) => {
        // Parse the AND clauses to extract flow + idempotencyKey
        const ands: AnyMock[] = args?.where?.AND ?? [];
        let flow = '';
        let key = '';
        for (const a of ands) {
          const m = a?.metadata;
          if (m?.path?.[0] === 'flow') flow = String(m.equals);
          if (m?.path?.[0] === 'idempotencyKey') key = String(m.equals);
          if (m?.path?.[0] === 'batchId') {
            // batchId-based probe (used by inventory-transfer revenue leg)
            return s.entries.get(`batchId:${m.equals}`) ?? null;
          }
        }
        const mapKey = `${flow}:${key}`;
        return s.entries.get(mapKey) ?? null;
      }),
      update: jest.fn().mockImplementation(async () => ({})),
      findUnique: jest.fn().mockImplementation(async () => null),
    },
    companyInfo: {
      findFirst: jest.fn().mockImplementation(async (args: AnyMock) => {
        const code: string = args?.where?.companyCode ?? '';
        return s.companyInfoResults.get(code) ?? null;
      }),
    },
    // Templates that wrap themselves in $transaction(fn) — we just call fn with the prisma itself.
    $transaction: jest.fn().mockImplementation(async (fn: (tx: AnyMock) => Promise<unknown>) => {
      return await fn(prismaLikeClient);
    }),
  };
  return { prisma: prismaLikeClient, state: s };
}

/** Build a CompanyResolverService-shaped mock that always returns the shop/finance ids. */
export function makeMockCompanyResolver(opts?: { shopId?: string; financeId?: string }): AnyMock {
  return {
    getShopCompanyId: jest.fn().mockResolvedValue(opts?.shopId ?? 'shop-co-id'),
    getFinanceCompanyId: jest.fn().mockResolvedValue(opts?.financeId ?? 'finance-co-id'),
  };
}

/**
 * Mark a JE as "previously posted" so the next call hits the idempotency
 * branch.
 */
export function seedExistingJournalEntry(
  state: MockPrismaState,
  flow: string,
  idempotencyKey: string,
  id = 'existing-je',
  entryNumber = 'JE-EXISTING',
  metadata?: unknown,
): void {
  state.entries.set(`${flow}:${idempotencyKey}`, { id, entryNumber, metadata });
}

/**
 * Mark a JE as "previously posted by batchId" — used by inventory-transfer
 * which probes the revenue leg via batchId after finding the COGS leg.
 */
export function seedExistingJournalEntryByBatch(
  state: MockPrismaState,
  batchId: string,
  id: string,
  entryNumber: string,
): void {
  state.entries.set(`batchId:${batchId}`, { id, entryNumber });
}
