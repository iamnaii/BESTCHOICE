import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import { JOURNEY_NOT_RECORDED } from './customer-journey.service';
import type { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import { JourneyManualEntryService } from './journey-manual-entry.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import { MANUAL_ENTRY_EVENT_SELECT } from './sources/manual-entry-event';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const ACTOR = { id: 'u1', role: 'SALES' };
const STAFF = { id: 'u1', name: 'พนักงานสเปค' };
const REQUEST_ID = '3f8e2b1c-6d4a-4f7e-9b2a-1c5d8e7f9a0b';
const EARLIER = new Date('2026-09-15T04:59:00.000Z');

interface CustomerRow { id: string; deletedAt: Date | null; mergedIntoId: string | null }
const live = (id: string): CustomerRow => ({ id, deletedAt: null, mergedIntoId: null });
const merged = (id: string, into: string): CustomerRow => ({ id, deletedAt: EARLIER, mergedIntoId: into });
const summaryOf = (over: Record<string, unknown> = {}) => ({ stage: 'IDENTIFIED', lost: null, heardFrom: null, askHeardFrom: true, ...over }) as unknown as JourneySummary;
/** แถวที่ findUnique(dedupe_key) คืน — มี customerId/deletedAt · createdAt เผื่อหน้าต่างเลิกทำ */
const entryRow = (over: Record<string, unknown> = {}) => ({
  id: 'e0', customerId: 'c1', deletedAt: null, kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: EARLIER, createdAt: EARLIER,
  actorType: 'STAFF', roomId: null, channel: 'PHONE', outcome: 'THINKING', lostReason: null, heardFrom: null, actorUser: STAFF, ...over,
});
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`dedupe_key`)', { code: 'P2002', clientVersion: 'test', meta: { target: ['dedupe_key'] } });

function setup(customers: CustomerRow[] = [live('c1')]) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const prisma = {
    customer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: { mergedIntoId: string } }) => customers.filter((c) => c.mergedIntoId === where.mergedIntoId).map((c) => ({ id: c.id }))),
      count: jest.fn().mockResolvedValue(0),
    },
    customerJourneyEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown>; select?: unknown }) => ({
        id: 'e1', kind: data.kind, origin: data.origin, occurredAt: data.occurredAt, createdAt: data.occurredAt, actorType: data.actorType,
        roomId: data.roomId, channel: data.channel, outcome: data.outcome, lostReason: data.lostReason, heardFrom: data.heardFrom, actorUser: STAFF,
      })),
    },
  };
  const state = { recompute: jest.fn().mockResolvedValue(undefined) };
  const summaries = { summary: jest.fn().mockResolvedValue(summaryOf()) };
  const service = new JourneyManualEntryService(prisma as unknown as PrismaService, state as unknown as JourneyStateService, summaries as unknown as JourneySummaryService);
  return { prisma, state, summaries, service };
}
const dto = (plain: Record<string, unknown>) => plain as unknown as CreateJourneyEntryDto;

