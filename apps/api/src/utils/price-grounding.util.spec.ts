import {
  GROUNDED_PRICE_KEYS,
  collectGroundedPrices,
  collectGroundedPricesFromText,
  guardGrounding,
} from './price-grounding.util';
import {
  SEARCH_PRODUCTS_RESULT_FIXTURE,
  CALCULATE_INSTALLMENT_RESULT_FIXTURE,
  GET_INSTALLMENT_RATES_RESULT_FIXTURE,
} from '../modules/sales-bot/__fixtures__/tool-results.fixture';

describe('collectGroundedPrices — parity กับพฤติกรรมเดิมใน SalesBotService', () => {
  it('เก็บเฉพาะ key ที่อยู่ใน GROUNDED_PRICE_KEYS และเป็นเลข > 0', () => {
    const set = new Set<number>();
    collectGroundedPrices({ priceThb: 1000, notAPrice: 2000, monthly: 0, maxPrice: '3000' }, set);
    expect([...set].sort((a, b) => a - b)).toEqual([1000, 3000]);
  });

  it('เดินลง array + object ซ้อนได้', () => {
    const set = new Set<number>();
    collectGroundedPrices({ a: [{ b: { priceThb: 14691 } }] }, set);
    expect(set.has(14691)).toBe(true);
  });

  it('null/undefined ไม่ throw', () => {
    const set = new Set<number>();
    expect(() => collectGroundedPrices(null, set)).not.toThrow();
    expect(() => collectGroundedPrices(undefined, set)).not.toThrow();
    expect(set.size).toBe(0);
  });
});

describe('shape ใหม่ของ tool ต้องผ่าน guard (definition-of-done B3)', () => {
  it('ทุกตัวเลขราคาใน search_products fixture ถูกเก็บเป็น grounded', () => {
    const set = new Set<number>();
    collectGroundedPrices(SEARCH_PRODUCTS_RESULT_FIXTURE, set);
    // ราคาต่อเครื่อง + ราคาผ่อนต่อเครื่อง + ช่วงราคาของกลุ่ม
    expect(set.has(32900)).toBe(true);
    expect(set.has(34900)).toBe(true);
    expect(set.has(35900)).toBe(true); // installmentPriceThb — key ใหม่
  });

  it('บอท quote ราคาจาก search_products ได้โดยไม่โดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices(SEARCH_PRODUCTS_RESULT_FIXTURE, set);
    expect(
      guardGrounding('iPhone 15 Pro Max 256GB สภาพ A ราคา 32,900 บาทค่ะ ผ่อนคิดจาก 35,900 บาท', set),
    ).toEqual({ ok: true });
  });

  it('ทุกตัวเลขใน calculate_installment fixture ถูกเก็บเป็น grounded (รวม financed/cash)', () => {
    const set = new Set<number>();
    collectGroundedPrices(CALCULATE_INSTALLMENT_RESULT_FIXTURE, set);
    for (const n of [32900, 35900, 7180, 28720, 3113, 44536]) {
      expect(set.has(n)).toBe(true);
    }
  });

  it('บอท quote ค่างวด/ดาวน์/ยอดรวมจาก calculate_installment ได้โดยไม่โดน block', () => {
    const set = new Set<number>();
    collectGroundedPrices(CALCULATE_INSTALLMENT_RESULT_FIXTURE, set);
    expect(
      guardGrounding(
        'ดาวน์ 7,180 บาท ผ่อนเดือนละ 3,113 บาท 12 งวด รวมทั้งสัญญา 44,536 บาทค่ะ',
        set,
      ),
    ).toEqual({ ok: true });
  });

  it('get_installment_rates (shape เดิม) ยังผ่านเหมือนเดิม — ไม่ regress #1337', () => {
    const set = new Set<number>();
    collectGroundedPrices(GET_INSTALLMENT_RATES_RESULT_FIXTURE, set);
    expect(guardGrounding('ดาวน์ 4,900 บาท ผ่อนเดือนละ 2,490 บาทค่ะ', set)).toEqual({ ok: true });
  });
});

describe('guardGrounding — กฎเดิมต้องไม่หย่อนลง', () => {
  it('ไม่มีเลขบาทในคำตอบ → ผ่าน', () => {
    expect(guardGrounding('สวัสดีค่ะ สนใจรุ่นไหนคะ', new Set())).toEqual({ ok: true });
  });

  it('มีเลขบาทแต่ไม่มี tool result เลย → block', () => {
    const v = guardGrounding('ราคา 7,000 บาทค่ะ', new Set());
    expect(v).toEqual({ ok: false, reason: 'price-mentioned-no-tool-result' });
  });

  it('เลขที่ไม่มีใน grounded → block พร้อมบอกเลขที่ผิด', () => {
    const v = guardGrounding('ราคา 7,000 บาทค่ะ', new Set([32900]));
    expect(v).toEqual({ ok: false, reason: 'unmatched-price=7000' });
  });

  it('คลาดจาก grounded ไม่เกิน 5% → ผ่าน', () => {
    expect(guardGrounding('ประมาณ 14,700 บาทค่ะ', new Set([14691]))).toEqual({ ok: true });
  });

  it('เลข < 1000 ถูกข้าม (ค่าปรับ/วัน/เปอร์เซ็นต์)', () => {
    expect(guardGrounding('ค่าปรับ 50 บาท/วันค่ะ', new Set([32900]))).toEqual({ ok: true });
  });

  // ── regression: regex เดิมมองไม่เห็นยอดที่มีสตางค์ → guard เป็น no-op ──
  // ยอดจริงตาม CPA rounding มีสตางค์เกือบทั้งหมด (1,416.66 + 99.17 = 1,515.83)
  // ถ้า 3 เคสนี้ผ่านเพราะ "ไม่ match" แปลว่า regex ยังเป็นตัวเก่า — ให้ดู Step 4
  it('ยอดที่มีสตางค์และตรงกับ grounded → ผ่าน', () => {
    expect(guardGrounding('ยอดของคุณคือ 1,515.83 บาทค่ะ', new Set([1515.83]))).toEqual({
      ok: true,
    });
  });

  it('ยอดที่มีสตางค์แต่โมเดลแต่งเอง → block (เคสที่ regex เดิมปล่อยผ่าน 100%)', () => {
    expect(guardGrounding('ยอดของคุณคือ 99,999.50 บาทค่ะ', new Set([1515.83]))).toEqual({
      ok: false,
      reason: 'unmatched-price=99999.5',
    });
  });

  it('ยอดกลม .00 ที่ไม่มีใน grounded ก็ต้องโดน block', () => {
    expect(guardGrounding('ยอด 99,999.00 บาท', new Set([13642.51]))).toEqual({
      ok: false,
      reason: 'unmatched-price=99999',
    });
  });
});

describe('collectGroundedPricesFromText — KB ที่แอดมินเขียนเองคือ ground truth', () => {
  it('ดูดเลขบาทออกจาก template ของ KB', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('ค่ามัดจำเครื่อง 3,000 บาท คืนเมื่อรับเครื่อง', set);
    expect(set.has(3000)).toBe(true);
  });

  it('ข้ามเลข < 1000 เหมือน guard', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('ค่าปรับ 50 บาท/วัน', set);
    expect(set.size).toBe(0);
  });

  it('ดูดยอดที่มีสตางค์ได้ (regex ต้องรองรับทศนิยม)', () => {
    const set = new Set<number>();
    collectGroundedPricesFromText('งวดละ 1,515.83 บาท', set);
    expect(set.has(1515.83)).toBe(true);
  });
});
