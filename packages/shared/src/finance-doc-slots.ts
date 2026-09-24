/** ช่องเอกสารของใบยื่นไฟแนนซ์นอก — ลำดับ = ลำดับแสดงผล (ตรงกับ Prisma enum ExternalFinanceDocSlot) */
export const FINANCE_DOC_SLOTS = [
  'ID_SELFIE', 'ID_CARD', 'INCOME', 'FB_PROFILE', 'FB_FRIENDS', 'FB_ACTIVITY', 'LINE_PROFILE',
  'DEVICE_SCREEN', 'DEVICE_PHOTO', 'GUARANTOR_ID', 'ADDRESS_BILL', 'PHONE_OPENING', 'OTHER',
] as const;
export type FinanceDocSlot = (typeof FINANCE_DOC_SLOTS)[number];
export const FINANCE_SLOT_LABELS: Record<FinanceDocSlot, string> = {
  ID_SELFIE: 'ลูกค้าถือบัตร',
  ID_CARD: 'บัตรประชาชน',
  INCOME: 'สลิปเงินเดือน / สเตทเม้น',
  FB_PROFILE: 'หน้าเฟซบุ๊ก',
  FB_FRIENDS: 'เพื่อนเฟซบุ๊ก',
  FB_ACTIVITY: 'ความเคลื่อนไหวเฟซบุ๊ก',
  LINE_PROFILE: 'หน้าไลน์ลูกค้า',
  DEVICE_SCREEN: 'หน้าจอตั้งค่าเครื่อง',
  DEVICE_PHOTO: 'รูปเครื่อง 6 มุม',
  GUARANTOR_ID: 'บัตรคนค้ำ (ถ้ามี)',
  ADDRESS_BILL: 'บิลที่อยู่ (ถ้ามี)',
  PHONE_OPENING: 'ระยะเวลาเปิดเบอร์ (ถ้ามี)',
  OTHER: 'อื่น ๆ',
};
export const FINANCE_SLOT_ORDER: FinanceDocSlot[] = [...FINANCE_DOC_SLOTS];
/** ช่องที่ต้องมีไฟล์ก่อนส่ง (spec §8) */
export const FINANCE_REQUIRED_SLOTS: FinanceDocSlot[] = ['ID_SELFIE', 'ID_CARD', 'INCOME'];
/** 9 ช่องหลักที่โชว์เสมอ — ที่เหลือ "ถ้ามี" */
export const FINANCE_PRIMARY_SLOTS: FinanceDocSlot[] = ['ID_SELFIE', 'ID_CARD', 'INCOME', 'FB_PROFILE', 'FB_FRIENDS', 'FB_ACTIVITY', 'LINE_PROFILE', 'DEVICE_SCREEN', 'DEVICE_PHOTO'];
