import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { TrashService } from '../trash.service';
import { RESTORE_AUDIT_ACTION, TRASH_REGISTRY, trashEntry } from '../trash-registry';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 8 A10 — กู้คืน: ตรวจ → update ใน tx → afterRestore นอก tx → audit หลัง commit (สเปก §6, §13.3) */
const NOW = new Date('2026-10-26T03:00:00.000Z');
const ACTOR = { id: 'u-owner' };

type Delegate = { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock; count: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
const mkDelegate = (): Delegate => ({
  findUnique: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue({}),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  findMany: jest.fn().mockResolvedValue([]),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
});

function harness(overrides: Record<string, Partial<Delegate>> = {}) {
  const delegates = new Map<string, Delegate>();
  const calls: string[] = [];
  const auditLog = { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = new Proxy({ auditLog, $executeRaw: jest.fn().mockResolvedValue(1) }, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      if (!delegates.has(key)) delegates.set(key, { ...mkDelegate(), ...(overrides[key] ?? {}) } as Delegate);
      return delegates.get(key);
    },
  });
  const prisma = new Proxy({ auditLog, $transaction: jest.fn(async (fn: (t: unknown) => unknown) => { calls.push('tx:start'); const out = await fn(tx); calls.push('tx:end'); return out; }), chatRoom: { count: jest.fn().mockResolvedValue(1) } }, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      return tx[key];
    },
  });
  const audit = { log: jest.fn(async () => { calls.push('audit'); }) };
  const moduleRef = { get: jest.fn(() => undefined) };
  const service = new TrashService(prisma as never, audit as never, moduleRef as never);
  return { service, prisma, tx, audit, auditLog, calls, delegate: (k: string) => tx[k] as Delegate };
}

describe('TrashService.restore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('TR1 unknown type → 400', async () => {
    const { service } = harness();
    await expect(service.restore('nope', 'x', ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('TR2 product is not directly restorable → 400 with the FOUND link, no transaction', async () => {
    const { service, prisma, delegate } = harness({ product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', imeiSerial: '35x', deletedAt: NOW }) } });
    const err = await service.restore('product', 'p1', ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ actionLabel: 'ขอพบของคืน', link: '/stock/adjustments?request=found&q=35x' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(delegate('product').update).not.toHaveBeenCalled();
  });

  it('TR3 row not deleted (or already restored) → 404', async () => {
    const { service } = harness({ promotion: { findUnique: jest.fn().mockResolvedValue({ id: 'pr1', name: 'x', deletedAt: null }) } });
    await expect(service.restore('promotion', 'pr1', ACTOR)).rejects.toThrow(NotFoundException);
  });

  it('TR4 generic restore writes only deletedAt:null and returns the registry warnings', async () => {
    const { service, delegate } = harness({ notificationTemplate: { findUnique: jest.fn().mockResolvedValue({ id: 'nt1', eventType: 'X', name: 'x', deletedAt: NOW }) } });
    const result = await service.restore('notification_template', 'nt1', ACTOR);
    expect(delegate('notificationTemplate').update).toHaveBeenCalledWith({ where: { id: 'nt1' }, data: { deletedAt: null } });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('ยังปิดใช้งาน'))).toBe(true);
  });

  it('TR5 audit RESTORED is written through AuditService after the transaction, never via tx.auditLog', async () => {
    const { service, audit, auditLog, calls } = harness({ promotion: { findUnique: jest.fn().mockResolvedValue({ id: 'pr1', name: 'โปร', deletedAt: NOW }) } });
    await service.restore('promotion', 'pr1', ACTOR);
    expect(calls).toEqual(['tx:start', 'tx:end', 'audit']);
    expect(auditLog.create).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: RESTORE_AUDIT_ACTION, entity: 'promotion', entityId: 'pr1', userId: 'u-owner', oldValue: { deletedAt: NOW.toISOString() } }));
  });

  it('TR6 unique violation that slipped past the pre-check → 409 ภาษาไทย', async () => {
    const { service } = harness({ promotion: { findUnique: jest.fn().mockResolvedValue({ id: 'pr1', name: 'โปร', deletedAt: NOW }), update: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })) } });
    await expect(service.restore('promotion', 'pr1', ACTOR)).rejects.toThrow(ConflictException);
  });

  it('TR7 bulk restores one by one and keeps going after a failure', async () => {
    const { service } = harness({
      promotion: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === 'bad' ? { id: 'bad', name: 'x', deletedAt: null } : { id: where.id, name: 'ok', deletedAt: NOW })) },
    });
    const { results } = await service.restoreMany([{ type: 'promotion', id: 'a' }, { type: 'promotion', id: 'bad' }, { type: 'promotion', id: 'c' }], ACTOR);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toMatch(/ไม่พบ/);
  });

  it('TR8 afterRestore failure becomes a warning + Sentry, not an error', async () => {
    const entry = trashEntry('promotion')!;
    const original = entry.afterRestore;
    (entry as { afterRestore?: unknown }).afterRestore = jest.fn().mockRejectedValue(new Error('cache down'));
    try {
      const { service } = harness({ promotion: { findUnique: jest.fn().mockResolvedValue({ id: 'pr1', name: 'โปร', deletedAt: NOW }) } });
      const result = await service.restore('promotion', 'pr1', ACTOR);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes('ข้อมูลประกอบ'))).toBe(true);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    } finally {
      (entry as { afterRestore?: unknown }).afterRestore = original;
    }
  });

  it('TR10 a row the system user deleted is refused (§13.3)', async () => {
    const { service, auditLog, delegate } = harness({ expenseDocument: { findUnique: jest.fn().mockResolvedValue({ id: 'e1', number: 'EX-1', status: 'DRAFT', deletedAt: NOW }) } });
    auditLog.findMany.mockResolvedValue([{ entityId: 'e1', createdAt: NOW, user: { id: 'u-sys', name: 'SYSTEM', isSystemUser: true } }]);
    await expect(service.restore('expense_document', 'e1', ACTOR)).rejects.toThrow(/ระบบลบเอง/);
    expect(delegate('expenseDocument').update).not.toHaveBeenCalled();
  });

  it('TR11 every restorable entry can be restored through the generic path (smoke)', async () => {
    for (const entry of TRASH_REGISTRY.filter((e) => e.restorable === true && !e.check)) {
      const { service, delegate } = harness({ [entry.model]: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', deletedAt: NOW, roles: [] }) } });
      await service.restore(entry.type, 'r1', ACTOR);
      expect(delegate(entry.model).update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { deletedAt: null } });
    }
  });
});
