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
});
