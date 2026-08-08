/**
 * B3 §5 — สัญญาของ shape ผลลัพธ์ tool หลังยกเครื่อง (Task 3 / Task 4)
 *
 * ไฟล์นี้ถูก import โดย:
 *  - `src/utils/price-grounding.util.spec.ts` (พิสูจน์ว่าทุกตัวเลขที่บอท quote ได้ ผ่าน guard)
 *  - `src/modules/sales-bot/tools/search-products.tool.spec.ts` (ผลจริงต้อง match shape นี้)
 *  - `src/modules/sales-bot/tools/calculate-installment.tool.spec.ts`
 *
 * แก้ shape ที่นี่ = ต้องแก้ `GROUNDED_PRICE_KEYS` ในย่อหน้าเดียวกันเสมอ (บทเรียน #1337)
 */

export const SEARCH_PRODUCTS_RESULT_FIXTURE = {
  query: { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', color: null },
  totalMatches: 3,
  priceMissingCount: 1,
  groups: [
    {
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      condition: 'A',
      unitCount: 2,
      minPrice: 32900,
      maxPrice: 34900,
      reservedCount: 1, // review round 1 [I2] — นับ RESERVED ทั้งกลุ่ม (prd-2), ไม่ใช่ตัวเลขเงิน
      units: [
        {
          id: 'prd-1',
          priceThb: 32900,
          installmentPriceThb: 35900,
          color: 'ดำ',
          batteryHealth: 92,
          shopWarrantyDays: 30,
          accessories: ['สายชาร์จ', 'กล่อง'],
          cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
          branchName: 'ลาดพร้าว',
          photoAvailable: true,
          photoUrl: 'https://cdn.example.com/p1.jpg',
          webUrl: 'https://shop.example.com/products/prd-1',
          reserved: false,
        },
        {
          id: 'prd-2',
          priceThb: 34900,
          installmentPriceThb: null,
          color: 'ขาว',
          batteryHealth: 100,
          shopWarrantyDays: 30,
          accessories: null,
          cosmeticNotes: null,
          branchName: 'รังสิต',
          photoAvailable: false,
          photoUrl: null,
          webUrl: 'https://shop.example.com/products/prd-2',
          reserved: true,
          reservedNote: 'ติดจองชั่วคราว',
        },
      ],
    },
  ],
} as const;

export const CALCULATE_INSTALLMENT_RESULT_FIXTURE = {
  productId: 'prd-1',
  productName: 'iPhone 15 Pro Max 256GB',
  cashPriceThb: 32900,
  priceThb: 35900, // ฐานคิดผ่อน = installmentPrice (ไม่ใช่ราคาเงินสด)
  downPct: 20,
  downAmountThb: 7180,
  financedThb: 28720,
  tenureMonths: 12,
  ratePct: 30,
  monthlyThb: 3113,
  totalPaidThb: 44536,
  photoUrl: 'https://cdn.example.com/p1.jpg',
  webUrl: 'https://shop.example.com/products/prd-1',
} as const;

export const GET_INSTALLMENT_RATES_RESULT_FIXTURE = {
  templates: [
    {
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      hasWarranty: true,
      rate1: { downPayment: 4900, monthlyPrice: 2490, termMonths: 24 },
      rate2: { downPayment: 1900, monthlyPrice: 2690, termMonths: 12 },
    },
  ],
} as const;
