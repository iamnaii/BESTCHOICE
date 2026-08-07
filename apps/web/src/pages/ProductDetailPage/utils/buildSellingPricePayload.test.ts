import { describe, it, expect } from 'vitest';
import {
  buildSellingPricePayload,
  isSellingPricePayloadEmpty,
} from './buildSellingPricePayload';

describe('buildSellingPricePayload', () => {
  it('เปิด modal แล้วกดบันทึกโดยไม่แก้อะไรเลย → payload ว่าง (ไม่ส่งค่าเดิมซ้ำ)', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900' };
    const current = { cashPrice: '15900', installmentPrice: '19900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({});
    expect(isSellingPricePayloadEmpty(payload)).toBe(true);
  });

  it('ทั้งสองช่องว่างเปล่าตั้งแต่แรก (ไม่เคยมีราคา) → payload ว่างเช่นกัน', () => {
    const initial = { cashPrice: '', installmentPrice: '' };
    const current = { cashPrice: '', installmentPrice: '' };
    const payload = buildSellingPricePayload(current, initial);
    expect(isSellingPricePayloadEmpty(payload)).toBe(true);
  });

  it('แก้เฉพาะราคาเงินสด → payload มีแค่ cashPrice, installmentPrice ไม่ถูกส่ง', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900' };
    const current = { cashPrice: '16900', installmentPrice: '19900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({ cashPrice: 16900 });
    expect(isSellingPricePayloadEmpty(payload)).toBe(false);
  });

  it('แก้เฉพาะราคาผ่อน → payload มีแค่ installmentPrice', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900' };
    const current = { cashPrice: '15900', installmentPrice: '21900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({ installmentPrice: 21900 });
  });

  it('เคลียร์ช่อง (ว่างจากค่าที่เคยมี) ยังคงถือเป็น "ไม่แตะ" — ไม่มี UI ล้างราคาในฟอร์มนี้', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900' };
    const current = { cashPrice: '', installmentPrice: '19900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({});
  });
});
