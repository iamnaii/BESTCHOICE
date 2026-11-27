import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePageMeta } from './usePageMeta';

const robots = () => document.querySelector<HTMLMetaElement>('meta[name="robots"]');

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((el) => {
    el.remove();
  });
});

describe('usePageMeta — รูปตอนแชร์ (og:image)', () => {
  const DEFAULT_IMAGE = 'https://www.bestchoicephone.com/media/og-default.jpg';
  const og = (property: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);

  // แท็กชุดเดียวกับใน index.html — jsdom ไม่มีให้เอง
  function seedDefaultOgImage() {
    for (const [property, content] of [
      ['og:image', DEFAULT_IMAGE],
      ['og:image:width', '1200'],
      ['og:image:height', '630'],
    ]) {
      const el = document.createElement('meta');
      el.setAttribute('property', property);
      el.setAttribute('content', content);
      document.head.appendChild(el);
    }
  }

  afterEach(() => {
    document.head.querySelectorAll('meta[property^="og:image"]').forEach((el) => el.remove());
  });

  it('ส่งรูปมา → og:image เป็นรูปนั้น และถอดขนาดรูป default (1200×630) ที่ไม่ตรงกับรูปสินค้า', () => {
    seedDefaultOgImage();
    renderHook(() => usePageMeta('สินค้า', undefined, { image: 'https://x.test/a.jpg' }));
    expect(og('og:image')?.content).toBe('https://x.test/a.jpg');
    expect(og('og:image:width')).toBeNull();
    expect(og('og:image:height')).toBeNull();
  });

  it('ออกจากหน้า → คืนรูปและขนาด default', () => {
    seedDefaultOgImage();
    const { unmount } = renderHook(() =>
      usePageMeta('สินค้า', undefined, { image: 'https://x.test/a.jpg' }),
    );
    unmount();
    expect(og('og:image')?.content).toBe(DEFAULT_IMAGE);
    expect(og('og:image:width')?.content).toBe('1200');
    expect(og('og:image:height')?.content).toBe('630');
  });

  it('เปลี่ยนรูประหว่างอยู่หน้าเดิม (เลือกเครื่องอื่น) → og:image เป็นรูปใหม่ ขนาด default ยังไม่กลับมา', () => {
    seedDefaultOgImage();
    const { rerender } = renderHook(
      ({ image }: { image: string }) => usePageMeta('สินค้า', undefined, { image }),
      { initialProps: { image: 'https://x.test/a.jpg' } },
    );
    rerender({ image: 'https://x.test/b.jpg' });
    expect(og('og:image')?.content).toBe('https://x.test/b.jpg');
    expect(og('og:image:width')).toBeNull();
    expect(og('og:image:height')).toBeNull();
    expect(document.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
  });

  it('ไม่ส่งรูป → ไม่แตะ og:image', () => {
    seedDefaultOgImage();
    renderHook(() => usePageMeta('หน้าอื่น'));
    expect(og('og:image')?.content).toBe(DEFAULT_IMAGE);
    expect(og('og:image:width')?.content).toBe('1200');
  });
});

describe('usePageMeta — noindex', () => {
  it('ค่าเริ่มต้นไม่ใส่ meta robots', () => {
    renderHook(() => usePageMeta('หน้าปกติ'));
    expect(robots()).toBeNull();
  });

  it('noindex: true → ใส่ <meta name="robots" content="noindex"> และตั้ง title ตามที่ส่งมา', () => {
    renderHook(() => usePageMeta('ไม่พบหน้านี้', undefined, { noindex: true }));
    expect(robots()?.content).toBe('noindex');
    expect(document.title).toBe('ไม่พบหน้านี้ | BESTCHOICE ลพบุรี');
  });

  it('ออกจากหน้า (unmount) → ถอด noindex ออก หน้าถัดไปที่ไม่เรียก hook ต้องไม่ติด noindex', () => {
    const { unmount } = renderHook(() => usePageMeta('ไม่พบหน้านี้', undefined, { noindex: true }));
    unmount();
    expect(robots()).toBeNull();
  });

  it('มี meta robots อยู่ก่อนแล้ว → ออกจากหน้า noindex แล้วคืนค่าเดิม ไม่ลบแท็กที่ไม่ได้สร้างเอง', () => {
    const existing = document.createElement('meta');
    existing.setAttribute('name', 'robots');
    existing.setAttribute('content', 'index, follow');
    document.head.appendChild(existing);

    const { unmount } = renderHook(() => usePageMeta('ไม่พบหน้านี้', undefined, { noindex: true }));
    expect(robots()?.content).toBe('noindex');
    unmount();
    expect(robots()).toBe(existing);
    expect(robots()?.content).toBe('index, follow');
  });

  it('หน้าเดิมเปลี่ยนจากไม่พบ → พบข้อมูล (noindex true → false) → ถอด noindex ออก', () => {
    const { rerender } = renderHook(
      ({ noindex }: { noindex: boolean }) => usePageMeta('หน้า', undefined, { noindex }),
      { initialProps: { noindex: true } },
    );
    expect(robots()?.content).toBe('noindex');
    rerender({ noindex: false });
    expect(robots()).toBeNull();
  });
});
