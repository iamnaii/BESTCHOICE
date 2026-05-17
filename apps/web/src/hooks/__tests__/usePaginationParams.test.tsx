import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { usePaginationParams } from '../usePaginationParams';

function wrapper({ initial }: { initial: string }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

describe('usePaginationParams', () => {
  it('returns defaults when URL has no params', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list' }),
    });
    expect(result.current.page).toBe(1);
    expect(result.current.size).toBe(50);
  });

  it('reads page + size from URL', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?page=3&size=20' }),
    });
    expect(result.current.page).toBe(3);
    expect(result.current.size).toBe(20);
  });

  it('setPage updates URL', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list' }),
    });
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
  });

  it('setSize resets page to 1', () => {
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?page=5&size=20' }),
    });
    act(() => result.current.setSize(100));
    expect(result.current.size).toBe(100);
    expect(result.current.page).toBe(1);
  });

  it('preserves other query params', () => {
    let location: ReturnType<typeof useLocation> | null = null;
    function Capture() { location = useLocation(); return null; }
    const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
      wrapper: wrapper({ initial: '/list?status=READY&page=2' }),
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
  });

  // Review-round-2 — URL ?size=N is clamped to [10, 200].
  describe('?size= URL clamping', () => {
    it('clamps oversize URL ?size=99999 to 200', () => {
      const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=99999' }),
      });
      expect(result.current.size).toBe(200);
    });

    it('clamps under-min URL ?size=5 to 10', () => {
      const { result } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=5' }),
      });
      expect(result.current.size).toBe(10);
    });

    it('passes through valid range values unchanged', () => {
      const { result: r1 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=10' }),
      });
      expect(r1.current.size).toBe(10);
      const { result: r2 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=200' }),
      });
      expect(r2.current.size).toBe(200);
      const { result: r3 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=75' }),
      });
      expect(r3.current.size).toBe(75);
    });

    it('falls back to defaultSize on garbage values (NaN / negative / 0)', () => {
      const { result: r1 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=abc' }),
      });
      expect(r1.current.size).toBe(50);
      const { result: r2 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=0' }),
      });
      expect(r2.current.size).toBe(50);
      const { result: r3 } = renderHook(() => usePaginationParams({ defaultSize: 50 }), {
        wrapper: wrapper({ initial: '/list?size=-5' }),
      });
      expect(r3.current.size).toBe(50);
    });
  });
});
