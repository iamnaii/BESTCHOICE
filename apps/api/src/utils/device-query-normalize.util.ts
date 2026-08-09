/**
 * B0 §2.4 — แปลง utterance ลูกค้า (ไทย/ย่อ/สลับ) เป็นคีย์ค้นสินค้า
 *
 * ต้นฉบับ normalizeStorage/extractStorageToken ยกมาจาก
 * `modules/sales-bot/tools/get-installment-rates.tool.ts:76-85` แบบพฤติกรรม
 * เดียวกันเป๊ะ เพื่อให้ B3 re-point tool มาที่นี่ได้โดยผลลัพธ์ไม่เปลี่ยน
 */

const STORAGE_RE = /(\d+)\s*(gb|tb)\b/i;

export function normalizeStorage(storage: string | null | undefined): string {
  return (storage ?? '').toUpperCase().replace(/\s+/g, '');
}

export function extractStorageToken(text: string): string | null {
  const m = text.match(STORAGE_RE);
  if (!m) return null;
  return `${m[1]}${m[2].toUpperCase()}`;
}

export function stripStorageToken(text: string): string {
  return text.replace(STORAGE_RE, ' ').replace(/\s+/g, ' ').trim();
}

export interface DeviceQuery {
  brand: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  /** ข้อความที่เหลือหลังตัด brand/model/storage/color ออก (ใช้ค้นต่อได้) */
  rest: string;
}

/**
 * คำเรียก iPhone ในภาษาลูกค้า — **ไม่ใส่ ไอแพด/ipad** เพราะ util นี้คืน model
 * เป็นสตริง `iPhone <n>` เสมอ ถ้ารับ ipad เข้ามาจะได้ model ผิดชนิด
 * (และเว็บ/แคตตาล็อกขายเฉพาะ iPhone อยู่แล้ว — spec §0)
 */
const APPLE_TOKENS = ['ไอโฟน', 'ไอโฟ', 'iphone', 'ip'];
/**
 * ลูกค้าพิมพ์เลขรุ่นเปล่าๆ พ่วง variant: '15pm', '14 plus', '13' — ไม่มีคำว่า
 * ไอโฟน/ip เลย. อนุญาตเฉพาะรูปแบบ "ทั้งข้อความ = เลข 1-2 หลัก + variant"
 * เพื่อไม่ให้ข้อความทั่วไปที่บังเอิญมีเลข (เช่น 'ผ่อน 12 งวด') ถูกตีเป็น iPhone
 */
const BARE_MODEL_RE = /^\d{1,2}\s*(pm|promax|pro\s*max|pro|plus|\+|mini|p)?$/i;
/**
 * ต่อท้ายรุ่น: เรียงยาว→สั้น เพราะ 'โปรแม็กซ์' ต้องชนะ 'โปร'
 *
 * ⚠️ **ลำดับเป็น load-bearing:** บล็อก Plus ต้องอยู่ **ก่อน** Pro เสมอ —
 * การ match ใช้ `after.includes(t)` (ไม่ใช่ equality) และ Pro มี token `'p'`
 * ซึ่ง `' plus'.includes('p') === true` → ถ้า Pro มาก่อน '15 plus' จะกลายเป็น
 * 'iPhone 15 Pro' (ลูกค้าถามพลัส ได้ราคาโปร). ห้ามสลับกลับ — มีเทสต์คุมไว้
 */
const VARIANTS: { tokens: string[]; suffix: string }[] = [
  { tokens: ['โปรแม็กซ์', 'โปรแมกซ์', 'promax', 'pro max', 'pm'], suffix: ' Pro Max' },
  { tokens: ['พลัส', 'plus', '+'], suffix: ' Plus' },
  { tokens: ['โปร', 'pro', 'p'], suffix: ' Pro' },
  { tokens: ['มินิ', 'mini'], suffix: ' mini' },
];
/** เรียงยาว→สั้นตรงคู่ที่ซ้อนกัน: 'น้ำเงิน' ต้องมาก่อน 'เงิน' ไม่งั้น find() คืน 'เงิน' */
const COLORS = [
  'น้ำเงิน', 'ดำ', 'ขาว', 'ทอง', 'เงิน', 'ฟ้า', 'ม่วง', 'ชมพู', 'เขียว', 'แดง', 'เหลือง', 'ส้ม', 'เทา',
];

export function parseDeviceQuery(utterance: string): DeviceQuery {
  const raw = (utterance ?? '').trim();
  if (!raw) return { brand: null, model: null, storage: null, color: null, rest: '' };

  const storage = extractStorageToken(raw);
  let workingText = stripStorageToken(raw);
  const lower = workingText.toLowerCase();

  // ตัดคำว่า 'สี' นำหน้าออกด้วย ('สีดำ' → ตัดทั้งก้อน) ไม่งั้นเหลือเศษ 'สี'
  // ค้างใน workingText แล้วทำให้ '15pm สีดำ' ไม่เข้า BARE_MODEL_RE
  const color = COLORS.find((c) => workingText.includes(c)) ?? null;
  if (color) {
    workingText = workingText
      .replace(new RegExp(`(?:สี)?\\s*${color}`), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const isApple = APPLE_TOKENS.some((t) => lower.includes(t)) || BARE_MODEL_RE.test(workingText);
  if (!isApple) {
    return { brand: null, model: null, storage, color, rest: workingText };
  }

  // เลขรุ่นตัวแรกที่ไม่ใช่ความจุ (ตัดออกไปแล้ว) เช่น 'ไอโฟน 15' / 'ip15' / '15pm'
  const numMatch = workingText.match(/(\d{1,2})/);
  if (!numMatch) {
    return { brand: 'Apple', model: null, storage, color, rest: workingText };
  }
  const num = numMatch[1];

  // ข้อความหลังเลขรุ่น = ที่อยู่ของ variant ('15pm', 'ไอโฟน 15 โปรแม็กซ์')
  const after = workingText.slice(numMatch.index! + num.length).toLowerCase();
  const variant = VARIANTS.find((v) => v.tokens.some((t) => after.includes(t)));

  return {
    brand: 'Apple',
    model: `iPhone ${num}${variant ? variant.suffix : ''}`,
    storage,
    color,
    rest: workingText,
  };
}
