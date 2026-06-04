import { BadRequestException, ConflictException } from '@nestjs/common';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const TEST_KEY = 'a'.repeat(64);
const TEST_SALT = 'b'.repeat(48);

interface FakeRow {
  id: string;
  nationalId: string | null;
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  phone: string | null;
  phoneEncrypted: string | null;
  phoneHash: string | null;
  phoneSecondary?: string | null;
  phoneSecondaryEncrypted?: string | null;
  email?: string | null;
  emailEncrypted?: string | null;
  addressIdCard?: string | null;
  addressIdCardEncrypted?: string | null;
  addressCurrent?: string | null;
  addressCurrentEncrypted?: string | null;
  addressWork?: string | null;
  addressWorkEncrypted?: string | null;
  guardianNationalId?: string | null;
  guardianNationalIdEncrypted?: string | null;
  guardianPhone?: string | null;
  guardianPhoneEncrypted?: string | null;
  guardianAddress?: string | null;
  guardianAddressEncrypted?: string | null;
  references?: unknown;
  referencesEncrypted?: unknown;
  [k: string]: unknown;
}

function makePrismaMock(opts: {
  rows?: FakeRow[];
  totalCustomers?: number;
  plaintextCount?: number;
  /** Per-column count overrides for getPlaintextCountsByColumn. Keyed by plaintext column name. */
  perColumnCounts?: Record<string, number>;
  lockAcquired?: boolean;
  systemConfigValue?: string | null;
  /** Concurrent-writer count for W9 race tests — number of new
   *  plaintext rows that "appear" after the main loop's first pass. */
  raceRemaining?: number;
}) {
  const rows = (opts.rows ?? []).map((r) => ({ ...r }));
  const runRows: Array<Record<string, unknown>> = [];
  let countCallSinceFindMany = 0;
  // For W9 retry: after the main loop finishes (lots of findMany calls),
  // the first subsequent count() returns raceRemaining > 0 to simulate
  // concurrent writers. Subsequent count() calls return 0 (or
  // continueRaceForever).
  let racePollIdx = 0;

  function isPlaintextWhere(where: unknown): boolean {
    // Heuristic: any where with OR conditions is a "plaintext count" query.
    return Boolean(where && (where as { OR?: unknown }).OR);
  }
  function isPerColumnWhere(where: unknown): { column: string } | null {
    // Per-column counts use AND: [{ <plain>: { not: '' } }, { <plain>: { not: null } }, { <enc>: null }].
    if (!where || !(where as { AND?: unknown }).AND) return null;
    const and = (where as { AND: Array<Record<string, unknown>> }).AND;
    const plainKey = Object.keys(and[0] ?? {})[0];
    return plainKey ? { column: plainKey } : null;
  }

  return {
    customer: {
      count: jest.fn().mockImplementation((args: { where?: unknown } = {}) => {
        const where = args.where;
        if (!where || (Object.keys(where).length === 1 && (where as { deletedAt?: unknown }).deletedAt !== undefined)) {
          return Promise.resolve(opts.totalCustomers ?? rows.length);
        }
        const perCol = isPerColumnWhere(where);
        if (perCol) {
          if (opts.perColumnCounts && opts.perColumnCounts[perCol.column] !== undefined) {
            return Promise.resolve(opts.perColumnCounts[perCol.column]);
          }
          if (perCol.column === 'nationalId') {
            return Promise.resolve(rows.filter((r) => r.nationalIdEncrypted === null && r.nationalId).length);
          }
          return Promise.resolve(0);
        }
        if (isPlaintextWhere(where)) {
          // W9: after main loop iterations, simulate race by returning > 0 once.
          if (opts.raceRemaining !== undefined && countCallSinceFindMany > 0) {
            if (racePollIdx === 0) {
              racePollIdx++;
              return Promise.resolve(opts.raceRemaining);
            }
            return Promise.resolve(0);
          }
          if (opts.plaintextCount !== undefined) return Promise.resolve(opts.plaintextCount);
          return Promise.resolve(rows.filter((r) => r.nationalIdEncrypted === null && r.nationalId).length);
        }
        return Promise.resolve(opts.totalCustomers ?? rows.length);
      }),
      findMany: jest.fn().mockImplementation((args: { cursor?: { id: string }; take?: number } = {}) => {
        countCallSinceFindMany++;
        const sorted = rows
          .filter((r) => r.nationalIdEncrypted === null && r.nationalId)
          .sort((a, b) => a.id.localeCompare(b.id));
        const start = args.cursor ? sorted.findIndex((r) => r.id === args.cursor!.id) + 1 : 0;
        return Promise.resolve(sorted.slice(start, start + (args.take ?? 100)));
      }),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
    pdpaBackfillRun: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        const row = { id: `run-${runRows.length + 1}`, ...args.data };
        runRows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = runRows.find((r) => r.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(
        opts.systemConfigValue !== undefined ? { value: opts.systemConfigValue } : null,
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'system-user-uuid' }),
    },
    $transaction: jest.fn().mockImplementation(async (queries: Array<Promise<unknown>>) => {
      // Sequentially resolve the array of pre-issued promises (Prisma's
      // batch transaction signature). This mirrors the real behaviour
      // closely enough to verify atomicity wiring.
      return Promise.all(queries);
    }),
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray | string) => {
      const sql = Array.isArray(strings) ? (strings as TemplateStringsArray).join('?') : String(strings);
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve([{ acquired: opts.lockAcquired ?? true }]);
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve([{ pg_advisory_unlock: true }]);
      }
      return Promise.resolve([]);
    }),
    // expose for assertion
    _rows: rows,
    _runRows: runRows,
  } as unknown as PrismaService & { _rows: FakeRow[]; _runRows: Array<Record<string, unknown>> };
}

