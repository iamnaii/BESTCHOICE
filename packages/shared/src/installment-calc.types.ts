import Decimal from 'decimal.js';

export interface BcConfig {
  minDownPct: Decimal;
  commissionPct: Decimal;
  vatPct: Decimal;
  /** Map of months → total-contract interest pct. e.g. { 12: 0.50 } */
  ratePctByMonths: Map<number, Decimal>;
  allowedMonths: number[];
}

export interface BcCalcInput {
  installmentPrice: Decimal;
  months: number;
  /** Override down payment as percentage. Mutually exclusive with customDownAmount. */
  downPct?: Decimal;
  /** Override down payment as amount. Mutually exclusive with downPct. */
  customDownAmount?: Decimal;
  config: BcConfig;
}

export interface BcCalcOutput {
  sellingPrice: Decimal;
  downPct: Decimal;
  downAmount: Decimal;
  financedAmount: Decimal;
  interestPct: Decimal;
  interestAmount: Decimal;
  commissionPct: Decimal;
  commissionAmount: Decimal;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalWithVat: Decimal;
  monthlyPayment: Decimal;
  financeToShop: Decimal;
  isValid: boolean;
  errors: string[];
}

export type GfinCondition = 'HAND_1' | 'HAND_2';
/** TABLET (iPad) ส่ง GFIN ได้ตั้งแต่ 2026-09-11 — ถือเป็นมือ 1 (HAND_1) เสมอ */
export type ProductCategoryForGfin = 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';

export interface GfinModelMappingRow {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: GfinCondition;
  maxPrice: Decimal;
  modelMatchPattern: string;
  isActive: boolean;
}

export interface GfinOverpriceRuleRow {
  id: string;
  label: string;
  seriesPattern: string;
  condition: GfinCondition;
  allowance: Decimal;
  /** ผ่อนได้สูงสุด (งวด) ของซีรีส์/สภาพนี้ตามตารางราคา GFIN — null = ไม่จำกัด */
  maxMonths: number | null;
  isActive: boolean;
}

export interface GfinRateFactorRow {
  months: number;
  /** % คอมมิชชั่นที่ร้านเลือกในหน้า GFIN — เรทต่างกันตามค่านี้ (มือถือ 15 · iPad 5) */
  shopCommissionPct: number;
  factor: Decimal;
  feePerInstallment: Decimal;
  isActive: boolean;
}

export interface ProductForGfin {
  brand: string;
  model: string;
  storage: string;
  category: ProductCategoryForGfin;
}

export interface GfinCalcInput {
  installmentPrice: Decimal;
  product: ProductForGfin;
  months: number;
  /** สัดส่วนดาวน์ที่แจ้ง GFIN (0.25 = 25%) — default 0.25 */
  downPct?: Decimal;
  /** % คอมมิชชั่นที่ร้านเลือก (15 = 15%) — default = ค่าของ rateFactor; ต้องตรงกับ rateFactor */
  shopCommissionPct?: Decimal;
  /** ค่าทำสัญญาที่ GFIN หักจากยอดโอนให้ร้าน — default 100 */
  contractFee?: Decimal;
  mapping: GfinModelMappingRow;
  overpriceRule: GfinOverpriceRuleRow | null;
  rateFactor: GfinRateFactorRow;
  /**
   * ที่มาเครื่อง — GFIN ให้ OVER เต็มเฉพาะเครื่องไทย เครื่องนอกได้ครึ่งเดียว (เจ้าของยืนยัน 2026-09-26)
   * null = ยังไม่ระบุไทย/นอก → คิดแบบเครื่องนอกไว้ก่อน: ราคาส่งครึ่ง OVER เป็นยอดที่ GFIN รับแน่นอน
   * (เครื่องไทยส่งต่ำกว่าเพดานได้ แต่เครื่องนอกส่ง OVER เต็มไม่ได้) — ค่างวดจึงต่ำกว่าแบบ OVER เต็มเล็กน้อย
   * ไม่ส่งมาเลย (undefined) = OVER เต็มตามพฤติกรรมเดิม สำหรับผู้เรียกที่ไม่รู้ที่มาเครื่อง
   */
  deviceOrigin?: GfinDeviceOrigin | null;
}

export type GfinDeviceOrigin = 'THAI' | 'IMPORTED';

export interface GfinCalcOutput {
  /** OVER ตามกฎในตาราง (ก่อนปรับตามที่มาเครื่อง) */
  allowanceFull: Decimal;
  /** สัดส่วน OVER ที่ใช้จริง — 1 = เต็ม · 0.5 = เครื่องนอก/ยังไม่ระบุ */
  allowanceFactor: Decimal;
  /** OVER ที่บวกเข้าราคาส่งจริง = allowanceFull × allowanceFactor */
  allowanceApplied: Decimal;
  gfinSubmitPrice: Decimal;
  /** ส่วนต่างราคาส่งสูงสุด − ราคาผ่อนที่ต้องการ → เอามาลดดาวน์ให้ลูกค้า (กติกาของร้าน) */
  downDiscount: Decimal;
  downPct: Decimal;
  /** ดาวน์ที่แจ้ง GFIN = ราคาส่ง × downPct */
  downAmountByFormula: Decimal;
  /** ดาวน์ที่ลูกค้าจ่ายจริง = ดาวน์ตามสูตร − ส่วนลดดาวน์ (ไม่ต่ำกว่า 0) */
  downAmountActual: Decimal;
  /** ยอดจัดสินเชื่อหลังหักเงินดาวน์ */
  financedAmount: Decimal;
  /** รวมเงินผ่อนต่องวด = ceil(ยอดจัด × เรท) + ค่าล็อกเครื่อง (ปัดขึ้นเป็นบาทตาม GFIN) */
  monthlyPayment: Decimal;
  totalPayback: Decimal;
  feePerInstallment: Decimal;
  shopCommissionPct: Decimal;
  /** ค่าคอมมิชชั่นสุทธิ = ยอดจัด × %คอม */
  shopCommissionAmount: Decimal;
  contractFee: Decimal;
  /** ยอดโอนให้ร้านค้าสุทธิ = ยอดจัด + คอม − ค่าทำสัญญา */
  netTransferToShop: Decimal;
  /** ร้านรับรวม = ดาวน์จริงจากลูกค้า + ยอดโอนจาก GFIN */
  shopTotalReceived: Decimal;
  /** ราคาผ่อนที่ต้องการสูงกว่าราคาส่งสูงสุด → ไม่มีส่วนลดดาวน์ และร้านได้น้อยกว่าราคาผ่อน */
  priceAboveSubmit: boolean;
  isValid: boolean;
  errors: string[];
}
