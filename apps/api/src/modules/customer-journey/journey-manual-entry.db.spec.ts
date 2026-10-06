import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { JourneyEvent } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import { JOURNEY_UNDO_WINDOW_MS } from './sources/manual-entry-event';

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); allKeys(v, keys); }
  return keys;
}

/**
 * POST /customers/:id/journey/entries กับ Postgres จริง — แถวที่เขียนต้องขยับแถบขั้น / ป้ายหลุด / รู้จักร้านจากไหน ในคำตอบเดียวกัน
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest src/modules/customer-journey/journey-manual-entry.db.spec.ts --runInBand (และ TZ=UTC แบบ CI)
 * ผู้ใช้ของ spec เป็น upsert อีเมลคงที่ (ใช้ซ้ำทุกรอบ) · service นี้ไม่เขียน audit_logs
 */
describe('JourneyManualEntryService.create (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const state = new JourneyStateService(db);
  const summaries = new JourneySummaryService(db, state);
  const service = new JourneyManualEntryService(db, state, summaries);
  const STAFF_NAME = 'พนักงานสเปคบันทึกมือ';
  const stamp = Date.now();
  const customerIds: string[] = [];
  let actor: { id: string; role: string };

  const walkIn = async (label: string) => {
    const row = await prisma.customer.create({ data: { name: `manual entry spec ${label} ${stamp}` } });
    customerIds.push(row.id);
    return row.id;
  };
  const body = (plain: Record<string, unknown>) => plain as unknown as CreateJourneyEntryDto;

  beforeAll(async () => {
    const email = 'journey-manual-entry-spec@example.test';
    const user = await prisma.user.upsert({ where: { email }, update: { name: STAFF_NAME }, create: { email, password: 'journey-spec', name: STAFF_NAME, role: 'SALES' } });
    actor = { id: user.id, role: 'SALES' };
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
  });

  it('TOUCHPOINT นัดแล้ว → แถว MANUAL เวลาเซิร์ฟเวอร์ · แถบขั้นอยู่ นัด / จอง หลักฐาน MANUAL ในคำตอบเดียวกัน · ไม่มีคีย์ note', async () => {
    const id = await walkIn('touch');
    const before = Date.now();
    const res = await service.create(id, body({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }), actor);
    const after = Date.now();

    expect(res.summary.stage).toBe('INTERESTED');
    expect(res.summary.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'current', evidence: 'MANUAL' });
    expect(res.event).toMatchObject({
      id: `entry-${res.entryId}`, type: 'TOUCHPOINT', group: 'chat', stage: 'INTERESTED', title: 'ติดต่อทางโทร: นัดแล้ว',
      origin: 'MANUAL', actor: { type: 'STAFF', id: actor.id, name: STAFF_NAME },
    });
    const row = await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: res.entryId! } });
    expect(row).toMatchObject({
      customerId: id, originCustomerId: id, origin: 'MANUAL', actorType: 'STAFF', actorUserId: actor.id,
      roomId: null, refType: null, refId: null, note: null, lostReason: null, heardFrom: null, dedupeKey: null,
    });
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.occurredAt.getTime()).toBeLessThanOrEqual(after);
    expect(allKeys(res).has('note')).toBe(false);
  });

  it('HEARD_FROM → heardFrom ในคำตอบ · askHeardFrom พลิกจาก true เป็น false', async () => {
    const id = await walkIn('heard');
    expect(await summaries.summary(id, actor)).toMatchObject({ firstSource: 'WALK_IN', heardFrom: null, askHeardFrom: true });
    const res = await service.create(id, body({ kind: 'HEARD_FROM', heardFrom: 'FRIEND' }), actor);
    expect(res.summary).toMatchObject({ heardFrom: 'FRIEND', askHeardFrom: false });
    expect(res.event).toMatchObject({ type: 'HEARD_FROM', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ' });
  });

  it('MARKED_LOST → ป้ายหลุดพร้อมเหตุผล · REOPENED → หลุดหาย · REOPENED ซ้ำตอนไม่หลุด = ไม่เขียนแถว', async () => {
    const id = await walkIn('lost');
    const lost = await service.create(id, body({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE' }), actor);
    expect(lost.summary.lost).toEqual({ at: lost.event!.timestamp, reason: 'BOUGHT_ELSEWHERE' });
    expect(lost.event).toMatchObject({ title: 'ติดป้ายหลุด: ซื้อที่อื่น' });

    const reopened = await service.create(id, body({ kind: 'REOPENED' }), actor);
    expect(reopened.entryId).not.toBeNull();
    expect(reopened.summary.lost).toBeNull();
    expect(reopened.event).toMatchObject({ title: 'เปิดใหม่' });

    const again = await service.create(id, body({ kind: 'REOPENED' }), actor);
    expect(again).toMatchObject({ entryId: null, event: null, summary: { lost: null } });
    expect(await prisma.customerJourneyEntry.count({ where: { customerId: id, kind: 'REOPENED' } })).toBe(1);
  });

  it('id ของ placeholder ที่รวมแล้ว → แถวไปอยู่ที่ลูกค้าจริง และคำตอบเป็นแถบขั้นของลูกค้าจริง', async () => {
    const target = await walkIn('target');
    const placeholder = await prisma.customer.create({
      data: { name: `manual entry spec placeholder ${stamp}`, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: target },
    });
    customerIds.push(placeholder.id);
    const res = await service.create(placeholder.id, body({ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'THINKING' }), actor);
    expect(await prisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: res.entryId! } })).toMatchObject({ customerId: target, originCustomerId: target });
    expect(await prisma.customerJourneyState.findUnique({ where: { customerId: placeholder.id } })).toBeNull();
    expect(res.summary.lastTouchAt).toBe(res.event!.timestamp);
  });

  it('clientRequestId เดิม (ยิงพร้อมกัน + ยิงซ้ำ) → แถวเดียว entryId เดียว · ใช้กับลูกค้าอื่น / หลังเลิกทำ → 409', async () => {
    const id = await walkIn('dedupe');
    const clientRequestId = randomUUID();
    const tap = body({ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'NO_ANSWER', clientRequestId });
    const [first, second] = await Promise.all([service.create(id, tap, actor), service.create(id, tap, actor)]);
    const third = await service.create(id, tap, actor);
    expect(first.entryId).not.toBeNull();
    expect([second.entryId, third.entryId]).toEqual([first.entryId, first.entryId]);
    expect(await prisma.customerJourneyEntry.count({ where: { dedupeKey: `MANUAL:TOUCHPOINT:${clientRequestId}` } })).toBe(1);

    const other = await walkIn('dedupe-other');
    const foreign = service.create(other, tap, actor);
    await expect(foreign).rejects.toBeInstanceOf(ConflictException);
    await expect(foreign).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');

    await prisma.customerJourneyEntry.update({ where: { id: first.entryId! }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await expect(service.create(id, tap, actor)).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
  });
});

/**
 * เลิกทำกับ Postgres จริง: ป้ายหลุดหาย · ขั้นถอยเมื่อเลิกทำนัด · แถวหายจาก GET · หน้าต่าง 24 ชม. นับจาก created_at
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand · ผู้ใช้ของ spec ถูกปล่อยไว้ (แบบ journey-summary.service.db.spec.ts)
 */
describe('JourneyManualEntryService.remove (real DB) — เลิกทำ', () => {
  const undoPrisma = new PrismaClient();
  const undoStamp = Date.now();
  const undoCustomerIds: string[] = [];
  const undoUsers = { sales: '', otherSales: '', manager: '' };
  const HOUR = 60 * 60 * 1000;
  const OWNER_VIEW = { id: 'owner-undo-spec', role: 'OWNER' };
  let manualEntries: JourneyManualEntryService;
  let journey: CustomerJourneyService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: undoPrisma },
        JourneyStateService,
        JourneySummaryService,
        CustomerJourneyService,
        JourneyManualEntryService,
      ],
    }).compile();
    manualEntries = moduleRef.get(JourneyManualEntryService);
    journey = moduleRef.get(CustomerJourneyService);
    const user = (key: string, role: 'SALES' | 'BRANCH_MANAGER') =>
      undoPrisma.user.create({ data: { email: `journey-undo-${key}-${undoStamp}@spec.local`, password: 'x', name: `undo spec ${key}`, role } });
    undoUsers.sales = (await user('sales', 'SALES')).id;
    undoUsers.otherSales = (await user('other', 'SALES')).id;
    undoUsers.manager = (await user('manager', 'BRANCH_MANAGER')).id;
  });

  afterAll(async () => {
    await undoPrisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: undoCustomerIds } } });
    await undoPrisma.customerJourneyState.deleteMany({ where: { customerId: { in: undoCustomerIds } } });
    await undoPrisma.customer.deleteMany({ where: { id: { in: undoCustomerIds } } });
    await undoPrisma.$disconnect();
  });

  /** ลูกค้าหน้าร้านไม่มีเบอร์/ห้อง ⇒ ขั้นตั้งต้น CONTACTED */
  async function walkInWithoutContact(label: string) {
    const row = await undoPrisma.customer.create({ data: { name: `journey undo spec ${label} ${undoStamp}`, phone: null } });
    undoCustomerIds.push(row.id);
    return row;
  }
  const dto = (fields: Partial<CreateJourneyEntryDto>) => Object.assign(new CreateJourneyEntryDto(), { clientRequestId: randomUUID(), ...fields });
  async function chatEvents(customerId: string, actor: { id: string; role: string }): Promise<JourneyEvent[]> {
    const result = await journey.list(customerId, { groups: ['chat'], limit: 100 }, actor);
    if (!('events' in result)) throw new Error('ได้ redirect');
    return result.events;
  }

  it('เลิกทำป้ายหลุด → summary.lost เป็น null · แถวหายจาก GET · ลบซ้ำ = 200 ไม่เขียนทับ · ส่ง clientRequestId เดิมซ้ำ = 409', async () => {
    const customer = await walkInWithoutContact('lost');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const markDto = dto({ kind: 'MARKED_LOST', lostReason: 'NOT_INTERESTED' });
    const created = await manualEntries.create(customer.id, markDto, author);
    expect(created.summary.lost).toMatchObject({ reason: 'NOT_INTERESTED' });
    if (!created.entryId || !created.event) throw new Error('คาดว่าได้แถวใหม่');
    const entryId = created.entryId;
    const row = await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(created.event).toMatchObject({
      entryId,
      canDelete: true,
      undoableUntil: new Date(row.createdAt.getTime() + JOURNEY_UNDO_WINDOW_MS).toISOString(),
    });
    expect((await chatEvents(customer.id, OWNER_VIEW)).map((e) => e.entryId)).toContain(entryId);

    const undone = await manualEntries.remove(customer.id, entryId, author);
    expect(undone.summary.lost).toBeNull();
    const deleted = await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedById).toBe(author.id);
    expect((await chatEvents(customer.id, OWNER_VIEW)).some((e) => e.id === `entry-${entryId}` || e.entryId === entryId)).toBe(false);

    const again = await manualEntries.remove(customer.id, entryId, author);
    expect(again.summary.lost).toBeNull();
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toEqual(deleted.deletedAt);

    await expect(manualEntries.create(customer.id, markDto, author)).rejects.toThrow(ConflictException);
    await expect(manualEntries.create(customer.id, markDto, author)).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
  });

  it('เลิกทำ "ติดต่อทางโทร: นัดแล้ว" → ขั้นถอยจาก นัด / จอง กลับเป็น ทักเข้ามา · lastTouchAt ว่าง', async () => {
    const customer = await walkInWithoutContact('appointed');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const created = await manualEntries.create(customer.id, dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }), author);
    expect(created.summary.stage).toBe('INTERESTED');
    if (!created.entryId) throw new Error('คาดว่าได้แถวใหม่');

    const undone = await manualEntries.remove(customer.id, created.entryId, author);
    expect(undone.summary).toMatchObject({ stage: 'CONTACTED', lastTouchAt: null });
    expect(undone.summary.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ at: null, state: 'todo' });
  });

  it('หน้าต่าง 24 ชม. นับจาก created_at ไม่ใช่ occurred_at: ผู้บันทึกหลัง 25 ชม. = 403 และลิงก์หาย · SALES คนอื่น 403 · ผู้จัดการสาขาลบได้', async () => {
    const customer = await walkInWithoutContact('window');
    const author = { id: undoUsers.sales, role: 'SALES' };
    const manager = { id: undoUsers.manager, role: 'BRANCH_MANAGER' };
    const created = await manualEntries.create(customer.id, dto({ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'THINKING' }), author);
    if (!created.entryId) throw new Error('คาดว่าได้แถวใหม่');
    const entryId = created.entryId;
    // occurred_at ยังเป็นเวลาที่เพิ่งกด — ย้อนเฉพาะ created_at
    await undoPrisma.customerJourneyEntry.update({ where: { id: entryId }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });

    const authorView = (await chatEvents(customer.id, author)).find((e) => e.entryId === entryId);
    expect(authorView).toMatchObject({ canDelete: false, undoableUntil: null });
    const managerView = (await chatEvents(customer.id, manager)).find((e) => e.entryId === entryId);
    expect(managerView).toMatchObject({ canDelete: true, undoableUntil: null });

    await expect(manualEntries.remove(customer.id, entryId, author)).rejects.toThrow(ForbiddenException);
    await expect(manualEntries.remove(customer.id, entryId, { id: undoUsers.otherSales, role: 'SALES' })).rejects.toThrow('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toBeNull();

    const byManager = await manualEntries.remove(customer.id, entryId, manager);
    expect(byManager.summary.lastTouchAt).toBeNull();
    expect((await undoPrisma.customerJourneyEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedById).toBe(manager.id);
  });
});
