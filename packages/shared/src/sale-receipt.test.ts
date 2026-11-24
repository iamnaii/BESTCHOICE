import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_WARRANTY_TERMS, formatDefaultWarrantyTerms } from './sale-receipt';

describe('shop warranty terms', () => {
  it('renders six approved clauses with the selected duration and separate seven-day cover', () => {
    const terms = formatDefaultWarrantyTerms(DEFAULT_RECEIPT_WARRANTY_TERMS, 60);
    expect(terms.split('\n')).toHaveLength(6);
    expect(terms).toContain('1. ระยะเวลารับประกัน 60 วัน นับแต่วันที่ซื้อ');
    expect(terms).toContain('Face ID/Touch ID');
    expect(terms).toContain('รับประกัน 7 วัน เฉพาะความบกพร่องจากโรงงาน');
    expect(terms).toContain('เปลี่ยนเครื่องให้ภายใน 7 วันแรก');
    expect(terms).toContain('การรูท/เจลเบรก');
    expect(terms).toContain('6. ระยะเวลาซ่อม 3–7 วันทำการ');
    expect(formatDefaultWarrantyTerms(DEFAULT_RECEIPT_WARRANTY_TERMS, 30)).toContain(
      'รับประกัน 30 วัน',
    );
  });

  it('preserves custom terms and never inserts an invalid duration', () => {
    expect(formatDefaultWarrantyTerms('ประกันศูนย์ตามเอกสารแนบ', 60)).toBe(
      'ประกันศูนย์ตามเอกสารแนบ',
    );
    for (const days of [0, -1, NaN, 1.5]) {
      expect(formatDefaultWarrantyTerms(DEFAULT_RECEIPT_WARRANTY_TERMS, days)).toBe(
        DEFAULT_RECEIPT_WARRANTY_TERMS,
      );
    }
  });
});
