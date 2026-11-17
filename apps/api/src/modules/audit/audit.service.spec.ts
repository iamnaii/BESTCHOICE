import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { AuditService } from './audit.service';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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
      AuditService.canonicalJson(args.oldValue ?? null),
      AuditService.canonicalJson(args.newValue ?? null),
      args.createdAt.toISOString(),
      args.prevRowHash ?? '',
    ].join('|');
    return AuditService.HASH_VERSION_PREFIX + createHash('sha256').update(payload).digest('hex');
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn(),
      },
      auditChainAcknowledgedBreak: {
        findMany: jest.fn().mockResolvedValue([]),
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

    it('verifies historical file values as stored without retroactive sanitization', async () => {
      const row = buildRow(1n, null, {
        newValue: { file: 'data:application/pdf;base64,QQ==' },
      });
      prisma.auditLog.findMany.mockResolvedValue([row]);
      expect((await service.verifyChain()).ok).toBe(true);
    });

    it('jsonb เรียง key ใหม่ตอนอ่านกลับ → hash รุ่น 2 ยังตรง (เหตุที่ prod ร้อง broken ทุกคืน)', async () => {
      // ตอนเขียน: key ตามลำดับ DTO · ตอนอ่านจาก jsonb: สั้นก่อน แล้วเรียงไบต์
      const written = { negotiationResult: 'WILL_PAY', result: 'PROMISED', slots: [{ settlementAmount: 5000, settlementDate: '2026-08-23' }] };
      const readBack = { slots: [{ settlementDate: '2026-08-23', settlementAmount: 5000 }], result: 'PROMISED', negotiationResult: 'WILL_PAY' };
      const row1 = buildRow(1n, null, { newValue: written });
      prisma.auditLog.findMany.mockResolvedValue([{ ...row1, newValue: readBack }]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(true);
    });

    it('แถวรุ่น 1 (ไม่มี prefix v2:) นับเป็น legacyUnverifiable ไม่ใช่ mismatch — ไม่ร้อง fatal รายวัน', async () => {
      const legacy = { ...buildRow(1n, null), rowHash: 'deadbeef'.repeat(8) };
      const row2 = buildRow(2n, legacy.rowHash);
      prisma.auditLog.findMany.mockResolvedValue([legacy, row2]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(true);
      expect(result.legacyUnverifiable).toBe(1);
      expect(result.rowsChecked).toBe(2);
    });

    it('seq ข้าม (tx rollback กิน nextval) + prevRowHash=null ตามดีไซน์ → ไม่ใช่ linkage break', async () => {
      const row1 = buildRow(1n, null);
      const row3 = buildRow(3n, null); // seq 2 หายเพราะ rollback → หา prev ไม่เจอ → null
      prisma.auditLog.findMany.mockResolvedValue([row1, row3]);

      const result = await service.verifyChain();
      expect(result.ok).toBe(true);
    });

    describe('acknowledged breaks (audit_chain_acknowledged_breaks)', () => {
      // seq 3 ถูกเขียนแบบ race: prevRowHash=null ทั้งที่ seq 2 มีอยู่ (เหมือน prod seq=3194)
      const buildChain = () => {
        const row1 = buildRow(1n, null);
        const row2 = buildRow(2n, row1.rowHash);
        const row3 = buildRow(3n, null);
        const row4 = buildRow(4n, row3.rowHash);
        const row5 = buildRow(5n, row4.rowHash);
        return { row1, row2, row3, row4, row5 };
      };
      const ackFor = (
        row: { sequenceNumber: bigint; id: string; rowHash: string; prevRowHash: string | null },
        expectedPrevRowHash: string,
        overrides: Record<string, unknown> = {},
      ) => ({
        sequenceNumber: row.sequenceNumber,
        auditLogId: row.id,
        breakType: 'PREV_LINK_MISMATCH',
        expectedPrevRowHash,
        actualPrevRowHash: row.prevRowHash,
        rowHashAtAck: row.rowHash,
        ...overrides,
      });

      it('without an acknowledgement the race break still fails at seq 3 (PREV_LINK)', async () => {
        const { row1, row2, row3, row4 } = buildChain();
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3, row4]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('PREV_LINK');
      });

      it('1) matching acknowledgement → ok=true, verification continues past the break', async () => {
        const { row1, row2, row3, row4, row5 } = buildChain();
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3, row4, row5]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([ackFor(row3, row2.rowHash)]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(true);
        expect(result.rowsChecked).toBe(5);
        expect(result.acknowledgedBreaks).toBe(1);
        expect(result.acknowledgedSeqs).toEqual(['3']);
      });

      it('2) another (unacknowledged) break after the acknowledged one still alerts', async () => {
        const { row1, row2, row3, row4 } = buildChain();
        const row5 = buildRow(5n, null); // race อีกจุด ไม่ได้ acknowledge
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3, row4, row5]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([ackFor(row3, row2.rowHash)]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(5n);
        expect(result.mismatchKind).toBe('PREV_LINK');
        expect(result.acknowledgedSeqs).toEqual(['3']);
      });

      it('3) content of the acknowledged row edited later → still detected (ROW_HASH)', async () => {
        const { row1, row2, row3, row4 } = buildChain();
        const tampered = { ...row3, action: 'DELETE' };
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, tampered, row4]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([ackFor(row3, row2.rowHash)]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('ROW_HASH');
      });

      it('4) rowHash or stored prevRowHash of the acknowledged row changed → ACK_MISMATCH', async () => {
        const { row1, row2, row3, row4 } = buildChain();
        const ack = ackFor(row3, row2.rowHash);

        // rowHash ถูกเขียนใหม่ (เช่น reseal ด้วย prev=fake ให้ hash เนื้อหาผ่าน)
        const resealed = buildRow(3n, 'fake-prev');
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, resealed, row4]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([ack]);
        let result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('ACK_MISMATCH');

        // เฉพาะ prevRowHash ที่เก็บไว้เปลี่ยน
        prisma.auditLog.findMany.mockResolvedValue([
          row1,
          row2,
          { ...row3, prevRowHash: 'other' },
          row4,
        ]);
        result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('ACK_MISMATCH');
      });

      it('5) rowHash of the previous row (seq-1) changed → ACK_MISMATCH', async () => {
        const { row1, row3, row4 } = buildChain();
        // seq 2 ถูก reseal ด้วยเนื้อหาใหม่ → hash ตัวเองผ่าน แต่ไม่ตรง expectedPrevRowHash ที่ ack ไว้
        const originalRow2 = buildRow(2n, row1.rowHash);
        const newRow2 = buildRow(2n, row1.rowHash, { action: 'DELETE' });
        prisma.auditLog.findMany.mockResolvedValue([row1, newRow2, row3, row4]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([
          ackFor(row3, originalRow2.rowHash),
        ]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('ACK_MISMATCH');
      });

      it('6) the row after the acknowledged one must still link to its rowHash', async () => {
        const { row1, row2, row3 } = buildChain();
        const row4 = buildRow(4n, row2.rowHash); // ชี้ข้าม seq 3 → ต้องจับได้
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3, row4]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([ackFor(row3, row2.rowHash)]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(4n);
        expect(result.mismatchKind).toBe('PREV_LINK');
      });

      it('7) acknowledgement for a different row id at the same seq → ACK_MISMATCH', async () => {
        const { row1, row2, row3, row4 } = buildChain();
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3, row4]);
        prisma.auditChainAcknowledgedBreak.findMany.mockResolvedValue([
          ackFor(row3, row2.rowHash, { auditLogId: 'some-other-id' }),
        ]);

        const result = await service.verifyChain();
        expect(result.ok).toBe(false);
        expect(result.firstMismatchSeq).toBe(3n);
        expect(result.mismatchKind).toBe('ACK_MISMATCH');
      });

      it('8) acknowledgement table unreadable → throws (fail closed, never silently ok)', async () => {
        const { row1, row2, row3 } = buildChain();
        prisma.auditLog.findMany.mockResolvedValue([row1, row2, row3]);
        prisma.auditChainAcknowledgedBreak.findMany.mockRejectedValue(
          new Error('relation "audit_chain_acknowledged_breaks" does not exist'),
        );

        await expect(service.verifyChain()).rejects.toThrow('audit_chain_acknowledged_breaks');
      });
    });
  });
});

