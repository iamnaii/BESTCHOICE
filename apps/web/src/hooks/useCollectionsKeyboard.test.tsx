import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollectionsKeyboard } from './useCollectionsKeyboard';

// react-hotkeys-hook reads `key` AND `code` (it ignores events without `code`).
function codeFor(key: string): string {
  if (key === '?') return 'Slash';
  if (key === 'Escape') return 'Escape';
  if (key === 'ArrowDown') return 'ArrowDown';
  if (key === 'ArrowUp') return 'ArrowUp';
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
  return key;
}

function press(key: string, opts: { shift?: boolean } = {}) {
  const code = codeFor(key);
  const down = new KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shift ?? false,
  });
  document.dispatchEvent(down);
  // react-hotkeys-hook clears the pressed-keys set on keyup — mirror a real key press.
  const up = new KeyboardEvent('keyup', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    shiftKey: opts.shift ?? false,
  });
  document.dispatchEvent(up);
}

describe('useCollectionsKeyboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('Shift+? toggles the help overlay', () => {
    const { result } = renderHook(() => useCollectionsKeyboard({}));
    expect(result.current.helpOpen).toBe(false);

    act(() => press('/', { shift: true }));
    expect(result.current.helpOpen).toBe(true);

    act(() => press('/', { shift: true }));
    expect(result.current.helpOpen).toBe(false);
  });

  it('Esc closes the help overlay', () => {
    const { result } = renderHook(() => useCollectionsKeyboard({}));
    act(() => press('/', { shift: true }));
    expect(result.current.helpOpen).toBe(true);

    act(() => press('Escape'));
    expect(result.current.helpOpen).toBe(false);
  });

  it('G then Q switches to the today tab (G-prefix combo)', () => {
    const onSwitchTab = vi.fn();
    const { result } = renderHook(() => useCollectionsKeyboard({ onSwitchTab }));

    act(() => press('g'));
    expect(result.current.waitingForGSecond).toBe(true);

    act(() => press('q'));
    expect(onSwitchTab).toHaveBeenCalledWith('today');
    expect(result.current.waitingForGSecond).toBe(false);
  });

  it('G prefix expires after 1.5s without a second key', () => {
    const onSwitchTab = vi.fn();
    const { result } = renderHook(() => useCollectionsKeyboard({ onSwitchTab }));

    act(() => press('g'));
    expect(result.current.waitingForGSecond).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current.waitingForGSecond).toBe(false);

    // Pressing P now should fire payment, NOT switch to promise tab.
    act(() => press('p'));
    expect(onSwitchTab).not.toHaveBeenCalled();
  });

  it('J / K move focus down / up', () => {
    const onMoveFocus = vi.fn();
    renderHook(() => useCollectionsKeyboard({ onMoveFocus }));

    act(() => press('j'));
    expect(onMoveFocus).toHaveBeenCalledWith(1);

    act(() => press('k'));
    expect(onMoveFocus).toHaveBeenCalledWith(-1);
  });

  it('P fires the payment action when not in G-prefix', () => {
    const onPaymentFocused = vi.fn();
    const onSwitchTab = vi.fn();
    renderHook(() => useCollectionsKeyboard({ onPaymentFocused, onSwitchTab }));

    act(() => press('p'));
    expect(onPaymentFocused).toHaveBeenCalledTimes(1);
    expect(onSwitchTab).not.toHaveBeenCalled();
  });
});
