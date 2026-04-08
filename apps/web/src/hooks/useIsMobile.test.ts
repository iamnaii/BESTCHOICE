import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// The hook uses window.matchMedia which jsdom does not implement by default.
// Build a tiny mock that can fire change events on demand so we can verify
// the effect path.
interface ListenerSet {
  (): void;
}

function installMatchMediaMock(initialInnerWidth: number) {
  const listeners: ListenerSet[] = [];
  const mql = {
    matches: initialInnerWidth < 1024,
    media: '',
    onchange: null,
    addEventListener: (_evt: string, cb: ListenerSet) => {
      listeners.push(cb);
    },
    removeEventListener: (_evt: string, cb: ListenerSet) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialInnerWidth,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return {
    fireChange: (nextWidth: number) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: nextWidth,
      });
      listeners.forEach((l) => l());
    },
  };
}

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('returns true when innerWidth is below 1024', () => {
    installMatchMediaMock(800);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when innerWidth is >= 1024', () => {
    installMatchMediaMock(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('exactly 1024 is treated as non-mobile (boundary check)', () => {
    installMatchMediaMock(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates when a matchMedia change event fires', () => {
    const { fireChange } = installMatchMediaMock(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      fireChange(800);
    });
    expect(result.current).toBe(true);
  });
});
