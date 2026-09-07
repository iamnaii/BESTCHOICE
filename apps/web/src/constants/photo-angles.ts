/**
 * รูปสินค้า 6 มุมของมือสอง — ช่องตายตัวเดียวกับตาราง `ProductPhoto` ฝั่ง API
 * (front/back/left/right/top/bottom). ใช้ร่วมกันทั้งหน้ารับสินค้า คิวรอถ่ายรูป และหน้ายึดเครื่อง
 * (คำสั่งเจ้าของ 2026-09-07: ทุกทางเข้าคลังของมือสองใช้ชุด 6 มุมชุดเดียวกัน)
 */
export const PHOTO_ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];

/** ป้ายสั้นบนช่องถ่าย (หน้ารายละเอียดสินค้าใช้ "ด้านหน้า" แบบยาว — คนละบริบท) */
export const PHOTO_ANGLE_LABELS: Record<PhotoAngle, string> = {
  front: 'หน้า',
  back: 'หลัง',
  left: 'ซ้าย',
  right: 'ขวา',
  top: 'บน',
  bottom: 'ล่าง',
};

export type AnglePhotos = Record<PhotoAngle, string | null>;

export const emptyAnglePhotos = (): AnglePhotos => ({
  front: null,
  back: null,
  left: null,
  right: null,
  top: null,
  bottom: null,
});

export const anglesShot = (p: Partial<AnglePhotos> | null | undefined): number =>
  PHOTO_ANGLES.filter((a) => !!p?.[a]).length;

export const anglesComplete = (p: Partial<AnglePhotos> | null | undefined): boolean =>
  anglesShot(p) === PHOTO_ANGLES.length;

/** เฉพาะมุมที่มีรูป — รูปแบบที่ API รับ (`anglePhotos` บนรายการรับสินค้า); ไม่มีเลย = undefined */
export function shotAnglePhotos(
  p: Partial<AnglePhotos> | null | undefined,
): Partial<Record<PhotoAngle, string>> | undefined {
  const out: Partial<Record<PhotoAngle, string>> = {};
  for (const a of PHOTO_ANGLES) {
    const v = p?.[a];
    if (v) out[a] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
