import { describe, expect, it } from 'vitest';
import { existingNounOf } from './existing-person-noun';

describe('existingNounOf — คำเรียกคนเดิมเมื่อ 409 ข้อมูลซ้ำ', () => {
  it('purchased: false → ผู้สนใจ · true → ลูกค้า · ไม่บอก (API เก่า) → ลูกค้า', () => {
    expect(existingNounOf(false)).toBe('ผู้สนใจ');
    expect(existingNounOf(true)).toBe('ลูกค้า');
    expect(existingNounOf(undefined)).toBe('ลูกค้า');
  });
});
