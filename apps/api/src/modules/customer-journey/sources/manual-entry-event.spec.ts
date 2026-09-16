import type { JourneyEventGroup, JourneyStage } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSourceFor } from './entries.source';
import { isManualEntryKind, manualEntryTitle, manualEntryToEvent, type ManualEntryEventRow } from './manual-entry-event';

const OWNER = { id: 'o1', role: 'OWNER' };
const NOW = new Date('2026-09-15T05:00:00.000Z');
type Row = ManualEntryEventRow & { createdAt: Date };
const row = (o: Partial<Row> & Pick<Row, 'id' | 'kind'>): Row => ({
  origin: 'MANUAL',
  occurredAt: new Date('2026-09-14T03:00:00.000Z'),
  createdAt: new Date('2026-09-14T03:00:00.000Z'),
  actorType: 'STAFF',
  roomId: null,
  channel: null,
  outcome: null,
  lostReason: null,
  heardFrom: null,
  actorUser: { id: 'u1', name: 'แนน' },
  ...o,
});

// ถ้อยคำตามกระดาน TimelineRows — ต่อคำตรง ๆ ไม่มีช่องว่างหลัง "ทาง" / "จาก"
const TITLES: Array<[Partial<Row> & Pick<Row, 'kind'>, string, JourneyStage | null]> = [
  [{ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED' }, 'ติดต่อทางโทร: นัดแล้ว', 'INTERESTED'],
  [{ kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'VISITED' }, 'ติดต่อทางLINE: มาร้านแล้ว', 'INTERESTED'],
  [{ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'BUDGET' }, 'ติดต่อทางแชทในแอป FB: งบ/ดาวน์ไม่พอ', null],
  [{ kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'NO_ANSWER' }, 'ติดต่อทางหน้าร้าน: ไม่รับสาย', null],
  [{ kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'THINKING' }, 'ติดต่อทางอื่น ๆ: ขอคิดก่อน', null],
  [{ kind: 'TOUCHPOINT', channel: null, outcome: 'toString' }, 'ติดต่อทางอื่น ๆ: บันทึกแล้ว', null],
  [{ kind: 'HEARD_FROM', heardFrom: 'WALK_BY' }, 'ลูกค้าบอกว่ารู้จักร้านจากผ่านหน้าร้าน', null],
  [{ kind: 'HEARD_FROM', heardFrom: 'RADIO' }, 'ลูกค้าบอกว่ารู้จักร้านจากอื่น ๆ', null],
  [{ kind: 'MARKED_LOST', lostReason: 'CREDIT_FAILED' }, 'ติดป้ายหลุด: เครดิตไม่ผ่าน', null],
  [{ kind: 'MARKED_LOST', lostReason: null }, 'ติดป้ายหลุด: อื่น ๆ', null],
  [{ kind: 'REOPENED' }, 'เปิดใหม่', null],
];

describe('manualEntryToEvent — ตัวแปลงเดียวของรายการและคำตอบ POST journey/entries', () => {
  it.each(TITLES)('%j → "%s" ขั้น %s', (fields, title, stage) => {
    const event = manualEntryToEvent(row({ id: 'm1', ...fields }), OWNER, NOW);
    expect(event).toMatchObject({
      id: 'entry-m1',
      type: fields.kind,
      group: 'chat',
      stage,
      timestamp: '2026-09-14T03:00:00.000Z',
      title,
      actor: { type: 'STAFF', id: 'u1', name: 'แนน' },
      reliability: 'exact',
      origin: 'MANUAL',
    });
    expect(event).not.toHaveProperty('href');
    expect(event).not.toHaveProperty('metadata');
    expect(manualEntryTitle(row({ id: 'm1', ...fields }))).toBe(title);
  });

  it('ผู้กระทำจาก actorUser · actorType ไม่รู้จัก = SYSTEM · origin อื่น = SYSTEM_ENTRY · ลิงก์ห้องเฉพาะบทบาทที่เห็นแชท · ไม่มี note', () => {
    expect(manualEntryToEvent(row({ id: 'a', kind: 'REOPENED', actorUser: null }), OWNER, NOW).actor).toEqual({ type: 'STAFF' });
    expect(manualEntryToEvent(row({ id: 'b', kind: 'REOPENED', actorType: 'ROBOT', actorUser: null }), OWNER, NOW).actor).toEqual({ type: 'SYSTEM' });
    expect(manualEntryToEvent(row({ id: 'c', kind: 'REOPENED', origin: 'SYSTEM' }), OWNER, NOW).origin).toBe('SYSTEM_ENTRY');
    const inRoom = row({ id: 'd', kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'THINKING', roomId: 'r1' });
    expect(manualEntryToEvent(inRoom, OWNER, NOW).href).toBe('/inbox/r1');
    const accountant = manualEntryToEvent(inRoom, { id: 'a1', role: 'ACCOUNTANT' }, NOW);
    expect(accountant).not.toHaveProperty('href');
    expect(accountant).not.toHaveProperty('note');
  });

  it('isManualEntryKind: เฉพาะ 4 kind ของบันทึกมือ', () => {
    expect(['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'].every(isManualEntryKind)).toBe(true);
    expect(['CONTRACT_ACTIVATED', 'PLACEHOLDER_MERGED', 'NOTE'].some(isManualEntryKind)).toBe(false);
  });

  it('ทางรายการ (entries.source) ได้แถวเดียวกับตัวแปลงทุกช่อง — list กับคำตอบ POST หลุดจากกันไม่ได้', async () => {
    const rows = [
      row({ id: 't', kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'VISITED', occurredAt: new Date('2026-09-14T06:00:00.000Z') }),
      row({ id: 'h', kind: 'HEARD_FROM', heardFrom: 'TIKTOK', occurredAt: new Date('2026-09-14T05:00:00.000Z') }),
      row({ id: 'l', kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', occurredAt: new Date('2026-09-14T04:00:00.000Z') }),
      row({ id: 'r', kind: 'REOPENED', occurredAt: new Date('2026-09-14T03:00:00.000Z') }),
    ];
    const prisma = {
      customerJourneyEntry: { findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r, refType: null, refId: null, data: null }))) },
      customerTag: { findMany: jest.fn().mockResolvedValue([]) },
      chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events).toEqual(rows.map((r) => manualEntryToEvent(r, OWNER, NOW)));
  });
});
