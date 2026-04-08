import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300));
    expect(result.current).toBe('hello');
  });

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 300 } },
    );
    rerender({ value: 'b', delay: 300 });
    // Still the old value — delay has not elapsed yet.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');
  });

  it('updates after the full delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('b');
  });

  it('debounces rapid consecutive changes (only the last value wins)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'c' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'd' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Only 100 ms since the last change → still 'a'.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Now 300 ms after the last change → updates to 'd', skipping 'b' and 'c'.
    expect(result.current).toBe('d');
  });

  it('respects a custom delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 1000 } },
    );
    rerender({ value: 'b', delay: 1000 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('b');
  });

  it('defaults to a 300 ms delay when none is provided', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value),
      { initialProps: { value: 'a' } },
    );
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });
});
