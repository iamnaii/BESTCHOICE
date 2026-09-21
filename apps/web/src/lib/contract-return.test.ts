import { describe, expect, it } from 'vitest';
import { contractReturnUrl } from './contract-return';

describe('contractReturnUrl — ของแถมจาก POS', () => {
  it('พารายการของแถมไปหน้าสร้างสัญญา', () => {
    expect(contractReturnUrl('/contracts/create?customerId=c1&productId=p1&bundleProductIds=a1,a2'))
      .toBe('/contracts/create?customerId=c1&productId=p1&bundleProductIds=a1%2Ca2');
  });

  it('ทิ้ง id ผิดรูปทีละตัว และตัดที่ 10 ชิ้น (เพดานเดียวกับ API)', () => {
    const many = Array.from({ length: 12 }, (_, i) => `a${i}`).join(',');
    const url = contractReturnUrl(`/contracts/create?bundleProductIds=ok-1,<script>,${many}`)!;
    const ids = new URL(url, 'https://internal.invalid').searchParams.get('bundleProductIds')!.split(',');
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe('ok-1');
    expect(ids).not.toContain('<script>');
  });

  it('ไม่มีของแถม → ไม่มีพารามิเตอร์นี้ (ลิงก์เดิมไม่เปลี่ยน)', () => {
    expect(contractReturnUrl('/contracts/create?customerId=c1&productId=p1')).toBe('/contracts/create?customerId=c1&productId=p1');
  });
});