describe('AuditService.log — sanitize direct writes before sealing the hash', () => {
  const create = jest.fn();
  const findMany = jest.fn();
  const tx = {
    $queryRaw: jest.fn(),
    auditLog: { create },
  };
  const prisma = {
    $transaction: jest.fn(),
    auditLog: { findMany },
    auditChainAcknowledgedBreak: { findMany: jest.fn().mockResolvedValue([]) },
  };
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ nextval: 1n }]);
    create.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    service = new AuditService(prisma as unknown as PrismaService);
  });

  it('masks settings signatures and nested profile data in old/new values and hashes the stored payload', async () => {
    const entry = {
      userId: 'u-1',
      action: 'SYSTEM_CONFIG_UPDATE',
      entity: 'SystemConfig',
      entityId: 'lessor_signature_image',
      oldValue: { key: 'lessor_signature_image', value: 'data:image/png;base64,T0xE' },
      newValue: {
        key: 'lessor_signature_image', value: 'data:image/png;base64,TkVX',
        profiles: [{ avatarUrl: 'data:image/jpeg;base64,QQ==', nationalId: '1234567890123' }],
        documents: [[{ photoBase64: 'SUQtQ0FSRA==' }]],
      },
    };
    const original = JSON.parse(JSON.stringify(entry));
    const compute = jest.spyOn(service, 'computeRowHash');
    await service.log(entry);

    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data;
    expect(row.oldValue).toEqual({ key: 'lessor_signature_image', value: '[FILE_DATA]' });
    expect(row.newValue).toEqual({
      key: 'lessor_signature_image', value: '[FILE_DATA]',
      profiles: [{ avatarUrl: '[FILE_DATA]', nationalId: '[REDACTED]' }],
      documents: [[{ photoBase64: '[FILE_DATA]' }]],
    });
    expect(compute).toHaveBeenCalledWith(expect.objectContaining({
      oldValue: row.oldValue, newValue: row.newValue,
    }));
    expect(entry).toEqual(original);

    // Read back the JSON database shape, then verify the actual stored hash.
    findMany.mockResolvedValue([row]);
    expect(await service.verifyChain()).toMatchObject({ ok: true, rowsChecked: 1 });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('preserves Decimal, Date, null and empty containers using their persisted JSON representation', async () => {
    const newValue = {
      amount: new Prisma.Decimal('1234.50'),
      dueDate: new Date('2026-09-07T00:00:00.000Z'),
      active: false, count: 0, note: '', optional: undefined,
      details: {}, items: [], previous: null,
    };
    await service.log({ userId: 'u-1', action: 'UPDATE', entity: 'payment', newValue });
    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data;
    expect(row.newValue).toEqual({
      amount: '1234.5', dueDate: '2026-09-07T00:00:00.000Z',
      active: false, count: 0, note: '', details: {}, items: [], previous: null,
    });
    expect(newValue.amount).toBeInstanceOf(Prisma.Decimal);
    expect(newValue.dueDate).toBeInstanceOf(Date);
    findMany.mockResolvedValue([{ ...row, oldValue: null }]);
    expect((await service.verifyChain()).ok).toBe(true);
  });

  it('continues storing absent payloads as JSON null and hashing null', async () => {
    const compute = jest.spyOn(service, 'computeRowHash');
    await service.log({ userId: 'u-1', action: 'DELETE', entity: 'file' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      oldValue: Prisma.JsonNull, newValue: Prisma.JsonNull,
    }) });
    expect(compute).toHaveBeenCalledWith(expect.objectContaining({
      oldValue: null, newValue: null,
    }));
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
