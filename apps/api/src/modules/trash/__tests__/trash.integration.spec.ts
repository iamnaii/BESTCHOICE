import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { TrashService } from '../trash.service';

/**
 * ก้อน 8 A10 — ถังขยะรวมบนฐานข้อมูลจริง (สเปก §6, §9): list เห็นแถวที่ลบ · restore คืน `deletedAt` · กู้ซ้ำ 404 ·
 * เบอร์ซ้ำ 409 (ล็อกเบอร์ + ตรวจบน tx) · เลขใบรายจ่ายที่ออกใหม่แล้ว 409 (partial unique) · audit RESTORED อยู่ในสาย Merkle ·
 * "ลบโดย" จาก AuditLog
 * รัน: bash tools/test-db-vitest.sh src/modules/trash/__tests__/trash.integration.spec.ts
 */

const prisma = new PrismaClient();
const audit = new AuditService(prisma as never);
const service = new TrashService(prisma as never, audit, { get: () => undefined } as never);
const stamp = Date.now();
const NOW = new Date();
let ownerId: string;
let branchId: string;

const customer = (name: string, phoneHash: string, deleted: boolean) =>
  prisma.customer.create({ data: { name: `${name} ${stamp}`, phone: `08${String(stamp).slice(-8)}`, phoneHash, deletedAt: deleted ? NOW : null } as never });

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { email: `trash-owner-${stamp}@test.local`, password: 'x', name: 'เจ้าของถังขยะ', role: 'OWNER', isActive: true } })).id;
  branchId = (await prisma.branch.create({ data: { name: `สาขาถังขยะ ${stamp}` } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('trash bin บน Postgres จริง', () => {
  it('I1 + I4: ลูกค้าที่ถูกลบขึ้นในถัง → กู้คืน → กลับมา live · กู้ซ้ำ 404 · audit RESTORED มี rowHash/sequenceNumber', async () => {
    const a = await customer('ลูกค้า A', `h-a-${stamp}`, true);
    const listed = await service.list({ type: 'customer', q: `ลูกค้า A ${stamp}`, days: 90, page: 1, pageSize: 50 }, NOW);
    expect(listed.data.map((r) => r.id)).toContain(a.id);
    expect(listed.data.find((r) => r.id === a.id)).toMatchObject({ restorable: true, deletedBy: null });

    const result = await service.restore('customer', a.id, { id: ownerId });
    expect(result.ok).toBe(true);
    const live = await prisma.customer.findFirst({ where: { id: a.id, deletedAt: null } });
    expect(live).not.toBeNull();

    await expect(service.restore('customer', a.id, { id: ownerId })).rejects.toThrow(NotFoundException);

    const row = await prisma.auditLog.findFirst({ where: { action: 'RESTORED', entityId: a.id, userId: ownerId } });
    expect(row).not.toBeNull();
    expect(row!.rowHash).toBeTruthy();
    expect(row!.sequenceNumber).not.toBeNull();
    expect(row!.entity).toBe('customer');
  });

  it('I2: ลูกค้าอีกคนถือเบอร์เดียวกันอยู่ → กู้ 409 และแถวยังถูกลบ', async () => {
    const hash = `h-dup-${stamp}`;
    await customer('ลูกค้า B live', hash, false);
    const c = await customer('ลูกค้า C deleted', hash, true);
    await expect(service.restore('customer', c.id, { id: ownerId })).rejects.toThrow(ConflictException);
    const still = await prisma.customer.findUnique({ where: { id: c.id }, select: { deletedAt: true } });
    expect(still?.deletedAt).not.toBeNull();
  });

  it('I3: ใบรายจ่ายร่างที่ลบแล้วเลขถูกออกใหม่ → กู้ 409', async () => {
    const number = `EX-TRASH-${stamp}`;
    const base = { documentType: 'EXPENSE' as const, branchId, documentDate: NOW, subtotal: '100.00', totalAmount: '100.00', createdById: ownerId };
    const d1 = await prisma.expenseDocument.create({ data: { ...base, number, deletedAt: NOW } as never });
    await prisma.expenseDocument.create({ data: { ...base, number } as never }); // partial unique ยอมเพราะ d1 ถูกลบ
    await expect(service.restore('expense_document', d1.id, { id: ownerId })).rejects.toThrow(/ถูกออกให้ใบใหม่แล้ว/);
  });

  it('I5: "ลบโดย" มาจากแถว AuditLog action DELETE ที่ใกล้เวลาลบ', async () => {
    const e = await customer('ลูกค้า E', `h-e-${stamp}`, true);
    await audit.log({ action: 'DELETE', entity: 'customers', entityId: e.id, userId: ownerId });
    const listed = await service.list({ type: 'customer', q: `ลูกค้า E ${stamp}`, days: 90, page: 1, pageSize: 50 }, NOW);
    expect(listed.data.find((r) => r.id === e.id)?.deletedBy).toEqual({ id: ownerId, name: 'เจ้าของถังขยะ', system: false });
  });
});
