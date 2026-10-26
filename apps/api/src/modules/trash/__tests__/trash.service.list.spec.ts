import { BadRequestException } from '@nestjs/common';
import { TrashService } from '../trash.service';
import { DELETE_AUDIT_ACTIONS } from '../trash-registry';

/** ก้อน 8 A10 — list รวมหลายโมเดล + "ลบโดย" จาก AuditLog (สเปก §5–§6, §13.3, §13.7) */
const NOW = new Date('2026-10-26T03:00:00.000Z');
const DAY = 24 * 3600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
const mkDelegate = (): AnyDelegate => ({
  findMany: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
  findUnique: jest.fn().mockResolvedValue(null),
  update: jest.fn().mockResolvedValue({}),
});

function makePrisma(overrides: Record<string, Partial<AnyDelegate>> = {}) {
  const delegates = new Map<string, AnyDelegate>();
  const auditLog = { findMany: jest.fn().mockResolvedValue([]) };
  const base: Record<string, unknown> = { auditLog };
  const prisma = new Proxy(base, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!delegates.has(key)) delegates.set(key, { ...mkDelegate(), ...(overrides[key] ?? {}) } as AnyDelegate);
      return delegates.get(key);
    },
  });
  return { prisma: prisma as never, auditLog, delegate: (k: string) => (prisma as never as Record<string, AnyDelegate>)[k] };
}

const service = (prisma: never) => new TrashService(prisma, {} as never, { get: () => undefined } as never);

