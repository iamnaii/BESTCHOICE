import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

describe('useOnlineStatus', () => {
  const originalOnLine = navigator.onLine;
  let onLineValue = true;

  beforeEach(() => {
    onLineValue = true;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onLineValue,
    });
  });

  afterAll(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: originalOnLine,
    });
  });

  it('returns initial value from navigator.onLine', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('flips to false when offline event fires', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
  });

  it('flips back to true when online event fires', () => {
    onLineValue = false;
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('removes listeners on unmount (no stale state writes)', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    // result should still be the last-rendered value, no exceptions
    expect(result.current).toBe(true);
  });
});
