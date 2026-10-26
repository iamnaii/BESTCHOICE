/**
 * ขนาดม้วนสติกเกอร์ติดเครื่องที่รองรับ — ค่าจาก SystemConfig `sticker_size` ผ่าน ui-flags (ก้อน 3 A5)
 * แยกไฟล์จาก StickerCard เพื่อให้หน้าตั้งค่าใช้ตารางนี้ได้โดยไม่ดึง qrcode.react/CSS ของดวงเข้า chunk
 */
export type StickerSize = '60x40' | '50x40' | '50x30';

export const STICKER_SIZES: Record<StickerSize, { w: number; h: number; label: string; hint: string }> = {
  '60x40': {
    w: 60,
    h: 40,
    label: '60 × 40 มม.',
    hint: 'แนะนำ — ต้องเป็น Xprinter 3 นิ้วขึ้นไป (XP-365B / 420B / 470B) ถึงพิมพ์กว้าง 60 มม. ได้',
  },
  '50x40': {
    w: 50,
    h: 40,
    label: '50 × 40 มม.',
    hint: 'สำหรับ Xprinter 2 นิ้ว (XP-233B / 237B) ที่หัวพิมพ์กว้างแค่ 48–56 มม.',
  },
  '50x30': {
    w: 50,
    h: 30,
    label: '50 × 30 มม.',
    hint: 'ม้วนเดิม — ตัวหนังสือและ QR เล็กลง ใช้จนกว่าม้วนจะหมด',
  },
};

export const DEFAULT_STICKER_SIZE: StickerSize = '60x40';
