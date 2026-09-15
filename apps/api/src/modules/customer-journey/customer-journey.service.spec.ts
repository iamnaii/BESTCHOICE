import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup, JourneyListResponse } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService, resolveJourneyGroups } from './customer-journey.service';
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

/** แหล่ง entries ที่ entriesSourceFor(กลุ่มที่ resolve แล้ว) คืนให้หน้า */
const entriesPage = jest.fn<ReturnType<JourneySource>, Parameters<JourneySource>>();
const ALL = [chatSource, creditSource, saleSource, paymentSource, collectionsSource, serviceSource, pointsSource, entriesPage];
const groupSet = (...groups: JourneyEventGroup[]) => new Set<JourneyEventGroup>(groups);
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup): JourneyEvent => ({ id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE' });
const OWNER = { id: 'o1', role: 'OWNER' };
const LIVE = { id: 'c1', deletedAt: null, mergedIntoId: null };
function setup(customer: { id: string; deletedAt: Date | null; mergedIntoId: string | null } | null, merged: { id: string }[] = []) {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(customer), findMany: jest.fn().mockResolvedValue(merged) } };
  return { prisma, service: new CustomerJourneyService(prisma as unknown as PrismaService) };
}
function asPage(result: Awaited<ReturnType<CustomerJourneyService['list']>>): JourneyListResponse {
  if (!('events' in result)) throw new Error('ได้ redirect แทนหน้าไทม์ไลน์');
  return result;
}

describe('CustomerJourneyService.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const source of ALL) jest.mocked(source).mockResolvedValue([]);
    jest.mocked(entriesSourceFor).mockReturnValue(entriesPage);
  });

  it('placeholder ที่รวมแล้ว → redirect ไม่เรียกแหล่ง · ไม่มี/ลบด้วยเหตุอื่น → 404', async () => {
    await expect(setup({ id: 'p1', deletedAt: new Date(), mergedIntoId: 'c1' }).service.list('p1', {}, OWNER)).resolves.toEqual({ redirectToCustomerId: 'c1' });
    for (const source of ALL) expect(source).not.toHaveBeenCalled();
    expect(entriesSourceFor).not.toHaveBeenCalled();
    await expect(setup(null).service.list('x', {}, OWNER)).rejects.toThrow(new NotFoundException('ไม่พบลูกค้า'));
    await expect(setup({ id: 'd1', deletedAt: new Date(), mergedIntoId: null }).service.list('d1', {}, OWNER)).rejects.toThrow(NotFoundException);
  });

  it('ids = ลูกค้า + placeholder ที่รวมเข้ามา · ค่าตั้งต้นเรียก chat/credit/sale/collections/service + entries ของกลุ่มชุดนั้นครั้งเดียว', async () => {
    const { prisma, service } = setup(LIVE, [{ id: 'p1' }, { id: 'p2' }]);
    const page = asPage(await service.list('c1', {}, OWNER));
    expect(prisma.customer.findMany).toHaveBeenCalledWith({ where: { mergedIntoId: 'c1' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(page).toMatchObject({ customerId: 'c1', mergedCustomerIds: ['p1', 'p2'], events: [], nextCursor: null });
    expect(page.notRecorded.length).toBeGreaterThan(0);
    expect(chatSource).toHaveBeenCalledWith(prisma, ['c1', 'p1', 'p2'], { limit: 30, before: undefined, from: undefined, to: undefined }, OWNER);
    for (const source of [chatSource, creditSource, saleSource, collectionsSource, serviceSource, entriesPage]) expect(source).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).toHaveBeenCalledWith(groupSet('chat', 'credit', 'sale', 'collections', 'service'));
    expect(paymentSource).not.toHaveBeenCalled();
    expect(pointsSource).not.toHaveBeenCalled();
  });

  it('ACCOUNTANT ไม่เรียกแชท · entries อ่านเฉพาะกลุ่มที่เห็น (กลุ่มซ่อนไม่กินขอบหน้า) · SALES ไม่เรียก payment/collections', async () => {
    jest.mocked(entriesPage).mockResolvedValue([ev('entry-chat', day(2), 'chat'), ev('entry-credit', day(1), 'credit')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'credit'] }, { id: 'a1', role: 'ACCOUNTANT' }));
    expect(chatSource).not.toHaveBeenCalled();
    expect(entriesSourceFor).toHaveBeenCalledWith(groupSet('credit'));
    expect(page.events.map((e) => e.id)).toEqual(['entry-credit']);
    jest.mocked(entriesSourceFor).mockClear();
    await setup(LIVE).service.list('c1', { groups: ['payment', 'collections', 'sale'] }, { id: 's1', role: 'SALES' });
    expect(paymentSource).not.toHaveBeenCalled();
    expect(collectionsSource).not.toHaveBeenCalled();
    expect(saleSource).toHaveBeenCalledTimes(1);
    expect(entriesSourceFor).toHaveBeenCalledWith(groupSet('sale'));
    expect([...resolveJourneyGroups(undefined, 'SALES')]).toEqual(['chat', 'credit', 'sale', 'service']);
  });

  it('รวมหลายแหล่ง ตัดที่ limit คืน nextCursor · cursor เสีย 400 ก่อนแตะ DB · cursor/from/to ไปถึงแหล่ง', async () => {
    jest.mocked(chatSource).mockResolvedValue([ev('a', day(3), 'chat'), ev('b', day(1), 'chat')]);
    jest.mocked(saleSource).mockResolvedValue([ev('c', day(2), 'sale')]);
    const page = asPage(await setup(LIVE).service.list('c1', { groups: ['chat', 'sale'], limit: 2 }, OWNER));
    expect(page.events.map((e) => e.id)).toEqual(['a', 'c']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(2), id: 'c' });
    const bad = setup(LIVE);
    await expect(bad.service.list('c1', { cursor: Buffer.from('nope').toString('base64') }, OWNER)).rejects.toThrow(BadRequestException);
    expect(bad.prisma.customer.findUnique).not.toHaveBeenCalled();
    const good = setup(LIVE);
    await good.service.list('c1', { cursor: encodeJourneyCursor({ timestamp: day(5), id: 'x-1' }), from: day(0), to: day(9), groups: ['service'], limit: 10 }, OWNER);
    expect(serviceSource).toHaveBeenCalledWith(good.prisma, ['c1'], { limit: 10, before: { ts: day(5), id: 'x-1' }, from: new Date(day(0)), to: new Date(day(9)) }, OWNER);
    // กลุ่มที่ไม่มีบันทึก entries — ส่งชุดกลุ่มนี้ต่อ (entriesSourceFor ไม่ยิง DB เอง) ไม่ใช่ทุกกลุ่ม
    expect(entriesSourceFor).toHaveBeenLastCalledWith(groupSet('service'));
  });
});
