import { Prisma, PrismaClient } from '@prisma/client';

/**
 * รูปสินค้า 6 มุมของมือสอง (`ProductPhoto` — ช่องตายตัว front/back/left/right/top/bottom)
 *
 * แหล่งเดียวของ "มุมไหนบ้าง / ครบหรือยัง" ให้ทุกทางเข้าคลังของมือสองใช้ร่วมกัน
 * (คำสั่งเจ้าของ 2026-09-07): หน้ารับสินค้า PO/รับเข้าตรง ถ่ายตรงนี้ได้เลย ·
 * ยึดเครื่องคืน/รับซื้อมือสอง ถ่ายที่คิว "รอถ่ายรูป" (`ProductPhotosService`) ·
 * คิวและหน้ายึดเครื่องโชว์ n/6 จาก `countPhotoAngles`
 */
export const PHOTO_ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];
export type AnglePhotoInput = Partial<Record<PhotoAngle, string | null | undefined>>;

/** เก็บเฉพาะมุมที่มีรูปจริง (สตริงไม่ว่าง) — ค่าอื่นทิ้งเงียบ ๆ */
export function pickAnglePhotos(input?: AnglePhotoInput | null): Partial<Record<PhotoAngle, string>> {
  const out: Partial<Record<PhotoAngle, string>> = {};
  if (!input) return out;
  for (const angle of PHOTO_ANGLES) {
    const v = input[angle];
    if (typeof v === 'string' && v.trim() !== '') out[angle] = v;
  }
  return out;
}

export const angleCount = (photos: Partial<Record<PhotoAngle, unknown>>): number =>
  PHOTO_ANGLES.filter((a) => !!photos[a]).length;

export const anglesComplete = (photos: Partial<Record<PhotoAngle, unknown>>): boolean =>
  angleCount(photos) === PHOTO_ANGLES.length;

/**
 * จำนวนมุมที่ถ่ายแล้วต่อเครื่อง — query เดียวทั้งชุด ไม่โหลด base64
 * (รูปแบบเดียวกับ `ProductsService.findOne` แต่หลาย id) · เครื่องที่ไม่มีแถวรูป = ไม่อยู่ใน Map
 */
export async function countPhotoAngles(
  client: Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient,
  productIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await client.$queryRaw<{ product_id: string; count: bigint | number }[]>`
    SELECT product_id,
           (CASE WHEN front IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN back IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN "left" IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN "right" IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN top IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN bottom IS NOT NULL THEN 1 ELSE 0 END) AS count
    FROM product_photos
    WHERE deleted_at IS NULL AND product_id IN (${Prisma.join(ids)})`;
  return new Map(rows.map((r) => [r.product_id, Number(r.count)]));
}
