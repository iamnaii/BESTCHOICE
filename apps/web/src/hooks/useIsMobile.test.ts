import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// jsdom ไม่มี media query — mock ที่กำหนดผล `matches` เองและยิง change ได้
// innerWidth ตั้งแยกจาก matches โดยตั้งใจ: hook ต้องเชื่อ media query ไม่ใช่ innerWidth
function installMatchMediaMock({ matches, innerWidth = 1280 }: { matches: boolean; innerWidth?: number }) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches,
    media: '',
    onchange: null,
    addEventListener: (_evt: string, cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_evt: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: innerWidth });
  const matchMedia = vi.fn().mockReturnValue(mql);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return {
    matchMedia,
    listenerCount: () => listeners.length,
    fireChange: (next: boolean) => {
      mql.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let originalInnerWidth: number;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
  });

  it('ถามด้วย media query ส่วนกลับของ lg (min-width: 1024px) — 1024 ขึ้นไปเป็นจอใหญ่', () => {
    const { matchMedia } = installMatchMediaMock({ matches: false });
    renderHook(() => useIsMobile());
    expect(matchMedia).toHaveBeenCalledWith('not all and (min-width: 1024px)');
  });

  it('จอแคบ: ค่าใน render แรกเป็น true เลย ไม่วาดแบบจอใหญ่ก่อนหนึ่งเฟรม', () => {
    installMatchMediaMock({ matches: true, innerWidth: 390 });
    const seen: boolean[] = [];
    renderHook(() => {
      const value = useIsMobile();
      seen.push(value);
      return value;
    });
    expect(seen[0]).toBe(true);
  });

  it('เชื่อ media query ไม่ใช่ innerWidth — ของที่ล้นจอทำให้ innerWidth ของมือถือกว้างเกินจอจริง', () => {
    installMatchMediaMock({ matches: true, innerWidth: 1280 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('จอใหญ่คืน false', () => {
    installMatchMediaMock({ matches: false, innerWidth: 1280 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('เปลี่ยนตาม change ของ media query ทั้งสองทาง', () => {
    const { fireChange } = installMatchMediaMock({ matches: false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
    act(() => fireChange(false));
    expect(result.current).toBe(false);
  });

  it('ถอด listener ตอน unmount', () => {
    const { listenerCount } = installMatchMediaMock({ matches: false });
    const { unmount } = renderHook(() => useIsMobile());
    expect(listenerCount()).toBe(1);
    unmount();
    expect(listenerCount()).toBe(0);
  });
});
