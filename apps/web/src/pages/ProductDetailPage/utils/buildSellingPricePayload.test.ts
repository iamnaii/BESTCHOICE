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

  // review round 1 [I1]: caller (index.tsx openSellingPriceModal) ต้อง snapshot `initial`
  // จากคอลัมน์ดิบ normalize แล้ว ไม่ใช่ค่า display — เครื่อง fallback (คอลัมน์ null, การ์ดโชว์
  // ราคาจาก prices[]) initial.cashPrice จึงเป็น '' แม้ฟอร์ม prefill ด้วยค่า display ที่ไม่ว่าง
  it('[I1] initial ว่าง (คอลัมน์ null) แต่ฟอร์ม prefill ด้วยค่า fallback ที่ไม่ตรงกัน → ต้องส่ง (promote เข้าคอลัมน์)', () => {
    const initial = { cashPrice: '', installmentPrice: '' };
    const current = { cashPrice: '15900', installmentPrice: '' };
    const payload = buildSellingPricePayload(current, initial);
    expect(payload).toEqual({ cashPrice: 15900 });
    expect(isSellingPricePayloadEmpty(payload)).toBe(false);
  });

  // review round 1 [I1]: เครื่องที่มีคอลัมน์จริงอยู่แล้ว (initial = คอลัมน์ดิบ, ไม่ใช่ fallback)
  // กดบันทึกโดยไม่แก้ → ฟอร์มเท่ากับ initial พอดี → payload ว่าง → badge autofill รอด
  it('[I1] initial = คอลัมน์จริง, ฟอร์มเท่าเดิม → payload ว่าง (ไม่ promote ซ้ำ ไม่เคลียร์ badge)', () => {
    const initial = { cashPrice: '15900', installmentPrice: '19900' };
    const current = { cashPrice: '15900', installmentPrice: '19900' };
    const payload = buildSellingPricePayload(current, initial);
    expect(isSellingPricePayloadEmpty(payload)).toBe(true);
  });
});
