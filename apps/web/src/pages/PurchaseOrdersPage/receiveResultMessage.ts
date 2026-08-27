// ข้อความยืนยันหลังรับของ — ต้องบอก "ของไปอยู่ไหนจริง ๆ" ไม่ใช่ขั้นตอนที่ระบบไม่ได้ทำ
//
// ตั้งแต่ commit f643d4527 (2026-03-06 "skip QC step") การรับของเขียนสถานะสินค้าตรง ๆ:
//   PHONE_USED            → PHOTO_PENDING (ยังขายไม่ได้ ต้องถ่ายรูป 6 มุมก่อน)
//   PHONE_NEW / ACCESSORY → IN_STOCK      (เข้าคลังพร้อมขายทันที)
// ไม่มีสถานะ QC_PENDING จากเส้นทางนี้อีกแล้ว ⇒ ข้อความเดิมที่ลงท้ายว่า "→ รอ QC ที่คลัง …"
// ส่งผู้ใช้ไปหาคิวที่ไม่มีวันมีของ (po-receiving.service.ts:185)
//
// นับจาก products[].status ที่ API คืนมา (ไม่ต้องแก้ฝั่ง API — goodsReceiving คืนแถว
// Product เต็มใบอยู่แล้ว) เพื่อให้ข้อความสะท้อนของจริงทีละชิ้น ไม่ใช่เดาจากหมวดหมู่

export interface ReceiveResultInput {
  passed: number;
  rejected: number;
  mainWarehouse: string;
  /** แถว Product ที่ผ่านการตรวจ — ไม่มี/ว่าง = ไม่มีของเข้าคลัง (ตกทุกชิ้น) */
  products?: { status?: string | null }[];
  /** มีเฉพาะเส้นทาง "รับเข้าตรง" ที่ระบบออกเลข PO ให้เอง */
  poNumber?: string;
}

export function buildReceiveResultMessage(r: ReceiveResultInput): string {
  const head = r.poNumber ? `รับเข้าตรงสำเร็จ (${r.poNumber})` : 'รับ+ตรวจสำเร็จ';

  const counts =
    r.rejected > 0 ? `ผ่าน ${r.passed} ชิ้น, ไม่ผ่าน ${r.rejected} ชิ้น` : `ผ่าน ${r.passed} ชิ้น`;

  const products = r.products ?? [];
  const inStock = products.filter((p) => p?.status === 'IN_STOCK').length;
  const photoPending = products.filter((p) => p?.status === 'PHOTO_PENDING').length;

  // ตกทุกชิ้น (หรือ API ไม่ได้ส่ง products มา) — อย่าอ้างว่ามีของเข้าคลัง
  if (inStock === 0 && photoPending === 0) return `${head}: ${counts}`;

  if (photoPending === 0) {
    return `${head}: ${counts} → เข้าคลัง ${r.mainWarehouse} พร้อมขาย`;
  }
  if (inStock === 0) {
    return `${head}: ${counts} → เข้าคลัง ${r.mainWarehouse} แล้ว รอถ่ายรูป 6 มุมก่อนขึ้นขาย`;
  }
  return `${head}: ${counts} → เข้าคลัง ${r.mainWarehouse}: พร้อมขาย ${inStock} ชิ้น, รอถ่ายรูป ${photoPending} ชิ้น`;
}
