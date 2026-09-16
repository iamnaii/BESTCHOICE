import type { JourneyEventGroup, JourneyStage } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSourceFor } from './entries.source';
import {
  JOURNEY_UNDO_WINDOW_MS,
  canDeleteManualEntry,
  isManualEntryKind,
  manualEntryTitle,
  manualEntryToEvent,
  manualEntryUndoFields,
  type ManualEntryEventRow,
  type ManualEntryUndoRow,
} from './manual-entry-event';

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

describe('หน้าต่างเลิกทำ — canDeleteManualEntry / manualEntryUndoFields (TimelineRows e1-e5 · Q5 · Q18)', () => {
  const NOW = new Date('2026-09-15T10:00:00.000Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const until = (createdAt: Date) => new Date(createdAt.getTime() + JOURNEY_UNDO_WINDOW_MS).toISOString();
  const SOMSRI = { id: 'staff-somsri', role: 'SALES' };
  const MANA_ID = 'staff-mana';
  const row = (o: Partial<ManualEntryUndoRow> = {}): ManualEntryUndoRow => ({
    id: 'e1',
    origin: 'MANUAL',
    createdAt: ago(5 * MINUTE),
    actorUserId: SOMSRI.id,
    ...o,
  });

  it('หน้าต่าง = 24 ชั่วโมง', () => {
    expect(JOURNEY_UNDO_WINDOW_MS).toBe(86_400_000);
  });

  it('e1 ผู้ดูเป็นผู้บันทึก 5 นาทีที่แล้ว → เลิกทำได้ · undoableUntil = createdAt + 24 ชม.', () => {
    const createdAt = ago(5 * MINUTE);
    expect(manualEntryUndoFields(row({ createdAt }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(createdAt), canDelete: true });
  });

  it('e2 ผู้บันทึก 22 ชม. → ยังเลิกทำได้ · ครบ 24 ชม. พอดียังได้ · เกิน 1 มิลลิวินาทีไม่ได้', () => {
    const created22h = ago(22 * HOUR);
    expect(manualEntryUndoFields(row({ createdAt: created22h }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(created22h), canDelete: true });
    const created24h = ago(24 * HOUR);
    expect(manualEntryUndoFields(row({ createdAt: created24h }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(created24h), canDelete: true });
    expect(manualEntryUndoFields(row({ createdAt: ago(24 * HOUR + 1) }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
  });

  it('e3 ผู้บันทึก 29 ชม. → ลิงก์หาย (canDelete false · undoableUntil null)', () => {
    expect(manualEntryUndoFields(row({ createdAt: ago(29 * HOUR) }), SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
  });

  it('e4 แถวของพนักงานคนอื่น → SALES และผู้จัดการการเงินเลิกทำไม่ได้ · ผู้บันทึกถูกลบบัญชี (actorUserId null) ไม่นับเป็นของใคร', () => {
    const others = row({ actorUserId: MANA_ID, createdAt: ago(3 * HOUR) });
    expect(manualEntryUndoFields(others, SOMSRI, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    expect(manualEntryUndoFields(others, { id: 'fm-1', role: 'FINANCE_MANAGER' }, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    expect(canDeleteManualEntry({ actorUserId: null, createdAt: ago(MINUTE) }, SOMSRI, NOW)).toBe(false);
  });

  it('e5 OWNER / ผู้จัดการสาขา ดูแถวของคนอื่น → เลิกทำได้ทุกเวลา แต่ undoableUntil เป็นของผู้บันทึกเท่านั้น (null)', () => {
    for (const role of ['OWNER', 'BRANCH_MANAGER']) {
      const viewer = { id: `viewer-${role}`, role };
      expect(manualEntryUndoFields(row({ actorUserId: MANA_ID, createdAt: ago(2 * HOUR) }), viewer, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: true });
      expect(manualEntryUndoFields(row({ actorUserId: MANA_ID, createdAt: ago(400 * 24 * HOUR) }), viewer, NOW)).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: true });
    }
  });

  it('OWNER ที่บันทึกเองในหน้าต่าง ได้ undoableUntil ด้วย · ผู้จัดการการเงินเลิกทำแถวของตัวเองได้ภายใน 24 ชม.', () => {
    const createdAt = ago(MINUTE);
    expect(manualEntryUndoFields(row({ actorUserId: 'owner-1', createdAt }), { id: 'owner-1', role: 'OWNER' }, NOW)).toEqual({ entryId: 'e1', undoableUntil: until(createdAt), canDelete: true });
    expect(canDeleteManualEntry({ actorUserId: 'fm-1', createdAt: ago(22 * HOUR) }, { id: 'fm-1', role: 'FINANCE_MANAGER' }, NOW)).toBe(true);
  });

  it('แถวที่ระบบบันทึก (origin SYSTEM) ไม่มีสามคีย์นี้เลย', () => {
    expect(manualEntryUndoFields(row({ origin: 'SYSTEM', actorUserId: SOMSRI.id }), { id: 'owner-1', role: 'OWNER' }, NOW)).toEqual({});
  });

  it('manualEntryToEvent (ทางเดียวกับคำตอบ POST): แถวที่เพิ่งเขียน createdAt = now → entryId + undoableUntil = now + 24 ชม. + canDelete', () => {
    const fresh = {
      id: 'e-new', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: NOW, createdAt: NOW, actorType: 'STAFF',
      roomId: null, refType: null, refId: null, data: null, channel: 'PHONE', outcome: 'APPOINTED', lostReason: null, heardFrom: null,
      actorUser: { id: SOMSRI.id, name: 'สมศรี ตัวอย่าง' },
    } as unknown as Parameters<typeof manualEntryToEvent>[0];
    expect(manualEntryToEvent(fresh, SOMSRI, NOW)).toMatchObject({
      origin: 'MANUAL',
      entryId: 'e-new',
      undoableUntil: '2026-09-16T10:00:00.000Z',
      canDelete: true,
    });
  });
});
