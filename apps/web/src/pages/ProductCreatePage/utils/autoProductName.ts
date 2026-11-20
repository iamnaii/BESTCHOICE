/**
 * ชื่อสินค้าที่ระบบตั้งให้เมื่อผู้ใช้เว้นช่อง "ชื่อสินค้า" ว่าง — ตัวเดียวที่ใช้ทั้งพรีวิวในฟอร์มและตอนบันทึก
 * (เดิมคำนวณเฉพาะตอนกดบันทึก ⇒ ช่องชื่อดูว่างตลอด ผู้ใช้ไม่รู้ว่าจะได้ชื่ออะไร)
 */
export interface AutoNameInput {
  category: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  accessoryType: string;
  accessoryBrand: string;
}

export function buildAutoProductName(form: AutoNameInput): string {
  if (form.category !== 'ACCESSORY') {
    return [form.brand, form.model, form.color, form.storage].filter(Boolean).join(' ');
  }
  if (form.accessoryType === 'ชุดชาร์จ') {
    return [form.accessoryType, form.accessoryBrand, form.model].filter(Boolean).join(' ');
  }
  const accParts = [form.accessoryType, form.accessoryBrand].filter(Boolean).join(' ');
  return form.model ? `${accParts} สำหรับ ${form.model}` : accParts;
}
