import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { AuditService } from './audit.service';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs');

describe('AuditService — Merkle hash chain (T2-C4 ext)', () => {
  let service: AuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // Helper to compute expected hash with same layout as service
  const hash = (args: {
    sequenceNumber: bigint;
    id: string;
    userId: string;
    action: string;
    entity: string;
    entityId: string;
    oldValue: unknown;
    newValue: unknown;
    createdAt: Date;
    prevRowHash: string | null;
  }): string => {
    const payload = [
      args.sequenceNumber.toString(),
      args.id,
      args.userId,
      args.action,
      args.entity,
      args.entityId,
      JSON.stringify(args.oldValue ?? null),
      JSON.stringify(args.newValue ?? null),
      args.createdAt.toISOString(),
      args.prevRowHash ?? '',
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn(),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AuditService);
  });

  describe('computeRowHash', () => {
    it('produces identical output for identical input', () => {
      const args = {
        sequenceNumber: 1n,
        id: 'aud-1',
        userId: 'u-1',
        action: 'CREATE',
        entity: 'Contract',
        entityId: 'c-1',
        oldValue: null,
        newValue: { status: 'ACTIVE' },
        createdAt: new Date('2026-04-19T00:00:00Z'),
        prevRowHash: null,
      };
      expect(service.computeRowHash(args)).toBe(service.computeRowHash(args));
    });

    it('produces different hash when any field changes', () => {
      const base = {
        sequenceNumber: 1n,
        id: 'aud-1',
        userId: 'u-1',
        action: 'CREATE',
        entity: 'Contract',
        entityId: 'c-1',
        oldValue: null,
        newValue: { status: 'ACTIVE' },
        createdAt: new Date('2026-04-19T00:00:00Z'),
        prevRowHash: null,
      };
      const a = service.computeRowHash(base);
      const b = service.computeRowHash({ ...base, action: 'UPDATE' });
      expect(a).not.toBe(b);
    });

    it('prevRowHash propagates — changing prev changes current', () => {
      const base = {
        sequenceNumber: 2n,
        id: 'aud-2',
        userId: 'u-1',
        action: 'CREATE',
        entity: 'Contract',
        entityId: 'c-1',
        oldValue: null,
        newValue: {},
        createdAt: new Date(),
        prevRowHash: 'aaa',
      };
      const a = service.computeRowHash(base);
      const b = service.computeRowHash({ ...base, prevRowHash: 'bbb' });
      expect(a).not.toBe(b);
    });
  });

  describe('verifyChain', () => {
    const buildRow = (
      seq: bigint,
      prevHash: string | null,
      overrides: Record<string, unknown> = {},
    ) => {
      const base = {
        id: `aud-${seq}`,
        userId: 'u-1',
        action: 'CREATE',
        entity: 'Contract',
        entityId: `c-${seq}`,
        oldValue: null,
        newValue: { status: 'ACTIVE' },
        createdAt: new Date(`2026-04-${String(seq + 10n).padStart(2, '0')}T00:00:00Z`),
        sequenceNumber: seq,
        prevRowHash: prevHash,
        ...overrides,
      };
      const rowHash = hash({
        sequenceNumber: base.sequenceNumber,
        id: base.id,
        userId: base.userId,
        action: base.action,
        entity: base.entity,
        entityId: base.entityId,
        oldValue: base.oldValue,
        newValue: base.newValue,
        createdAt: base.createdAt,
        prevRowHash: base.prevRowHash,
      });
      return { ...base, rowHash };
    };

    it('returns ok=true for an intact chain of 3 rows', async () => {
      const row1 = buildRow(1n, null);
      const row2 = buildRow(2n, row1.rowHash);
      const row3 = buildRow(3n, row2.rowHash);
      prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(true);
      expect(result.rowsChecked).toBe(3);
    });

    it('detects tampered row — action changed after write', async () => {
      const row1 = buildRow(1n, null);
      const row2 = buildRow(2n, row1.rowHash);
      const row3 = buildRow(3n, row2.rowHash);
      // Attacker edits action on row2 without updating hash
      const tampered = { ...row2, action: 'DELETE' };
      prisma.auditLog.findMany.mockResolvedValue([row1, tampered, row3]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.firstMismatchSeq).toBe(2n);
    });

    it('detects broken prev linkage', async () => {
      const row1 = buildRow(1n, null);
      const row2 = buildRow(2n, row1.rowHash);
      const row3 = buildRow(3n, 'fake-hash'); // should be row2.rowHash
      prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.firstMismatchSeq).toBe(3n);
    });

    it('returns ok=true for empty chain', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      const result = await service.verifyChain();
      expect(result.ok).toBe(true);
      expect(result.rowsChecked).toBe(0);
    });
  });
});

describe('AuditService.log — write-failure resilience (Wave-1 #13)', () => {
  let service: AuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { $transaction: jest.fn() };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AuditService);
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('alerts Sentry + resolves (never throws) when the audit write fails', async () => {
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(
      service.log({ userId: 'u-1', action: 'CREATE', entity: 'Contract', entityId: 'c-1' }),
    ).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ subsystem: 'audit', action: 'CREATE' }) }),
    );
  });

  it('does NOT alert Sentry on the happy path (write succeeds)', async () => {
    prisma.$transaction.mockResolvedValue(undefined);

    await service.log({ userId: 'u-1', action: 'CREATE', entity: 'Contract', entityId: 'c-1' });

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
