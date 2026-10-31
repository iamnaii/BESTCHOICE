import { Prisma } from '@prisma/client';

/**
 * Task 33 (mockup C1–C3 "ยินยอมตอนผูก" ที่เจ้าของอนุมัติ — แบบบังคับ) — ความยินยอมเป็นส่วนหนึ่งของการผูก LINE การเงิน:
 * ลูกค้าติ๊กที่หน้า `/liff/finance-verify` ขั้นกรอกเบอร์ แล้ว `POST chatbot/finance/liff/verify-otp` ส่ง `consent: true` ·
 * บันทึก `pdpa_consents` สถานะ GRANTED **ในทรานแซกชันเดียวกับการผูก** (`VerificationService.bindInTx` — หลังล็อกลูกค้า)
 * ตอนรหัส OTP ถูกเท่านั้น · ครั้งเดียวต่อลูกค้าต่อเวอร์ชันข้อความ: มีแถว GRANTED ของวัตถุประสงค์ + เวอร์ชันนี้อยู่แล้ว = ไม่สร้างซ้ำ
 *
 * ถอนความยินยอม: ลูกค้าทำเองใน LIFF ไม่ได้ (ไม่มีหน้า) — ติดต่อเจ้าหน้าที่ → OWNER กด "เพิกถอน" ที่เมนู PDPA (`PDPAService.revokeConsent`)
 * แล้วผูกใหม่ + ยินยอมอีกครั้ง = แถว GRANTED ใหม่
 */

/** ข้อความที่ลูกค้าติ๊ก — ตรงกับหน้า LIFF (`apps/web` `LINE_FINANCE_CONSENT_TEXT`) ทุกตัวอักษร · เก็บใน `privacyNoticeText` */
export const LINE_FINANCE_CONSENT_TEXT =
  'ยินยอมให้บริษัทส่งแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE';

/** วัตถุประสงค์ (ช่อง `purposes`) — ใช้ตัดสิน "มีแถว GRANTED ของวัตถุประสงค์เดียวกันแล้ว" */
export const LINE_FINANCE_CONSENT_PURPOSE = 'แจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE';

/**
 * เวอร์ชันของข้อความยินยอมนี้ (`consentVersion`) — แยกจาก `pdpa_privacy_notice_version` ซึ่งเป็นเวอร์ชันประกาศของสัญญาผ่อน
 * (คนละข้อความ · หน้า LIFF ลิงก์ไป `/privacy`) · เปลี่ยนข้อความเมื่อไรต้องเปลี่ยนค่านี้พร้อมกัน
 */
export const LINE_FINANCE_CONSENT_VERSION = 'line-finance-verify-2026-10';

/**
 * 400 ของ `verify-otp` ที่ไม่มี `consent: true` — หน้า LIFF รุ่นเก่าที่ค้างในเครื่องลูกค้าจะเจอทางนี้ ⇒ บอกทางของลูกค้าเอง
 * (บอทการเงินตอบการ์ด "เริ่มยืนยันตัวตน" ให้ LINE ที่ยังไม่ผูกทุกข้อความ — ตรวจแล้วใน Task 22/24 · `FINANCE_LINE_SELF_LINK_TEXT` ของเว็บ)
 */
export const LINE_FINANCE_CONSENT_REQUIRED_MESSAGE =
  'หน้านี้เป็นรุ่นเก่า กรุณาปิดหน้านี้ แล้วส่งข้อความใดก็ได้ในแชท LINE น้องเบส จากนั้นกด “เริ่มยืนยันตัวตน” เพื่อเปิดหน้าใหม่ และติ๊กยินยอมรับแจ้งเตือนทาง LINE ก่อนยืนยันรหัส OTP';

