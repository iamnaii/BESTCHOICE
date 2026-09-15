import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup, JourneyListResponse, JourneySummary } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService, JOURNEY_COUNT_CAP, countJourneyGroups, resolveJourneyGroups } from './customer-journey.service';
import type { JourneySummaryService } from './journey-summary.service';
import { chatSource } from './sources/chat.source';
import { collectionsSource } from './sources/collections.source';
import { creditSource } from './sources/credit.source';
import { entriesSourceFor } from './sources/entries.source';
import { decodeJourneyCursor, encodeJourneyCursor, type JourneySource } from './sources/journey-window';
import { paymentSource } from './sources/payment.source';
import { pointsSource } from './sources/points.source';
import { saleSource } from './sources/sale.source';
import { serviceSource } from './sources/service.source';

jest.mock('./sources/chat.source', () => ({ chatSource: jest.fn() }));
jest.mock('./sources/credit.source', () => ({ creditSource: jest.fn() }));
jest.mock('./sources/sale.source', () => ({ saleSource: jest.fn() }));
jest.mock('./sources/payment.source', () => ({ paymentSource: jest.fn() }));
jest.mock('./sources/collections.source', () => ({ collectionsSource: jest.fn() }));
jest.mock('./sources/service.source', () => ({ serviceSource: jest.fn() }));
jest.mock('./sources/points.source', () => ({ pointsSource: jest.fn() }));
jest.mock('./sources/entries.source', () => ({ entriesSourceFor: jest.fn() }));

/** แหล่งจากตารางโดเมน — บันทึก entries/แท็กมาจาก entriesSourceFor(กลุ่ม) เท่านั้น (Task 8 fix รอบ 1) */
const DOMAIN = [chatSource, creditSource, saleSource, paymentSource, collectionsSource, serviceSource, pointsSource];
const groupSet = (...groups: JourneyEventGroup[]) => new Set<JourneyEventGroup>(groups);
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup): JourneyEvent => ({ id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE' });
const OWNER = { id: 'o1', role: 'OWNER' };
const LIVE = { id: 'c1', deletedAt: null, mergedIntoId: null };
const SUMMARY = { stage: 'CREDIT', stageLabel: 'ตรวจเครดิต' } as unknown as JourneySummary;

/** แถว entries ที่ "DB" มี เรียงใหม่→เก่า — entriesSourceFor ให้ DB กรองกลุ่มก่อนตัดที่ limit+1 แบบ finalizeSource */
let entryRows: JourneyEvent[] = [];
/** ชุดกลุ่มที่แหล่ง entries ถูกเรียกอ่าน (หนึ่งสตริงต่อครั้ง) */
let entryScans: string[] = [];

function setup(customer: { id: string; deletedAt: Date | null; mergedIntoId: string | null } | null, merged: { id: string }[] = []) {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer), findMany: jest.fn().mockResolvedValue(merged) } };
  const summaries = { summary: jest.fn().mockResolvedValue(SUMMARY) };
  const service = new CustomerJourneyService(prisma as unknown as PrismaService, summaries as unknown as JourneySummaryService);
  return { prisma, summaries, service };
}
function asPage(result: Awaited<ReturnType<CustomerJourneyService['list']>>): JourneyListResponse {
  if (!('events' in result)) throw new Error('ได้ redirect แทนหน้าไทม์ไลน์');
  return result;
}
const cursorAt = (n: number) => encodeJourneyCursor({ timestamp: day(n), id: 'x-1' });