describe('TrashService.list / listTypes', () => {
  it('TS1 single type: 90-day window, extraWhere, search OR, DB pagination, total from count', async () => {
    const { prisma, delegate } = makePrisma({ customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: 'สมหญิง', phone: '0812345678', deletedAt: NOW }]), count: jest.fn().mockResolvedValue(51) } });
    const result = await service(prisma).list({ type: 'customer', q: 'สม', days: 90, page: 2, pageSize: 50 }, NOW);
    const args = delegate('customer').findMany.mock.calls[0][0];
    expect(args.where.deletedAt).toEqual({ gte: new Date(NOW.getTime() - 90 * DAY) });
    expect(args.where.mergedIntoId).toBeNull();
    expect(args.where.OR).toEqual(expect.arrayContaining([{ name: { contains: 'สม', mode: 'insensitive' } }]));
    expect(args).toMatchObject({ skip: 50, take: 50, orderBy: { deletedAt: 'desc' } });
    expect(delegate('customer').count.mock.calls[0][0].where).toEqual(args.where);
    expect(result).toMatchObject({ total: 51, page: 2, pageSize: 50, capped: false });
    expect(result.data[0]).toMatchObject({ type: 'customer', typeLabel: 'ลูกค้า / ผู้สนใจ', id: 'c1', title: 'สมหญิง', restorable: true, link: '/customers/c1' });
    expect(result.data[0].subtitle).not.toContain('0812345678');
  });

  it('TS2 all types: ≤50 per type merged newest-first, capped flag, total = sum of counts', async () => {
    const { prisma } = makePrisma({
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: 'A', deletedAt: new Date(NOW.getTime() - 1 * DAY) }, { id: 'c2', name: 'B', deletedAt: new Date(NOW.getTime() - 3 * DAY) }]), count: jest.fn().mockResolvedValue(2) },
      booking: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', bookingNumber: 'BK-1', deletedAt: new Date(NOW.getTime() - 2 * DAY) }, { id: 'b2', bookingNumber: 'BK-2', deletedAt: new Date(NOW.getTime() - 4 * DAY) }]), count: jest.fn().mockResolvedValue(2) },
    });
    const result = await service(prisma).list({ days: 90, page: 1, pageSize: 50 }, NOW);
    expect(result.data.map((r) => r.id)).toEqual(['c1', 'b1', 'c2', 'b2']);
    expect(result).toMatchObject({ total: 4, capped: true });
  });

  it('TS2b capped total = Σ min(count, 50) so the last page is never empty', async () => {
    const { prisma } = makePrisma({ customer: { count: jest.fn().mockResolvedValue(80) }, booking: { count: jest.fn().mockResolvedValue(2) } });
    const result = await service(prisma).list({ days: 90, page: 1, pageSize: 50 }, NOW);
    expect(result.total).toBe(52);
  });

  it('TS6 a type with no searchFields returns nothing when searching (never leaks every row)', async () => {
    const { prisma, delegate } = makePrisma({ gfinRateFactor: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', months: 12, deletedAt: NOW }]), count: jest.fn().mockResolvedValue(1) } });
    const result = await service(prisma).list({ type: 'gfin_rate_factor', q: '12', days: 0, page: 1, pageSize: 50 }, NOW);
    expect(result.data).toEqual([]);
    expect(delegate('gfinRateFactor').findMany).not.toHaveBeenCalled();
  });

  it('TS3b an expense draft retired by the system (audit newValue.reason) is listed but not restorable', async () => {
    const { prisma, auditLog } = makePrisma({ expenseDocument: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', number: 'EX-1', status: 'DRAFT', deletedAt: NOW }]), count: jest.fn().mockResolvedValue(1) } });
    auditLog.findMany.mockResolvedValue([{ entityId: 'e1', createdAt: NOW, newValue: { reason: 'SKIPPED' }, user: { id: 'u-ek', name: 'เอก', isSystemUser: false } }]);
    const [row] = (await service(prisma).list({ type: 'expense_document', days: 0, page: 1, pageSize: 50 }, NOW)).data;
    expect(row.deletedBy).toMatchObject({ name: 'เอก' });
    expect(row.restorable).toBe(false);
    expect(row.reason).toMatch(/บิลประจำ/);
  });

  it('TS3 deletedBy: nearest DELETE audit within 10 min, by (entity, entityId); none → null; system user → not restorable', async () => {
    const { prisma, auditLog } = makePrisma({
      expenseDocument: { findMany: jest.fn().mockResolvedValue([
        { id: 'e1', number: 'EX-1', status: 'DRAFT', deletedAt: NOW },
        { id: 'e2', number: 'EX-2', status: 'DRAFT', deletedAt: NOW },
        { id: 'e3', number: 'EX-3', status: 'DRAFT', deletedAt: NOW },
      ]), count: jest.fn().mockResolvedValue(3) },
    });
    auditLog.findMany.mockResolvedValue([
      { entityId: 'e1', createdAt: new Date(NOW.getTime() + 3 * 3600_000), user: { id: 'u-old', name: 'คนเก่า', isSystemUser: false } },
      { entityId: 'e1', createdAt: new Date(NOW.getTime() + 2 * 60_000), user: { id: 'u-ek', name: 'เอก', isSystemUser: false } },
      { entityId: 'e3', createdAt: new Date(NOW.getTime() + 1000), user: { id: 'u-sys', name: 'SYSTEM', isSystemUser: true } },
    ]);
    const result = await service(prisma).list({ type: 'expense_document', days: 0, page: 1, pageSize: 50 }, NOW);
    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.action).toEqual({ in: DELETE_AUDIT_ACTIONS });
    expect(JSON.stringify(where)).toContain('expense-documents');
    expect(JSON.stringify(where)).toContain('"e1"');
    const [r1, r2, r3] = result.data;
    expect(r1.deletedBy).toEqual({ id: 'u-ek', name: 'เอก', system: false });
    expect(r2.deletedBy).toBeNull();
    expect(r2.restorable).toBe(true);
    expect(r3.deletedBy).toMatchObject({ system: true });
    expect(r3.restorable).toBe(false);
    expect(r3.reason).toMatch(/ระบบลบเอง/);
  });

  it('TS4 listTypes(0): counts every entry with deletedAt not null + extraWhere', async () => {
    const { prisma, delegate } = makePrisma({ customer: { count: jest.fn().mockResolvedValue(7) } });
    const types = await service(prisma).listTypes(0, NOW);
    expect(delegate('customer').count.mock.calls[0][0].where).toEqual({ deletedAt: { not: null }, mergedIntoId: null });
    const customer = types.find((t) => t.type === 'customer');
    expect(customer).toMatchObject({ label: 'ลูกค้า / ผู้สนใจ', group: 'ลูกค้าและการขาย', count: 7, restorable: true });
    expect(types.find((t) => t.type === 'product')).toMatchObject({ restorable: false });
    expect(types.length).toBeGreaterThanOrEqual(30);
  });

  it('TS5 unknown type → 400 ภาษาไทย', async () => {
    const { prisma } = makePrisma();
    await expect(service(prisma).list({ type: 'nope', days: 90, page: 1, pageSize: 50 }, NOW)).rejects.toThrow(BadRequestException);
  });
});
