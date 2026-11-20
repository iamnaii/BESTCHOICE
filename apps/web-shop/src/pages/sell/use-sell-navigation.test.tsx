import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSellNavigation } from './use-sell-navigation';
function mount() {
  return renderHook(
    () => ({ flow: useSellNavigation({ kind: 'device' }), router: useNavigate() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={['/sell/quote?utm_source=test']}>{children}</MemoryRouter>
      ),
    },
  );
}
afterEach(() => vi.useRealTimers());
describe('sell navigation', () => {
  it('shows selection briefly and accepts only one advance while pending', () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => {
      result.current.flow.advance({ kind: 'storage' });
      result.current.flow.advance({ kind: 'result' });
    });
    expect(result.current.flow.step.kind).toBe('device');
    act(() => vi.advanceTimersByTime(219));
    expect(result.current.flow.step.kind).toBe('device');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.flow.step.kind).toBe('storage');
    act(() => result.current.flow.back({ kind: 'device' }));
    expect(result.current.flow.step.kind).toBe('device');
    act(() => vi.runAllTimers());
    expect(result.current.flow.step.kind).toBe('device');
  });
  it('cancels a queued step on reset and browser back', () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => result.current.flow.go({ kind: 'storage' }));
    act(() => result.current.flow.advance({ kind: 'question', key: 'body' }));
    act(() => result.current.router(-1));
    act(() => vi.runAllTimers());
    expect(result.current.flow.step.kind).toBe('device');
    act(() => result.current.flow.advance({ kind: 'storage' }));
    act(() => result.current.flow.reset({ kind: 'device' }));
    act(() => vi.runAllTimers());
    expect(result.current.flow.step.kind).toBe('device');
  });
  it('can reset a device generation then advance in the same click', () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => {
      result.current.flow.reset({ kind: 'device' });
      result.current.flow.advance({ kind: 'storage' });
    });
    act(() => vi.advanceTimersByTime(220));
    expect(result.current.flow.step.kind).toBe('storage');
  });
  it('unmount discards its timer', () => {
    vi.useFakeTimers();
    const { result, unmount } = mount();
    act(() => result.current.flow.advance({ kind: 'storage' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
