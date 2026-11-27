import { describe, expect, it } from 'vitest';
import { formatThaiList } from './vendors';

describe('formatThaiList', () => {
  it('สองชื่อ = "A และ B"', () => {
    expect(formatThaiList(['Facebook', 'Instagram'])).toBe('Facebook และ Instagram');
  });
  it('สี่ชื่อ = "A, B, C และ D"', () => {
    expect(formatThaiList(['Facebook', 'Instagram', 'TikTok', 'LINE'])).toBe(
      'Facebook, Instagram, TikTok และ LINE',
    );
  });
  it('ชื่อเดียว', () => {
    expect(formatThaiList(['Facebook'])).toBe('Facebook');
  });
});
