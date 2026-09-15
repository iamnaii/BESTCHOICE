import { JOURNEY_ENTRY_KINDS, type JourneySystemEntryKind } from '@installment/shared';
import { JOURNEY_DATA_SCHEMAS, journeyDedupeKey, sanitizeJourneyData } from './journey-data-schemas';

const PRODUCT_ID = '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21';

/** รูป data ที่ hook ของ Task 4-6 ส่งจริง — ถ้า hook เปลี่ยนรูป ต้องแก้ตารางใน Task 2 และที่นี่พร้อมกัน */
const HOOK_DATA: Record<JourneySystemEntryKind, Record<string, unknown>> = {
  CONTRACT_ACTIVATED: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 },
  CONTRACT_REVIEWED: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' },
  CREDIT_CHECK_OPENED_BY: { via: 'CUSTOMER' },
  CREDIT_AI_SCORED: { score: 95, status: 'APPROVED' },
  BOT_HANDOFF: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
  CONTACT_ADDED: { fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' },
  LINE_LINKED: { channel: 'FINANCE', via: 'VERIFICATION' },
  PRODUCT_LINK_CLICK: { productId: PRODUCT_ID },
  PLACEHOLDER_MERGED: { roomCount: 2 },
};

describe('JOURNEY_DATA_SCHEMAS', () => {
  it('มี schema ครบทุก kind ใน JOURNEY_ENTRY_KINDS (SYSTEM + MANUAL) ไม่ขาดไม่เกิน', () => {
    const expected = [...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL].sort();
    expect(Object.keys(JOURNEY_DATA_SCHEMAS).sort()).toEqual(expected);
  });

  it('รูป data ที่ hook ของ Task 4-6 ส่งจริงผ่านครบทุกคีย์ · คะแนน AI เป็น null ได้', () => {
    for (const [kind, data] of Object.entries(HOOK_DATA)) {
      expect(sanitizeJourneyData(kind, data)).toEqual({ ok: true, data });
    }
    expect(sanitizeJourneyData('CREDIT_AI_SCORED', { score: null, status: 'MANUAL_REVIEW' })).toEqual({
      ok: true,
      data: { score: null, status: 'MANUAL_REVIEW' },
    });
  });

  it('ตัดคีย์ที่ไม่อยู่ใน whitelist ทิ้ง — เบอร์ เลขบัตร lineUserId ข้อความเหตุผล/ลูกค้า โน้ตผู้ตรวจ ไม่หลุดเข้าแถว', () => {
    expect(
      sanitizeJourneyData('CONTACT_ADDED', { fields: ['phone'], via: 'UPDATE', phone: '0812345678', nationalId: '1103700012345' }),
    ).toEqual({ ok: true, data: { fields: ['phone'], via: 'UPDATE' } });
    expect(
      sanitizeJourneyData('LINE_LINKED', { channel: 'SHOP', via: 'SELF_LINK_PHONE', lineUserId: 'U1234abcd', phone: '0812345678' }),
    ).toEqual({ ok: true, data: { channel: 'SHOP', via: 'SELF_LINK_PHONE' } });
    expect(
      sanitizeJourneyData('BOT_HANDOFF', {
        priority: 'normal',
        reasonCode: 'CUSTOMER_REQUEST',
        reason: 'ลูกค้าขอคุยกับพนักงาน',
        summary: 'เบอร์ผม 0812345678',
        tags: ['slip'],
      }),
    ).toEqual({ ok: true, data: { priority: 'normal', reasonCode: 'CUSTOMER_REQUEST' } });
    expect(
      sanitizeJourneyData('CREDIT_AI_SCORED', { score: 72, status: 'APPROVED', aiSummary: 'รายได้ประจำ', aiRecommendation: 'แนะนำอนุมัติ' }),
    ).toEqual({ ok: true, data: { score: 72, status: 'APPROVED' } });
    expect(
      sanitizeJourneyData('CONTRACT_REVIEWED', { decision: 'REJECTED', contractNumber: 'BCP2609-00042', reviewNotes: 'บัตรหมดอายุ' }),
    ).toEqual({ ok: true, data: { decision: 'REJECTED', contractNumber: 'BCP2609-00042' } });
    expect(
      sanitizeJourneyData('CONTRACT_ACTIVATED', { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813, customer: { phone: '0812345678' } }),
    ).toEqual({ ok: true, data: { contractNumber: 'BCP2609-00042', totalMonths: 12, monthlyPayment: 1813 } });
    expect(sanitizeJourneyData('TOUCHPOINT', { note: 'โทรกลับ 0812345678' })).toEqual({ ok: true, data: {} });
  });

  it('ค่านอกรายการปิด / ชนิดผิด → ok:false พร้อม path:code และ issues ไม่มีค่าจริงติดออกไป', () => {
    const leaked = sanitizeJourneyData('BOT_HANDOFF', { priority: 'high', reasonCode: 'โทร 0812345678' });
    expect(leaked).toEqual({ ok: false, issues: ['reasonCode:invalid_enum_value'] });
    expect(JSON.stringify(leaked)).not.toContain('5678');
    expect(sanitizeJourneyData('CONTACT_ADDED', { fields: ['phone'], via: 'STAFF_EDIT' })).toEqual({
      ok: false,
      issues: ['via:invalid_enum_value'],
    });
    expect(sanitizeJourneyData('LINE_LINKED', { channel: 'SHOP', via: 'OTP_VERIFY' })).toEqual({
      ok: false,
      issues: ['via:invalid_enum_value'],
    });
    expect(sanitizeJourneyData('PRODUCT_LINK_CLICK', { productId: 'p:ลูกค้ากดลิงก์' })).toEqual({
      ok: false,
      issues: ['productId:invalid_string'],
    });
    expect(sanitizeJourneyData('CREDIT_AI_SCORED', { score: 101, status: 'APPROVED' })).toEqual({ ok: false, issues: ['score:too_big'] });
    expect(sanitizeJourneyData('CONTACT_ADDED', { fields: [], via: 'UPDATE' })).toEqual({ ok: false, issues: ['fields:too_small'] });
    expect(
      sanitizeJourneyData('CONTRACT_ACTIVATED', { contractNumber: 'สัญญา 0812345678', totalMonths: 12, monthlyPayment: 1 }),
    ).toEqual({ ok: false, issues: ['contractNumber:invalid_string'] });
  });

  it('kind ที่ไม่รู้จัก → ok:false ไม่โยน', () => {
    expect(sanitizeJourneyData('SOMETHING_ELSE', { a: 1 })).toEqual({ ok: false, issues: ['kind:unknown'] });
  });

  it('journeyDedupeKey = `${kind}:${ส่วนอ้างอิง}` · ไม่มีส่วนอ้างอิงหรือส่วนว่าง → โยน', () => {
    expect(journeyDedupeKey('CONTRACT_ACTIVATED', 'k1')).toBe('CONTRACT_ACTIVATED:k1');
    expect(journeyDedupeKey('BOT_HANDOFF', 'r1', 1790000000000)).toBe('BOT_HANDOFF:r1:1790000000000');
    expect(journeyDedupeKey('CONTRACT_REVIEWED', 'k1', '2026-09-15T03:00:00.000Z')).toBe('CONTRACT_REVIEWED:k1:2026-09-15T03:00:00.000Z');
    expect(journeyDedupeKey('CONTACT_ADDED', 'c1', 'nationalId+phone')).toBe('CONTACT_ADDED:c1:nationalId+phone');
    expect(() => journeyDedupeKey('PLACEHOLDER_MERGED')).toThrow('journeyDedupeKey(PLACEHOLDER_MERGED)');
    expect(() => journeyDedupeKey('PLACEHOLDER_MERGED', ' ')).toThrow('journeyDedupeKey(PLACEHOLDER_MERGED)');
  });
});