/** ความยินยอมที่ controller ส่งต่อ (DTO บังคับ `consent === true` แล้ว) + หลักฐานแบบเดียวกับ `PDPAService.recordConsent` */
export interface LineFinanceConsentInput {
  granted: true;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** หลักฐานยาวเกินไม่มีประโยชน์ — ตัดก่อนเก็บ (user agent ของแอป LINE ~200 ตัว) */
const EVIDENCE_MAX_LENGTH = 500;

/**
 * แถว GRANTED ที่ยังมีผลของวัตถุประสงค์นี้ **ทุกเวอร์ชันข้อความ** — "ลูกค้าเคยยินยอมรับข้อความทาง LINE แล้ว"
 * (ใช้ตัดสินว่าไม่ต้องถามซ้ำที่อื่น เช่นโมดัล `chat_consent` ของ `/liff/contract`)
 */
export const GRANTED_LINE_FINANCE_CONSENT_WHERE = {
  status: 'GRANTED',
  deletedAt: null,
  purposes: { has: LINE_FINANCE_CONSENT_PURPOSE },
} satisfies Prisma.PDPAConsentWhereInput;

/**
 * เกณฑ์ "ครั้งเดียวต่อลูกค้า" ของการบันทึก — **ต่อเวอร์ชันข้อความ** (fix round 1 M2): เปลี่ยนข้อความ = เปลี่ยน `LINE_FINANCE_CONSENT_VERSION`
 * ⇒ ลูกค้าที่เคยยินยอมฉบับเก่าแล้วผูกใหม่ (ติ๊กข้อความฉบับใหม่) ได้แถวของฉบับใหม่ และหน้า C3 แสดงวันที่ของฉบับที่ติ๊กจริง
 */
export function grantedLineFinanceConsentWhere(customerId: string) {
  return {
    customerId,
    ...GRANTED_LINE_FINANCE_CONSENT_WHERE,
    consentVersion: LINE_FINANCE_CONSENT_VERSION,
  } satisfies Prisma.PDPAConsentWhereInput;
}

/**
 * บันทึกความยินยอมใน tx ของผู้เรียก (ผู้เรียกเดียว: `VerificationService.bindInTx` — ถือล็อกแถวลูกค้าคนนี้ `FOR NO KEY UPDATE` อยู่แล้ว
 * ⇒ อ่าน-แล้วสร้างไม่ซ้อนกันสำหรับลูกค้าคนเดียวกัน · insert อ้าง FK ถือแค่ KEY SHARE ไม่ชนล็อกนั้น · ไม่ล็อกตารางอื่นเพิ่ม (ลำดับ
 * ลูกค้า → link → ห้อง ของ Task 29 คงเดิม)) · ทรานแซกชันถูกลองใหม่ = แถวรอบก่อนถูก rollback ไปแล้ว อ่านใหม่ทุกรอบ ⇒ ไม่ซ้ำ
 * คืนวันที่บันทึก (`grantedAt`) ของแถวที่มีผล — แถวเดิมหรือแถวใหม่
 */
export async function recordLineFinanceConsentInTx(
  tx: Prisma.TransactionClient,
  customerId: string,
  consent: LineFinanceConsentInput,
  now: Date,
): Promise<{ consentId: string; grantedAt: Date; created: boolean }> {
  if (consent?.granted !== true) {
    // ผู้เรียกทุกทางผ่าน DTO ที่บังคับ true แล้ว — ตาข่ายกันการเรียก service ตรง (fail closed)
    throw new Error('line-finance consent missing');
  }
  const existing = await tx.pDPAConsent.findFirst({
    where: grantedLineFinanceConsentWhere(customerId),
    orderBy: { createdAt: 'asc' },
    select: { id: true, grantedAt: true, createdAt: true },
  });
  if (existing) {
    return {
      consentId: existing.id,
      grantedAt: existing.grantedAt ?? existing.createdAt,
      created: false,
    };
  }
  const created = await tx.pDPAConsent.create({
    data: {
      customerId,
      consentVersion: LINE_FINANCE_CONSENT_VERSION,
      privacyNoticeText: LINE_FINANCE_CONSENT_TEXT,
      purposes: [LINE_FINANCE_CONSENT_PURPOSE],
      status: 'GRANTED',
      grantedAt: now,
      ipAddress: consent.ipAddress?.slice(0, EVIDENCE_MAX_LENGTH) || null,
      deviceInfo: consent.userAgent?.slice(0, EVIDENCE_MAX_LENGTH) || null,
    },
    select: { id: true, grantedAt: true },
  });
  return { consentId: created.id, grantedAt: created.grantedAt ?? now, created: true };
}
