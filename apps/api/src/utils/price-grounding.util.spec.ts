import {
  GROUNDED_PRICE_KEYS,
  collectGroundedPrices,
  collectGroundedPricesFromText,
  collectGroundedPricesFromToolText,
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

  // review round 1 [I2]: groups[].reservedCount เป็นเลขนับเครื่อง ไม่ใช่ตัวเลขเงิน —
  // ต้องไม่ถูกเก็บเป็น grounded และต้องไม่ทำให้ guard บล็อกคำตอบที่พูดถึงมัน สองชั้นป้องกัน:
  // (1) 'reservedCount' ไม่อยู่ใน GROUNDED_PRICE_KEYS จึงไม่ถูก collect เลย
  // (2) แม้โมเดลจะพลาดพูดเลขนับเป็นสำนวนเงิน MIN_GROUNDED_THB=1000 ก็ยังกันเลขเล็ก ๆ ไว้อีกชั้น
  it('reservedCount (เลขนับเครื่อง) ไม่ถูกเก็บเป็น grounded และไม่โดน guard บล็อก', () => {
    const set = new Set<number>();
    collectGroundedPrices(SEARCH_PRODUCTS_RESULT_FIXTURE, set);
    expect(set.has(1)).toBe(false); // reservedCount: 1 ในฟิกซ์เจอร์ ต้องไม่ถูกเก็บ

    // ชั้นที่ 1: ข้อความนับจำนวนเครื่องไม่มีหน่วยเงินต่อท้าย — PRICE_IN_TEXT_RE ไม่จับตั้งแต่แรก
    expect(guardGrounding('ติดจอง 1 เครื่องค่ะ', set)).toEqual({ ok: true });

    // ชั้นที่ 2 (สมมุติโมเดลพูดผิดปกติ เอาเลขนับไปต่อท้ายด้วยหน่วยเงิน — ไม่ควรเกิดจริง):
    // เลขยังเล็กกว่า MIN_GROUNDED_THB=1000 → guard ข้ามให้ผ่านอยู่ดี ไม่ block
    expect(guardGrounding('ติดจอง 500 บาทค่ะ', set)).toEqual({ ok: true });
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

  // ── regression [C2 — review round 1 บน B3 Task 6] ──
  // เดิม `grounded.size === 0` เช็คก่อน per-match exemption (num < MIN_GROUNDED_THB)
  // ทำงาน → กรณี list_promotions เป็น tool เดียวที่ถูกเรียกและโปรเขียน "ลด 500 บาท"
  // (ไม่มีอะไรเข้า grounded set เลย) จะโดน block ทั้งที่ 500 < 1,000 ควรถูกยกเว้นเหมือน
  // เคส "เลข < 1000 ถูกข้าม" ด้านบน — สองเส้นทางต้องให้คำตอบตรงกันสำหรับ input เดียวกัน
  it('เลข < 1000 ถูกข้าม แม้ grounded set ว่างเปล่า (ไม่ผ่าน early-return ผิดจังหวะ)', () => {
    expect(guardGrounding('เดือนนี้ลดทันที 500 บาทค่ะ', new Set())).toEqual({ ok: true });
  });

  it('เลข >= 1000 ยังโดน block ตามเดิมเมื่อ grounded ว่างเปล่า (backstop เดิมไม่หลวม)', () => {
    expect(guardGrounding('เดือนนี้ลดทันที 99,999 บาทค่ะ', new Set())).toEqual({
      ok: false,
      reason: 'price-mentioned-no-tool-result',
    });
  });

  it('พอดี threshold 999 (< 1000) ถูกข้ามแม้ grounded ว่าง', () => {
    expect(guardGrounding('ลด 999 บาทค่ะ', new Set())).toEqual({ ok: true });
  });

  it('พอดี threshold 1,001 (>= 1000) โดน block เมื่อ grounded ว่าง', () => {
    expect(guardGrounding('ลด 1,001 บาทค่ะ', new Set())).toEqual({
      ok: false,
      reason: 'price-mentioned-no-tool-result',
    });
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

describe('collectGroundedPricesFromToolText — B3 Task 6: ข้อความแอดมินเขียนเองจาก tool result', () => {
  it('list_promotions: ดูดเลขบาทจาก description ของแต่ละโปร', () => {
    const set = new Set<number>();
    collectGroundedPricesFromToolText(
      'list_promotions',
      {
        promotions: [
          { id: 'p1', name: 'ลดพิเศษ', description: 'ลดทันที 1,000 บาท', endsAt: '2026-12-31' },
        ],
      },
      set,
    );
    expect(set.has(1000)).toBe(true);
  });

  it('list_promotions: ดูดเลขบาทจาก name ด้วยเช่นกัน', () => {
    const set = new Set<number>();
    collectGroundedPricesFromToolText(
      'list_promotions',
      { promotions: [{ id: 'p1', name: 'ลด 2,500 บาท', description: null }] },
      set,
    );
    expect(set.has(2500)).toBe(true);
  });

  it('search_knowledge_base: ดูดเลขบาทจาก matches[].responseTemplate', () => {
    const set = new Set<number>();
    collectGroundedPricesFromToolText(
      'search_knowledge_base',
      { matches: [{ id: 'kb1', responseTemplate: 'ค่ามัดจำเครื่อง 3,000 บาท คืนเมื่อรับเครื่อง' }] },
      set,
    );
    expect(set.has(3000)).toBe(true);
  });

  it('tool ที่ไม่อยู่ใน 3 ตัวที่รองรับ = no-op ไม่เพิ่มอะไรเข้า set', () => {
    const set = new Set<number>();
    collectGroundedPricesFromToolText(
      'search_products',
      { promotions: [{ description: 'ลด 1,000 บาท' }] },
      set,
    );
    expect(set.size).toBe(0);
  });

  it('result ที่ไม่ใช่ object (null/string/number) → ไม่ throw และไม่เพิ่มอะไร', () => {
    const set = new Set<number>();
    expect(() => collectGroundedPricesFromToolText('list_promotions', null, set)).not.toThrow();
    expect(() =>
      collectGroundedPricesFromToolText('list_promotions', 'not-an-object', set),
    ).not.toThrow();
    expect(() => collectGroundedPricesFromToolText('list_promotions', 42, set)).not.toThrow();
    expect(set.size).toBe(0);
  });

  it('list_promotions: promotions ไม่ใช่ array → ไม่ throw ไม่เพิ่มอะไร', () => {
    const set = new Set<number>();
    expect(() =>
      collectGroundedPricesFromToolText('list_promotions', { promotions: 'oops' }, set),
    ).not.toThrow();
    expect(set.size).toBe(0);
  });
});