describe('CustomerJourneyService.list + summary (Task 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const source of DOMAIN) jest.mocked(source).mockResolvedValue([]);
    entryRows = [];
    entryScans = [];
    jest.mocked(entriesSourceFor).mockImplementation((groups): JourneySource => async (...args) => {
      entryScans.push([...groups].join(','));
      return entryRows.filter((event) => groups.has(event.group)).slice(0, args[2].limit + 1);
    });
  });

  it('placeholder ที่รวมแล้ว → redirect ไม่เรียกแหล่งและ summary · ไม่มี/ลบด้วยเหตุอื่น → 404', async () => {
    const merged = setup({ id: 'p1', deletedAt: new Date(), mergedIntoId: 'c1' });
    await expect(merged.service.list('p1', { include: ['summary', 'counts'] }, OWNER)).resolves.toEqual({ redirectToCustomerId: 'c1' });
    for (const source of DOMAIN) expect(source).not.toHaveBeenCalled();
    expect(entriesSourceFor).not.toHaveBeenCalled();
    expect(merged.summaries.summary).not.toHaveBeenCalled();
    await expect(setup(null).service.list('x', {}, OWNER)).rejects.toThrow(new NotFoundException('ไม่พบลูกค้า'));
    await expect(setup({ id: 'd1', deletedAt: new Date(), mergedIntoId: null }).service.list('d1', {}, OWNER)).rejects.toThrow(NotFoundException);
  });

  it('ไม่ขอ include (การ์ดภาพรวม) → พฤติกรรมของ Task 8: แหล่งของกลุ่มที่ขอด้วย limit จริง · entries อ่านชุดกลุ่มที่ขอครั้งเดียว · ไม่มี counts/summary', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('chat-1', day(3), 'chat')]);
    entryRows = [ev('en-sys', day(4), 'system'), ev('en-credit', day(2), 'credit')];
    const { prisma, summaries, service } = setup(LIVE);

    const page = asPage(await service.list('c1', { groups: ['chat', 'credit', 'sale'], limit: 6 }, OWNER));

    expect(page.events.map((e) => e.id)).toEqual(['chat-1', 'en-credit']);
    expect(page).not.toHaveProperty('counts');
    expect(page).not.toHaveProperty('summary');
    expect(summaries.summary).not.toHaveBeenCalled();
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1'], { limit: 6, before: undefined, from: undefined, to: undefined }, OWNER);
    for (const source of [paymentSource, collectionsSource, serviceSource, pointsSource]) expect(source).not.toHaveBeenCalled();
    expect(entriesSourceFor).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).toHaveBeenCalledWith(groupSet('chat', 'credit', 'sale'));
    expect(entryScans).toEqual(['chat,credit,sale']);
  });

  it('include=counts หน้าแรก: ids = ลูกค้า + placeholder · แหล่งโดเมนที่ OWNER เห็นถูกเรียกครั้งเดียวด้วยเพดาน 100 · entries สแกนทีละกลุ่มที่เห็น · counts ครบทุกกลุ่มที่มีเหตุการณ์ · ไม่ขอ summary = ไม่มี summary', async () => {
    jest.mocked(pointsSource).mockResolvedValue([ev('pt', day(1), 'points')]);
    entryRows = [ev('en-chat', day(2), 'chat'), ev('en-sys', day(1), 'system')];
    const { prisma, summaries, service } = setup(LIVE, [{ id: 'p1' }, { id: 'p2' }]);

    const page = asPage(await service.list('c1', { include: ['counts'] }, OWNER));

    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(page).toMatchObject({ customerId: 'c1', mergedCustomerIds: ['p1', 'p2'], nextCursor: null });
    expect(page.events.map((e) => e.id)).toEqual(['en-chat']);
    expect(page.counts).toEqual({ chat: 1, points: 1, system: 1 });
    expect(page).not.toHaveProperty('summary');
    expect(summaries.summary).not.toHaveBeenCalled();
    expect(page.notRecorded.length).toBeGreaterThan(0);
    for (const source of DOMAIN) expect(source).toHaveBeenCalledTimes(1);
    // ทีละกลุ่ม ไม่มีสแกนก้อนรวม — กลุ่มที่ไม่มี kind ใน entries และไม่ใช่ system ไม่ยิง DB (entriesSourceFor)
    expect([...entryScans].sort()).toEqual([...resolveJourneyGroups(['chat', 'credit', 'sale', 'payment', 'collections', 'service', 'points', 'system'], 'OWNER')].sort());
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1', 'p1', 'p2'], { limit: JOURNEY_COUNT_CAP, before: undefined, from: undefined, to: undefined }, OWNER);
  });

  it('ACCOUNTANT ไม่เรียกแชทและไม่สแกน entries กลุ่มแชท · counts ไม่มี chat · SALES เรียก payment/collections ทั้งหน้าแรกและหน้าถัดไป (OD-10)', async () => {
    entryRows = [ev('entry-chat', day(2), 'chat'), ev('entry-credit', day(1), 'credit')];
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'credit'], include: ['counts'] }, { id: 'a1', role: 'ACCOUNTANT' }));
    expect(chatSource).not.toHaveBeenCalled();
    expect(entryScans).not.toContain('chat');
    expect(page.events.map((e) => e.id)).toEqual(['entry-credit']);
    expect(page.counts).toEqual({ credit: 1 });

    jest.clearAllMocks();
    entryScans = [];
    const sales = setup(LIVE);
    const salesActor = { id: 's1', role: 'SALES' };
    await sales.service.list('c1', { groups: ['payment', 'collections', 'sale'], include: ['counts'] }, salesActor);
    await sales.service.list('c1', { groups: ['payment', 'collections', 'sale'], include: ['counts'], cursor: cursorAt(5) }, salesActor);
    expect(paymentSource).toHaveBeenCalledTimes(2);
    expect(collectionsSource).toHaveBeenCalledTimes(2);
    expect(saleSource).toHaveBeenCalledTimes(2);
    expect(entryScans).toEqual(expect.arrayContaining(['payment', 'collections']));
    // ไม่ส่ง groups = JOURNEY_DEFAULT_GROUPS เต็มชุด (payment อยู่นอกค่าตั้งต้นของทุกบทบาท ไม่ใช่เพราะถูกซ่อน)
    expect([...resolveJourneyGroups(undefined, 'SALES')]).toEqual(['chat', 'credit', 'sale', 'collections', 'service']);
  });

  it('รวมหลายแหล่ง ตัดที่ limit คืน nextCursor · cursor เสีย 400 ก่อนแตะ DB · หน้าถัดไปเรียกเฉพาะแหล่งที่ขอด้วย limit จริง ไม่มี counts แม้ขอ', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('a', day(3), 'chat'), ev('b', day(1), 'chat')]);
    jest.mocked(saleSource).mockResolvedValue([ev('c', day(2), 'sale')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'sale'], limit: 2, include: ['counts'] }, OWNER));
    expect(page.events.map((e) => e.id)).toEqual(['a', 'c']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(2), id: 'c' });
    expect(page.counts).toEqual({ chat: 2, sale: 1 });

    const bad = setup(LIVE);
    await expect(bad.service.list('c1', { cursor: Buffer.from('nope').toString('base64') }, OWNER)).rejects.toThrow(BadRequestException);
    expect(bad.prisma.customer.findUnique).not.toHaveBeenCalled();
    // วันที่รูปสัปดาห์/ลำดับวัน (หลุด DTO มาได้ถ้าเรียก service ตรง) และช่วงกลับหัว → 400 ไทย ไม่ใช่ Invalid Date เป็น 500
    await expect(bad.service.list('c1', { from: '2026-W38' }, OWNER)).rejects.toThrow(new BadRequestException('ช่วงวันที่ไม่ถูกต้อง'));
    await expect(bad.service.list('c1', { to: '2026-258' }, OWNER)).rejects.toThrow(BadRequestException);
    await expect(bad.service.list('c1', { from: day(9), to: day(0) }, OWNER)).rejects.toThrow(BadRequestException);
    expect(bad.prisma.customer.findUnique).not.toHaveBeenCalled();

    jest.clearAllMocks();
    entryScans = [];
    const good = setup(LIVE);
    const next = asPage(await good.service.list('c1', { cursor: cursorAt(5), from: day(0), to: day(9), groups: ['service'], limit: 10, include: ['counts'] }, OWNER));
    expect(serviceSource).toHaveBeenCalledWith(good.prisma, ['c1'], { limit: 10, before: { ts: day(5), id: 'x-1' }, from: new Date(day(0)), to: new Date(day(9)) }, OWNER);
    expect(chatSource).not.toHaveBeenCalled();
    // หน้าถัดไป = พฤติกรรมของ Task 8: entries ของชุดกลุ่มที่ขอครั้งเดียว ไม่สแกนนับทีละกลุ่ม
    expect(entriesSourceFor).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).toHaveBeenCalledWith(groupSet('service'));
    expect(next).not.toHaveProperty('counts');
  });

  it('counts ถึงเพดาน 100 · หน้าแรกยังตัดที่ limit · id ซ้ำนับครั้งเดียว', async () => {
    const newestFirst = Array.from({ length: 150 }, (_, i) => ev(`chat-${String(149 - i).padStart(3, '0')}`, new Date(Date.UTC(2026, 8, 1, 0, 149 - i)).toISOString(), 'chat'));
    jest.mocked(chatSource).mockResolvedValue(newestFirst);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat'], include: ['counts'] }, OWNER));
    expect(page.counts).toEqual({ chat: JOURNEY_COUNT_CAP });
    expect(page.events).toHaveLength(30);
    expect(page.events[0].id).toBe('chat-149');
    expect(page.nextCursor).not.toBeNull();
    expect(countJourneyGroups([[ev('x', day(1), 'chat'), ev('x', day(1), 'chat')]], new Set<JourneyEventGroup>(['chat']))).toEqual({ chat: 1 });
  });

  it('entries หลายกลุ่ม: ระบบใหม่ 101 แถว + แชทเก่า 5 แถว → counts.chat = 5 (สแกน entries ก้อนเดียวจะนับแชทได้ 0)', async () => {
    const systemNewest = Array.from({ length: 101 }, (_, i) => ev(`sys-${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 8, 20, 0, 101 - i)).toISOString(), 'system'));
    const chatOlder = Array.from({ length: 5 }, (_, i) => ev(`chat-${i}`, day(5 - i), 'chat'));
    entryRows = [...systemNewest, ...chatOlder];

    const page = asPage(await setup(LIVE).service.list('c1', { include: ['counts'] }, OWNER));

    expect(page.counts).toMatchObject({ chat: 5, system: JOURNEY_COUNT_CAP });
    expect(page.events.map((e) => e.id)).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
    // หลักฐานว่าแบบสแกนรวม (entries ก้อนเดียวตัดที่เพดาน+1) นับแชทไม่ได้เลย
    expect(countJourneyGroups([entryRows.slice(0, JOURNEY_COUNT_CAP + 1)], new Set<JourneyEventGroup>(['chat', 'system'])).chat).toBeUndefined();
  });

  it('include=summary: หน้าแรกแนบ summary (มี/ไม่มี counts) · summary ตอบ redirect (ถูกรวมระหว่างคำขอ) → ไม่แนบ · หน้าถัดไปไม่เรียก summary', async () => {
    const first = setup(LIVE);
    const page = asPage(await first.service.list('c1', { include: ['summary', 'counts'] }, OWNER));
    expect(first.summaries.summary).toHaveBeenCalledWith('c1', OWNER);
    expect(page.summary).toBe(SUMMARY);
    expect(page.counts).toBeDefined();

    const summaryOnly = setup(LIVE);
    const plain = asPage(await summaryOnly.service.list('c1', { include: ['summary'] }, OWNER));
    expect(plain.summary).toBe(SUMMARY);
    expect(plain).not.toHaveProperty('counts');

    const raced = setup(LIVE);
    raced.summaries.summary.mockResolvedValue({ redirectToCustomerId: 'c9' });
    expect(asPage(await raced.service.list('c1', { include: ['summary'] }, OWNER))).not.toHaveProperty('summary');

    const later = setup(LIVE);
    await later.service.list('c1', { include: ['summary', 'counts'], cursor: cursorAt(5) }, OWNER);
    expect(later.summaries.summary).not.toHaveBeenCalled();
  });

  it('summary() ส่งต่อให้ JourneySummaryService', async () => {
    const { summaries, service } = setup(LIVE);
    await expect(service.summary('c1', OWNER)).resolves.toBe(SUMMARY);
    expect(summaries.summary).toHaveBeenCalledWith('c1', OWNER);
  });
});
