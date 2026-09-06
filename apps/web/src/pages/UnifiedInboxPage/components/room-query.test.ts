import { describe, it, expect } from 'vitest';
import { buildRoomListParams } from './room-query';
import type { InboxFilters } from './ConversationList';

const base: InboxFilters = { tab: 'waiting', channel: null, who: 'all', view: 'queue' };
const ME = 'u-me';

describe('buildRoomListParams — ตัวกรอง → พารามิเตอร์ของเซิร์ฟเวอร์', () => {
  it.each<[string, InboxFilters, Record<string, unknown>]>([
    ['รอตอบ ค่าเริ่มต้น', base, { waiting: true, expired: undefined, assignedToId: undefined, unassignedOnly: undefined, channels: undefined }],
    ['รอตอบ + ค้นหา ยังส่ง waiting (เซิร์ฟเวอร์ต้องประกอบด้วย AND ไม่ทิ้งค้นหา)', { ...base, search: 'สมชาย' }, { waiting: true, search: 'สมชาย' }],
    ['ตอบไม่ทัน = expired ไม่ใช่ waiting', { ...base, view: 'expired' }, { waiting: undefined, expired: true }],
    ['ตอบไม่ทัน + ช่องทาง ส่งทั้งคู่ (เซิร์ฟเวอร์ AND กัน)', { ...base, view: 'expired', channel: 'LINE_SHOP' }, { expired: true, channels: 'LINE_SHOP' }],
    ['ของฉัน ล็อกผู้ดูแลเป็นตัวเอง แม้เมนูเลือกคนอื่น', { ...base, tab: 'mine', who: 'u-other' }, { assignedToId: ME, unassignedOnly: undefined, waiting: undefined, openOnly: true }],
    ['ทั้งหมด → ไม่ส่ง openOnly (ห้องปิดแล้วอยู่ท้ายรายการ)', { ...base, tab: 'all' }, { openOnly: undefined }],
    ['ของฉัน + ยังไม่มีคนดูแล → ไม่ส่ง unassignedOnly (ขัดกัน)', { ...base, tab: 'mine', who: 'free' }, { assignedToId: ME, unassignedOnly: undefined }],
    ['ทั้งหมด + ยังไม่มีคนดูแล', { ...base, tab: 'all', who: 'free' }, { assignedToId: undefined, unassignedOnly: true, waiting: undefined, expired: undefined }],
    ['รอตอบ + พนักงานคนหนึ่ง', { ...base, who: 'u-x' }, { assignedToId: 'u-x', unassignedOnly: undefined, waiting: true }],
    ['view expired บนแท็บอื่นไม่มีผล', { ...base, tab: 'all', view: 'expired' }, { waiting: undefined, expired: undefined }],
    ['ค้นหาว่าง → ไม่ส่ง', { ...base, search: '' }, { search: undefined }],
  ])('%s', (_name, filters, expected) => {
    expect(buildRoomListParams(filters, ME)).toMatchObject(expected);
  });
});
