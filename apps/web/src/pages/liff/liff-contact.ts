/**
 * เบอร์สาขาที่หน้า LIFF การเงินใช้อยู่แล้ว (เท่า `FINANCE_CONTACT_PHONE` ของ API — บอทการเงิน/ข้อความระบบใช้เบอร์เดียวกัน)
 * — แหล่งเดียวของหน้า `/liff/finance-verify` และโมดัลความยินยอมของ `/liff/contract`
 */
export const LIFF_BRANCH_PHONE = '063-134-6356';

/**
 * Task 33 — ทางถอนความยินยอมที่มีจริง (ลูกค้าถอนเองใน LIFF ไม่ได้ · เจ้าหน้าที่ส่งเรื่องให้ OWNER กด "ถอน" ที่เมนู PDPA) —
 * ถ้อยคำของ mockup C3 · โมดัลของ `/liff/contract` ใช้ชุดเดียวกัน (คำตัดสินเจ้าของข้อ 30)
 */
export const LIFF_CONSENT_WITHDRAW_TEXT = `ติดต่อเจ้าหน้าที่ทางแชทนี้ หรือโทรหาสาขา ${LIFF_BRANCH_PHONE}`;
