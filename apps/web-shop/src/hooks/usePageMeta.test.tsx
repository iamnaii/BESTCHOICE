import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePageMeta } from './usePageMeta';

const robots = () => document.querySelector<HTMLMetaElement>('meta[name="robots"]');

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((el) => {
    el.remove();
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
