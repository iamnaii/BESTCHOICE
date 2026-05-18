import { BadRequestException, ConflictException } from '@nestjs/common';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
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
  references?: unknown;
  referencesEncrypted?: unknown;
  [k: string]: unknown;
}

function makePrismaMock(opts: {
  rows?: FakeRow[];
  totalCustomers?: number;
  plaintextCount?: number;
  lockAcquired?: boolean;
  systemConfigValue?: string | null;
}) {
  let rows = (opts.rows ?? []).map((r) => ({ ...r }));
  const runRows: Array<Record<string, unknown>> = [];

  return {
    customer: {
      count: jest.fn().mockImplementation((args: { where?: { AND?: unknown } } = {}) => {
        // The plaintext-count query has the AND filter; the all-customers
        // query doesn't. Use that to differentiate.
        if (args.where && (args.where as { AND?: unknown }).AND) {
          return Promise.resolve(opts.plaintextCount ?? rows.filter((r) => r.nationalIdEncrypted === null && r.nationalId).length);
        }
        return Promise.resolve(opts.totalCustomers ?? rows.length);
      }),
      findMany: jest.fn().mockImplementation((args: { cursor?: { id: string }; take?: number } = {}) => {
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
    },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(
        opts.systemConfigValue !== undefined ? { value: opts.systemConfigValue } : null,
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
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
  const svc = new PdpaEncryptionService(prisma, piiService);
  return { svc, piiService };
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
    it('reports totalCustomers, encryptedCount, plaintextCount, readyForStrictMode', async () => {
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 5 });
      const { svc } = makeService(prisma);
      const status = await svc.getStatus();
      expect(status.totalCustomers).toBe(100);
      expect(status.plaintextCount).toBe(5);
      expect(status.encryptedCount).toBe(95);
      expect(status.readyForStrictMode).toBe(false);
      expect(status.encryptionKeyConfigured).toBe(true);
      expect(status.hashSaltConfigured).toBe(true);
    });

    it('readyForStrictMode true when plaintextCount is 0', async () => {
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 0 });
      const { svc } = makeService(prisma);
      const status = await svc.getStatus();
      expect(status.readyForStrictMode).toBe(true);
    });
  });

  describe('setStrictMode', () => {
    it('refuses to enable when plaintext rows still exist', async () => {
      const prisma = makePrismaMock({ totalCustomers: 100, plaintextCount: 3 });
      const { svc } = makeService(prisma);
      await expect(svc.setStrictMode(true)).rejects.toThrow(BadRequestException);
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
      // Sanity-check the rows got written
      const c1 = (prisma as unknown as { _rows: FakeRow[] })._rows.find((r) => r.id === 'c1')!;
      expect(c1.nationalIdEncrypted).toMatch(/^[a-f0-9]{32}:/);
      expect(c1.phoneHash).toMatch(/^[a-f0-9]{64}$/);
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
  });
});