function makeService(prisma: PrismaService) {
  const piiService = new CustomerPiiService(prisma);
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new PdpaEncryptionService(prisma, piiService, audit);
  return { svc, piiService, audit };
}

describe('PdpaEncryptionService', () => {
  let origKey: string | undefined;
  let origSalt: string | undefined;

  beforeEach(() => {
    origKey = process.env.PII_ENCRYPTION_KEY;
    origSalt = process.env.PII_HASH_SALT;
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
    process.env.PII_HASH_SALT = TEST_SALT;
    delete process.env.PDPA_STRICT_MODE;
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = origKey;
    if (origSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = origSalt;
  });

  describe('getStatus', () => {
    it('reports totalCustomers, encryptedCount, plaintextCount, readyForStrictMode + per-column breakdown (W3)', async () => {
      const prisma = makePrismaMock({
        totalCustomers: 100,
        plaintextCount: 5,
        perColumnCounts: { nationalId: 3, phone: 4, email: 2 },
      });
      const { svc } = makeService(prisma);
      const status = await svc.getStatus();
      expect(status.totalCustomers).toBe(100);
      expect(status.plaintextCount).toBe(5);
      expect(status.encryptedCount).toBe(95);
      expect(status.readyForStrictMode).toBe(false);
      expect(status.encryptionKeyConfigured).toBe(true);
      expect(status.hashSaltConfigured).toBe(true);
      // Per-column breakdown should include every PII_COLUMN.
      expect(status.plaintextByColumn.length).toBe(10);
      const byCol = Object.fromEntries(status.plaintextByColumn.map((c) => [c.column, c.plaintextCount]));
      expect(byCol.nationalId).toBe(3);
      expect(byCol.phone).toBe(4);
      expect(byCol.email).toBe(2);
    });

    it('readyForStrictMode true when plaintextCount is 0', async () => {
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 0 });
      const { svc } = makeService(prisma);
      const status = await svc.getStatus();
      expect(status.readyForStrictMode).toBe(true);
    });
  });

  describe('setStrictMode', () => {
    it('refuses to enable when plaintext rows still exist on ANY PII column (W4)', async () => {
      const prisma = makePrismaMock({
        totalCustomers: 100,
        plaintextCount: 3,
        perColumnCounts: { phone: 2, email: 1 },
      });
      const { svc } = makeService(prisma);
      await expect(svc.setStrictMode(true)).rejects.toThrow(BadRequestException);
      // Error message should name the offending columns.
      await expect(svc.setStrictMode(true)).rejects.toThrow(/phone|email/);
    });

    it('refuses to enable when PII_ENCRYPTION_KEY missing', async () => {
      delete process.env.PII_ENCRYPTION_KEY;
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 0 });
      const { svc } = makeService(prisma);
      await expect(svc.setStrictMode(true)).rejects.toThrow(BadRequestException);
    });

    it('enables when all rows are encrypted', async () => {
      const prisma = makePrismaMock({ totalCustomers: 50, plaintextCount: 0 });
      const { svc } = makeService(prisma);
      await expect(svc.setStrictMode(true)).resolves.toEqual({ strictMode: true });
    });

    it('disables without preflight checks', async () => {
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 99 });
      const { svc } = makeService(prisma);
      await expect(svc.setStrictMode(false)).resolves.toEqual({ strictMode: false });
    });
  });

  describe('runBackfill', () => {
    it('throws ConflictException when advisory lock already held', async () => {
      const prisma = makePrismaMock({ lockAcquired: false });
      const { svc } = makeService(prisma);
      await expect(svc.runBackfill({ triggeredBy: 'cli' })).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when key/salt missing', async () => {
      delete process.env.PII_ENCRYPTION_KEY;
      const prisma = makePrismaMock({});
      const { svc } = makeService(prisma);
      await expect(svc.runBackfill({ triggeredBy: 'cli' })).rejects.toThrow(BadRequestException);
    });

    it('encrypts plaintext rows and reports processed count', async () => {
      const rows: FakeRow[] = [
        {
          id: 'c1',
          nationalId: '1234567890123',
          nationalIdEncrypted: null,
          nationalIdHash: null,
          phone: '0812345678',
          phoneEncrypted: null,
          phoneHash: null,
        },
        {
          id: 'c2',
          nationalId: '9876543210987',
          nationalIdEncrypted: null,
          nationalIdHash: null,
          phone: '0898765432',
          phoneEncrypted: null,
          phoneHash: null,
        },
      ];
      const prisma = makePrismaMock({ rows, totalCustomers: 2 });
      const { svc } = makeService(prisma);
      const result = await svc.runBackfill({ triggeredBy: 'cli', batchSize: 50 });
      expect(result.status).toBe('COMPLETED');
      expect(result.processedRecords).toBe(2);
      expect(result.skippedRecords).toBe(0);
      // Sanity-check the rows got written — GCM 3-part format.
      const c1 = (prisma as unknown as { _rows: FakeRow[] })._rows.find((r) => r.id === 'c1')!;
      expect(c1.nationalIdEncrypted).toMatch(/^[a-f0-9]{24}:[a-f0-9]{32}:/);
      expect(c1.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('uses $transaction to commit batch writes + counter atomically (W5)', async () => {
      const rows: FakeRow[] = [
        {
          id: 'c1',
          nationalId: '1234567890123',
          nationalIdEncrypted: null,
          nationalIdHash: null,
          phone: '0812345678',
          phoneEncrypted: null,
          phoneHash: null,
        },
      ];
      const prisma = makePrismaMock({ rows, totalCustomers: 1 });
      const { svc } = makeService(prisma);
      await svc.runBackfill({ triggeredBy: 'cli' });
      // The batch tx should have been called — one $transaction per batch.
      expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalled();
    });

    it('is idempotent — already-encrypted rows are skipped', async () => {
      const rows: FakeRow[] = [
        {
          id: 'c1',
          nationalId: '1234567890123',
          nationalIdEncrypted: 'abcdef0123456789abcdef0123456789:dead',
          nationalIdHash: 'a'.repeat(64),
          phone: '0812345678',
          phoneEncrypted: 'abcdef0123456789abcdef0123456789:beef',
          phoneHash: 'b'.repeat(64),
        },
      ];
      // findMany filter requires nationalIdEncrypted === null — the mock
      // returns 0 rows for already-encrypted, so the loop simply exits.
      const prisma = makePrismaMock({ rows, totalCustomers: 1, plaintextCount: 0 });
      const { svc } = makeService(prisma);
      const result = await svc.runBackfill({ triggeredBy: 'cli' });
      expect(result.status).toBe('COMPLETED');
      expect(result.processedRecords).toBe(0);
    });

    it('emits per-batch progress callbacks', async () => {
      const rows: FakeRow[] = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        nationalId: '1234567890123',
        nationalIdEncrypted: null,
        nationalIdHash: null,
        phone: '0812345678',
        phoneEncrypted: null,
        phoneHash: null,
      }));
      const prisma = makePrismaMock({ rows, totalCustomers: 5 });
      const { svc } = makeService(prisma);
      const progress: Array<{ processed: number; total: number }> = [];
      const result = await svc.runBackfill({
        triggeredBy: 'cli',
        batchSize: 2,
        onProgress: (p) => progress.push({ processed: p.processed, total: p.total }),
      });
      expect(result.status).toBe('COMPLETED');
      expect(result.processedRecords).toBe(5);
      // 5 rows / 2 per batch = 3 batches → 3 progress events
      expect(progress.length).toBe(3);
      expect(progress[progress.length - 1].processed).toBe(5);
    });

    it('writes PDPA_BACKFILL_RUN audit log from CLI path using SYSTEM user (W7)', async () => {
      const prisma = makePrismaMock({ totalCustomers: 0, plaintextCount: 0 });
      const { svc, audit } = makeService(prisma);
      await svc.runBackfill({ triggeredBy: 'cli', triggeredByUserId: null });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'system-user-uuid',
          action: 'PDPA_BACKFILL_RUN',
          entity: 'pdpa_backfill_run',
        }),
      );
    });

    it('writes PDPA_BACKFILL_RUN audit log from UI path using OWNER userId + ip + UA (W6, W7)', async () => {
      const prisma = makePrismaMock({ totalCustomers: 0, plaintextCount: 0 });
      const { svc, audit } = makeService(prisma);
      await svc.runBackfill({
        triggeredBy: 'manual',
        triggeredByUserId: 'owner-uuid',
        ipAddress: '10.1.2.3',
        userAgent: 'TestAgent/1.0',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-uuid',
          action: 'PDPA_BACKFILL_RUN',
          entity: 'pdpa_backfill_run',
          ipAddress: '10.1.2.3',
          userAgent: 'TestAgent/1.0',
        }),
      );
    });
  });

  describe('pruneOldRuns (W2 retention)', () => {
    it('delegates to prisma.pdpaBackfillRun.deleteMany with a cutoff date', async () => {
      const prisma = makePrismaMock({});
      const deleteMany = (prisma as unknown as { pdpaBackfillRun: { deleteMany: jest.Mock } })
        .pdpaBackfillRun.deleteMany;
      deleteMany.mockResolvedValue({ count: 7 });
      const { svc } = makeService(prisma);
      const count = await svc.pruneOldRuns(365);
      expect(count).toBe(7);
      expect(deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { startedAt: { lt: expect.any(Date) } },
        }),
      );
    });

    it('returns 0 for invalid retention windows', async () => {
      const prisma = makePrismaMock({});
      const { svc } = makeService(prisma);
      await expect(svc.pruneOldRuns(0)).resolves.toBe(0);
      await expect(svc.pruneOldRuns(-1)).resolves.toBe(0);
      await expect(svc.pruneOldRuns(NaN)).resolves.toBe(0);
    });
  });
});