describe('JourneyManualEntryService.create — POST /customers/:id/journey/entries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('TOUCHPOINT: แถว MANUAL เวลาเซิร์ฟเวอร์ · note/roomId/คอลัมน์ของ kind อื่นเป็น null · ไม่ตรวจการซื้อ · เขียน → recompute → summary', async () => {
    const { prisma, state, summaries, service } = setup();
    const summary = summaryOf({ stage: 'INTERESTED' });
    summaries.summary.mockResolvedValue(summary);
    // เรียกตรง (ไม่ผ่าน ValidationPipe) พร้อมคีย์ที่ DTO ไม่มี + คอลัมน์ของ kind อื่น — service ต้องไม่เขียน
    const body = dto({
      kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', lostReason: 'NOT_INTERESTED', heardFrom: 'FRIEND', clientRequestId: REQUEST_ID,
      note: 'โทร 0899999999', roomId: 'r1', occurredAt: '2020-01-01T00:00:00.000Z',
    });
    const before = Date.now();
    const res = await service.create('c1', body, ACTOR);

    const call = prisma.customerJourneyEntry.create.mock.calls[0][0];
    expect(call.select).toBe(MANUAL_ENTRY_EVENT_SELECT);
    expect(call.data).toEqual({
      customerId: 'c1', originCustomerId: 'c1', origin: 'MANUAL', kind: 'TOUCHPOINT', occurredAt: expect.any(Date),
      actorType: 'STAFF', actorUserId: 'u1', roomId: null, refType: null, refId: null, note: null,
      channel: 'PHONE', outcome: 'APPOINTED', lostReason: null, heardFrom: null, dedupeKey: `MANUAL:TOUCHPOINT:${REQUEST_ID}`,
    });
    const occurredAt = call.data.occurredAt as Date;
    expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(state.recompute).toHaveBeenCalledWith(['c1']);
    expect(summaries.summary).toHaveBeenCalledWith('c1', ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.invocationCallOrder[0]).toBeLessThan(state.recompute.mock.invocationCallOrder[0]);
    expect(state.recompute.mock.invocationCallOrder[0]).toBeLessThan(summaries.summary.mock.invocationCallOrder[0]);
    expect(res).toMatchObject({
      entryId: 'e1',
      event: {
        id: 'entry-e1', type: 'TOUCHPOINT', group: 'chat', stage: 'INTERESTED', timestamp: occurredAt.toISOString(),
        title: 'ติดต่อทางโทร: นัดแล้ว', actor: { type: 'STAFF', id: 'u1', name: 'พนักงานสเปค' }, reliability: 'exact', origin: 'MANUAL',
      },
      summary,
    });
    expect(res.event).not.toHaveProperty('href');
    expect(JSON.stringify(res)).not.toContain('0899999999');
  });

  it('HEARD_FROM ไม่มี clientRequestId → dedupeKey null · ไม่ค้นแถวซ้ำ · เขียนเฉพาะ heardFrom', async () => {
    const { prisma, service } = setup();
    const res = await service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'FRIEND' }), ACTOR);
    expect(prisma.customerJourneyEntry.findUnique).not.toHaveBeenCalled();
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', channel: null, outcome: null, lostReason: null, dedupeKey: null });
    expect(res.event).toMatchObject({ type: 'HEARD_FROM', stage: null, title: 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ' });
  });

  it('id ของ placeholder ที่รวมแล้ว → เขียน คำนวณ และอ่านแถบขั้นที่ลูกค้าจริง', async () => {
    const { prisma, state, summaries, service } = setup([live('c1'), merged('p1', 'c1')]);
    await service.create('p1', dto({ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'THINKING' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ customerId: 'c1', originCustomerId: 'c1' });
    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true } });
    expect(state.recompute).toHaveBeenCalledWith(['c1']);
    expect(summaries.summary).toHaveBeenCalledWith('c1', ACTOR);
  });

  it.each([
    ['ไม่มีลูกค้านี้', [live('c1')], 'missing'],
    ['ลบด้วยเหตุอื่น (ไม่มี mergedIntoId)', [{ id: 'd1', deletedAt: EARLIER, mergedIntoId: null }], 'd1'],
    ['ลูกค้าปลายทางถูกลบแล้ว', [{ id: 'c1', deletedAt: EARLIER, mergedIntoId: null }, merged('p1', 'c1')], 'p1'],
  ] as Array<[string, CustomerRow[], string]>)('%s → 404 ไม่พบลูกค้า · ไม่เขียน', async (_label, customers, id) => {
    const { prisma, service } = setup(customers);
    const attempt = service.create(id, dto({ kind: 'REOPENED' }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toThrow('ไม่พบลูกค้า');
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('MARKED_LOST กับลูกค้าที่ซื้อแล้ว (BOUGHT_WHERE สด) → 409 · ไม่เขียน', async () => {
    const { prisma, service } = setup();
    prisma.customer.count.mockResolvedValue(1);
    const attempt = service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE' }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้');
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: { AND: [{ id: 'c1' }, BOUGHT_WHERE] } });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('MARKED_LOST ตอนหลุดอยู่แล้ว → เขียนได้ (เปลี่ยนเหตุผล · Q4) · ไม่อ่าน summary ก่อนเขียน', async () => {
    const { prisma, summaries, service } = setup();
    summaries.summary.mockResolvedValue(summaryOf({ lost: { at: EARLIER.toISOString(), reason: 'NOT_INTERESTED' } }));
    const res = await service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'UNREACHABLE' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', channel: null, outcome: null, heardFrom: null });
    expect(summaries.summary).toHaveBeenCalledTimes(1);
    expect(res.event).toMatchObject({ title: 'ติดป้ายหลุด: ติดต่อไม่ได้', stage: null });
  });

  it('REOPENED ตอนไม่หลุด → ไม่เขียน · { entryId: null, event: null, summary } · คำนวณแคชก่อนอ่าน lost', async () => {
    const { prisma, state, summaries, service } = setup();
    const summary = summaryOf({ lost: null });
    summaries.summary.mockResolvedValue(summary);
    await expect(service.create('c1', dto({ kind: 'REOPENED' }), ACTOR)).resolves.toEqual({ entryId: null, event: null, summary });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
    expect(state.recompute).toHaveBeenCalledTimes(1);
    expect(state.recompute.mock.invocationCallOrder[0]).toBeLessThan(summaries.summary.mock.invocationCallOrder[0]);
  });

  it('REOPENED ตอนหลุด → เขียนแถว "เปิดใหม่" แล้วคืน summary หลังคำนวณใหม่', async () => {
    const { prisma, state, summaries, service } = setup();
    const after = summaryOf({ lost: null });
    summaries.summary.mockResolvedValueOnce(summaryOf({ lost: { at: EARLIER.toISOString(), reason: 'OTHER' } })).mockResolvedValueOnce(after);
    const res = await service.create('c1', dto({ kind: 'REOPENED' }), ACTOR);
    expect(prisma.customerJourneyEntry.create.mock.calls[0][0].data).toMatchObject({ kind: 'REOPENED', channel: null, outcome: null, lostReason: null, heardFrom: null });
    expect(res).toMatchObject({ entryId: 'e1', event: { type: 'REOPENED', title: 'เปิดใหม่', stage: null }, summary: after });
    expect(state.recompute).toHaveBeenCalledTimes(2);
  });

  it('clientRequestId ที่เคยบันทึกแล้ว → คืนแถวเดิม ไม่เขียนแถวที่สอง ไม่ recompute · ตรวจก่อนกติกา kind (retry หลังลูกค้าซื้อได้ผลเดิม)', async () => {
    const { prisma, state, summaries, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValue(entryRow({ kind: 'MARKED_LOST', channel: null, outcome: null, lostReason: 'BOUGHT_ELSEWHERE' }));
    prisma.customer.count.mockResolvedValue(1);
    const summary = summaryOf();
    summaries.summary.mockResolvedValue(summary);
    const res = await service.create('c1', dto({ kind: 'MARKED_LOST', lostReason: 'BOUGHT_ELSEWHERE', clientRequestId: REQUEST_ID }), ACTOR);
    expect(prisma.customerJourneyEntry.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: `MANUAL:MARKED_LOST:${REQUEST_ID}` },
      select: { ...MANUAL_ENTRY_EVENT_SELECT, customerId: true, deletedAt: true },
    });
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(state.recompute).not.toHaveBeenCalled();
    expect(res).toMatchObject({ entryId: 'e0', event: { id: 'entry-e0', timestamp: EARLIER.toISOString(), title: 'ติดป้ายหลุด: ซื้อที่อื่น' }, summary });
  });

  it.each([
    ['ถูกเลิกทำแล้ว', { deletedAt: EARLIER }],
    ['เป็นของลูกค้าคนอื่น', { customerId: 'someone-else' }],
  ])('clientRequestId ชนแถวที่%s → 409 ให้กดใหม่ · ไม่เขียน', async (_label, over) => {
    const { prisma, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValue(entryRow(over));
    const attempt = service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('คำขอนี้ถูกใช้ไปแล้ว กรุณากดใหม่อีกครั้ง');
    expect(prisma.customerJourneyEntry.create).not.toHaveBeenCalled();
  });

  it('ยิงพร้อมกันจนชน unique ของ dedupe_key (P2002) → โหลดแถวที่ชนะมาคืน · ไม่ recompute ซ้ำ', async () => {
    const { prisma, state, service } = setup();
    prisma.customerJourneyEntry.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(entryRow({ id: 'e-winner' }));
    prisma.customerJourneyEntry.create.mockRejectedValueOnce(uniqueViolation());
    const res = await service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR);
    expect(res.entryId).toBe('e-winner');
    expect(prisma.customerJourneyEntry.create).toHaveBeenCalledTimes(1);
    expect(state.recompute).not.toHaveBeenCalled();
  });

  it('P2002 แต่หาแถวของ dedupe_key ไม่เจอ / ไม่มี clientRequestId → โยน error เดิม', async () => {
    const error = uniqueViolation();
    const withKey = setup();
    withKey.prisma.customerJourneyEntry.create.mockRejectedValueOnce(error);
    await expect(withKey.service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'THINKING', clientRequestId: REQUEST_ID }), ACTOR)).rejects.toBe(error);
    const withoutKey = setup();
    withoutKey.prisma.customerJourneyEntry.create.mockRejectedValueOnce(error);
    await expect(withoutKey.service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'GOOGLE' }), ACTOR)).rejects.toBe(error);
    expect(withoutKey.prisma.customerJourneyEntry.findUnique).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → คำขอยังสำเร็จ (แถวถูกเขียนแล้ว) · warn + Sentry op manual-entry-recompute', async () => {
    const { state, service } = setup();
    const err = new Error('db down');
    state.recompute.mockRejectedValue(err);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.create('c1', dto({ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'VISITED' }), ACTOR)).resolves.toMatchObject({ entryId: 'e1' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { kind: 'customer-journey', op: 'manual-entry-recompute' } });
  });

  it('summary ตอบ redirect (ถูกรวมระหว่างคำขอ) → ตามไปลูกค้าปลายทางหนึ่งชั้น', async () => {
    const { summaries, service } = setup();
    const moved = summaryOf({ stage: 'CONTACTED' });
    summaries.summary.mockResolvedValueOnce({ redirectToCustomerId: 'c9' }).mockResolvedValueOnce(moved);
    const res = await service.create('c1', dto({ kind: 'HEARD_FROM', heardFrom: 'TIKTOK' }), ACTOR);
    expect(summaries.summary).toHaveBeenLastCalledWith('c9', ACTOR);
    expect(res.summary).toBe(moved);
  });

  it('บันทึก "รู้จักร้านจากไหน" ได้แล้ว → ไม่อยู่ในรายการ "ระบบยังไม่เก็บ"', () => {
    expect(JOURNEY_NOT_RECORDED).not.toContain('ลูกค้าหน้าร้านรู้จักร้านจากไหน');
  });
});
