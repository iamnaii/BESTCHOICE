import { BadRequestException } from '@nestjs/common';
import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import {
  bahtText, compareEventsDesc, dbTimeRange, decodeJourneyCursor, encodeJourneyCursor,
  finalizeSource, mergeJourneyPage, pickMetadata, type JourneyWindow,
} from './journey-window';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString();
const ev = (id: string, timestamp: string, group: JourneyEventGroup = 'chat'): JourneyEvent => ({
  id, type: 'TEST', group, stage: null, timestamp, title: id, actor: null, reliability: 'exact', origin: 'SOURCE',
});

describe('journey-window', () => {
  it('cursor เข้ารหัส/ถอดกลับได้ · ค่าเสีย → 400', () => {
    const cursor = encodeJourneyCursor(ev('chatday-r1-2026-09-09', '2026-09-08T17:50:00.000Z'));
    expect(decodeJourneyCursor(cursor)).toEqual({ ts: '2026-09-08T17:50:00.000Z', id: 'chatday-r1-2026-09-09' });
    for (const raw of ['nope', '2026-09-08|chat-1', '2026-09-08T17:50:00.000Z|']) {
      expect(() => decodeJourneyCursor(Buffer.from(raw).toString('base64'))).toThrow(BadRequestException);
    }
  });

  it('เรียงใหม่→เก่า เวลาเท่ากันใช้ id แบบ code point · ขอบ DB เลือกค่าที่เก่ากว่าระหว่าง cursor กับ to', () => {
    expect([ev('a', day(1)), ev('b', day(2)), ev('Z', day(2)), ev('c', day(2))].sort(compareEventsDesc).map((e) => e.id)).toEqual(['c', 'b', 'Z', 'a']);
    expect(dbTimeRange({ limit: 10 })).toBeUndefined();
    expect(dbTimeRange({ limit: 10, before: { ts: day(9), id: 'x' }, to: new Date(day(11)), from: new Date(day(0)) }))
      .toEqual({ lte: new Date(day(9)), gte: new Date(day(0)) });
  });

  it('finalizeSource ตัดตัวที่ไม่เก่ากว่า cursor + from แล้วคืนไม่เกิน limit+1', () => {
    const events = [ev('e5', day(5)), ev('e4b', day(4)), ev('e4a', day(4)), ev('e3', day(3)), ev('e2', day(2)), ev('e1', day(1))];
    const window: JourneyWindow = { limit: 2, before: { ts: day(4), id: 'e4b' }, from: new Date(day(2)) };
    expect(finalizeSource(events, window).map((e) => e.id)).toEqual(['e4a', 'e3', 'e2']);
  });

  it('แหล่งที่เต็มกำหนดขอบ · กลุ่มที่ไม่ได้ขอถูกกรองแต่ cursor ยังเดินต่อ', () => {
    const chat = new Set<JourneyEventGroup>(['chat']);
    expect(mergeJourneyPage([[ev('a2', day(2))], [ev('b1', day(1))]], 2, chat)).toEqual({ events: [ev('a2', day(2)), ev('b1', day(1))], nextCursor: null });
    const page = mergeJourneyPage([[ev('a9', day(9)), ev('a8', day(8)), ev('a7', day(7))], [ev('b6', day(6))]], 2, chat);
    expect(page.events.map((e) => e.id)).toEqual(['a9', 'a8']);
    expect(decodeJourneyCursor(page.nextCursor ?? '')).toEqual({ ts: day(8), id: 'a8' });
    const hidden = mergeJourneyPage([[ev('s9', day(9), 'system'), ev('s8', day(8), 'system'), ev('s7', day(7), 'system')], [ev('c6', day(6))]], 2, chat);
    expect(hidden.events).toEqual([]);
    expect(decodeJourneyCursor(hidden.nextCursor ?? '')).toEqual({ ts: day(7), id: 's7' });
  });

  it('เดินทีละ 2 จนหมด ได้ครบ ไม่ซ้ำ ไม่ข้าม แม้เวลาชนกันข้ามแหล่ง', () => {
    const sources: JourneyEvent[][] = [
      Array.from({ length: 7 }, (_, i) => ev(`chat-${i}`, day(i % 3))),
      Array.from({ length: 5 }, (_, i) => ev(`entry-${i}`, day(i % 2), i % 2 ? 'system' : 'sale')),
      Array.from({ length: 4 }, (_, i) => ev(`credit-${i}`, day(i), 'credit')),
    ];
    const groups = new Set<JourneyEventGroup>(['chat', 'sale', 'credit']);
    const expected = sources.flat().filter((e) => groups.has(e.group)).sort(compareEventsDesc).map((e) => e.id);
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const window: JourneyWindow = cursor ? { limit: 2, before: decodeJourneyCursor(cursor) } : { limit: 2 };
      const page = mergeJourneyPage(sources.map((all) => finalizeSource(all, window)), window.limit, groups);
      walked.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(expected);
  });

  it('bahtText · pickMetadata หยิบเฉพาะคีย์ที่อนุญาต', () => {
    expect(bahtText(4200)).toBe('4,200');
    expect(bahtText('1234.5')).toBe('1,234.5');
    expect(pickMetadata({ result: 'PROMISED', notes: 'โทร 0812345678' }, ['result'])).toEqual({ result: 'PROMISED' });
    expect(pickMetadata(undefined, ['result'])).toBeUndefined();
  });
});
