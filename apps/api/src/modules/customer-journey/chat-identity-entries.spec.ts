import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeJourneyData } from './journey-data-schemas';
import type { JourneyEntryInput } from './journey-entry-writer.service';
import {
  HANDOFF_REASON_CODE_BY_TEXT,
  botHandoffEntry,
  contactAddedEntry,
  handoffReasonCode,
  isBlankContact,
  lineLinkedEntry,
  productLinkClickEntry,
} from './chat-identity-entries';

const AT = new Date('2026-10-02T03:04:05.000Z');
const CUSTOMER = 'c0ffee00-1111-4222-8333-444455556666';
const ROOM = '7d0c2a9b-aaaa-4bbb-8ccc-dddd00001111';
const PRODUCT = '11111111-2222-3333-4444-555555555555';

/** writer เก็บ sanitized.data ลงคอลัมน์ (พิสูจน์ใน db spec ของ Task 2) ⇒ data ของทุกแถวต้องผ่าน whitelist ครบทุกคีย์ */
function expectWhitelisted(entry: JourneyEntryInput): void {
  expect(sanitizeJourneyData(entry.kind, entry.data)).toEqual({ ok: true, data: entry.data });
}

describe('chat-identity-entries — แถว SYSTEM ฝั่งแชทและตัวตน', () => {
  describe('botHandoffEntry', () => {
    it('ผู้ทำ = บอท · ผูกห้อง · data มีแค่ priority + reasonCode · dedupe BOT_HANDOFF:<roomId>:<ms>', () => {
      const entry = botHandoffEntry({
        customerId: CUSTOMER,
        roomId: ROOM,
        reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
        priority: 'normal',
        taggedAt: AT,
      });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'BOT_HANDOFF',
        occurredAt: AT,
        actorType: 'BOT',
        actorUserId: null,
        roomId: ROOM,
        refType: null,
        refId: null,
        data: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
        dedupeKey: `BOT_HANDOFF:${ROOM}:${AT.getTime()}`,
      });
      expect(Object.keys(entry.data ?? {}).sort()).toEqual(['priority', 'reasonCode']);
      expectWhitelisted(entry);
    });

    it('PDPA: เหตุผลที่ไม่รู้จัก (อาจเป็นข้อความที่ AI เขียน มีชื่อ/เบอร์/ที่อยู่) → OTHER และข้อความไม่หลุดเข้าแถว', () => {
      const entry = botHandoffEntry({
        customerId: CUSTOMER,
        roomId: ROOM,
        reason: 'คุณสมชายให้โทรกลับ 081-234-5678 ที่บ้านเลขที่ 9',
        priority: 'high',
        taggedAt: AT,
      });
      expect(entry.data).toEqual({ priority: 'high', reasonCode: 'OTHER' });
      const json = JSON.stringify(entry);
      for (const secret of ['สมชาย', '081-234-5678', 'บ้านเลขที่']) expect(json).not.toContain(secret);
      expectWhitelisted(entry);
    });
  });

  describe('handoffReasonCode', () => {
    it.each([
      ['ส่งคำตอบบอทไม่สำเร็จ — ให้พนักงานติดต่อลูกค้า', 'BOT_SEND_FAILED'],
      ['AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน', 'LOW_CONFIDENCE'],
      ['ระบบ AI ขัดข้อง — ส่งต่อให้พนักงาน', 'AI_ERROR'],
      ['ลูกค้าขอพูดกับพนักงาน', 'CUSTOMER_REQUEST'],
      ['  ลูกค้าขอพูดกับพนักงาน  ', 'CUSTOMER_REQUEST'],
      ['เหตุผลใหม่จาก domain handler', 'OTHER'],
      ['constructor', 'OTHER'],
    ])('%p → %p', (reason, code) => {
      expect(handoffReasonCode(reason)).toBe(code);
    });

    it('กันข้อความในผู้เรียกเปลี่ยนแล้วรหัสกลายเป็น OTHER เงียบ ๆ — ทุกข้อความในตารางต้องยังอยู่ใน message-router.service.ts', () => {
      const source = readFileSync(join(__dirname, '../chat-engine/services/message-router.service.ts'), 'utf8');
      for (const text of Object.keys(HANDOFF_REASON_CODE_BY_TEXT)) {
        expect(source).toContain(`'${text}'`);
      }
    });
  });

  describe('contactAddedEntry', () => {
    it('เก็บแค่ชื่อช่องที่ได้มา ไม่เก็บค่า · ตัดซ้ำและเรียงคงที่ · dedupe CONTACT_ADDED:<customerId>:<fields>', () => {
      const entry = contactAddedEntry({
        customerId: CUSTOMER,
        fields: ['phone', 'nationalId', 'phone'],
        via: 'FILL_CONTACT',
        actorUserId: 'user-1',
        occurredAt: AT,
      });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'CONTACT_ADDED',
        occurredAt: AT,
        actorType: 'STAFF',
        actorUserId: 'user-1',
        roomId: null,
        refType: null,
        refId: null,
        data: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
        dedupeKey: `CONTACT_ADDED:${CUSTOMER}:nationalId+phone`,
      });
      expectWhitelisted(entry);
    });

    it('แก้ในหน้าลูกค้าโดยไม่มีผู้ทำ → actorUserId null แต่ยังเป็น STAFF', () => {
      const entry = contactAddedEntry({ customerId: CUSTOMER, fields: ['phone'], via: 'UPDATE', actorUserId: null, occurredAt: AT });
      expect(entry.actorType).toBe('STAFF');
      expect(entry.actorUserId).toBeNull();
      expect(entry.dedupeKey).toBe(`CONTACT_ADDED:${CUSTOMER}:phone`);
      expectWhitelisted(entry);
    });

    it('via CAPTURE_LEAD (สงวนไว้ตอนเปิดบอทขาย — เฟสนี้ไม่มีผู้เรียก) → ผู้ทำ = บอท actorUserId null เสมอ', () => {
      const entry = contactAddedEntry({ customerId: CUSTOMER, fields: ['phone'], via: 'CAPTURE_LEAD', actorUserId: 'ignored', occurredAt: AT });
      expect(entry).toMatchObject({ actorType: 'BOT', actorUserId: null, data: { fields: ['phone'], via: 'CAPTURE_LEAD' } });
      expectWhitelisted(entry);
    });
  });

  describe('lineLinkedEntry', () => {
    it('ผู้ทำ = ลูกค้า · data มีแค่ช่องทาง + วิธีผูก · dedupe LINE_LINKED:<channel>:<customerId>:<ms>', () => {
      const entry = lineLinkedEntry({ customerId: CUSTOMER, channel: 'FINANCE', via: 'VERIFICATION', occurredAt: AT });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'LINE_LINKED',
        occurredAt: AT,
        actorType: 'CUSTOMER',
        actorUserId: null,
        roomId: null,
        refType: null,
        refId: null,
        data: { channel: 'FINANCE', via: 'VERIFICATION' },
        dedupeKey: `LINE_LINKED:FINANCE:${CUSTOMER}:${AT.getTime()}`,
      });
      expectWhitelisted(entry);
    });
  });

  describe('productLinkClickEntry', () => {
    it('อ้างสินค้าด้วย refType product · ผูกห้อง · dedupe PRODUCT_LINK_CLICK:<roomId>:<productId>:<ms>', () => {
      const entry = productLinkClickEntry({ customerId: CUSTOMER, roomId: ROOM, productId: PRODUCT, occurredAt: AT });
      expect(entry).toEqual({
        customerId: CUSTOMER,
        kind: 'PRODUCT_LINK_CLICK',
        occurredAt: AT,
        actorType: 'CUSTOMER',
        actorUserId: null,
        roomId: ROOM,
        refType: 'product',
        refId: PRODUCT,
        data: { productId: PRODUCT },
        dedupeKey: `PRODUCT_LINK_CLICK:${ROOM}:${PRODUCT}:${AT.getTime()}`,
      });
      expectWhitelisted(entry);
    });
  });

  describe('isBlankContact', () => {
    it.each([
      [null, true],
      [undefined, true],
      ['', true],
      ['   ', true],
      ['0812345678', false],
    ])('%p → %p', (value, expected) => {
      expect(isBlankContact(value as string | null | undefined)).toBe(expected);
    });
  });
});
