import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => {
  const state = { reduce: false, listeners: new Set<() => void>() };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return query.includes('no-preference') ? !state.reduce : state.reduce;
      },
      addListener: (fn: () => void) => state.listeners.add(fn),
      removeListener: (fn: () => void) => state.listeners.delete(fn),
      addEventListener: (_: string, fn: () => void) => state.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => state.listeners.delete(fn),
    }),
  });
  return state;
});

import { Reveal } from './Reveal';
import { StaggerChildren } from './StaggerChildren';

class Observer {
  static instances: Observer[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: IntersectionObserverCallback) {
    Observer.instances.push(this);
  }
  enter() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  motion.reduce = false;
  Observer.instances = [];
  vi.stubGlobal('IntersectionObserver', Observer);
});

describe('scroll reveal accessibility and lifecycle', () => {
  it('keeps content visible without an IntersectionObserver implementation', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Reveal data-testid="content">เนื้อหา</Reveal>);
    expect(screen.getByTestId('content').style.opacity).toBe('');
    expect(screen.getByTestId('content').className).not.toContain('reveal');
  });

  it('renders reduced-motion content immediately without observing it', () => {
    motion.reduce = true;
    render(<Reveal data-testid="content">เนื้อหา</Reveal>);
    expect(screen.getByTestId('content').style.opacity).toBe('');
    expect(Observer.instances).toHaveLength(0);
  });

  it('reveals keyboard-focused actions immediately and cleans up after StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <Reveal data-testid="content">
          <a href="/products">ดูสินค้า</a>
        </Reveal>
      </StrictMode>,
    );
    const node = screen.getByTestId('content');
    expect(node.style.opacity).toBe('0');
    fireEvent.focusIn(screen.getByRole('link'));
    expect(node.style.opacity).toBe('');
    expect(node.style.transform).toBe('');
    unmount();
    expect(Observer.instances.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(
      true,
    );
  });

  it('finishes an entered reveal and restores normal styles', async () => {
    render(<Reveal data-testid="content">เนื้อหา</Reveal>);
    act(() => Observer.instances.at(-1)!.enter());
    await waitFor(() => expect(screen.getByTestId('content').style.opacity).toBe(''), {
      timeout: 2000,
    });
    expect(screen.getByTestId('content').style.transform).toBe('');
    expect(Observer.instances.at(-1)!.disconnect).toHaveBeenCalled();
  });

  it('reverts hidden styles if reduced motion is enabled while mounted', async () => {
    render(<Reveal data-testid="content">เนื้อหา</Reveal>);
    expect(screen.getByTestId('content').style.opacity).toBe('0');
    // GSAP coalesces media-query notifications within a browser frame.
    await new Promise((resolve) => setTimeout(resolve, 20));
    act(() => {
      motion.reduce = true;
      motion.listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(screen.getByTestId('content').style.opacity).toBe(''));
  });

  it('includes cards arriving after the first render and reveals a focused group', () => {
    const { rerender } = render(
      <StaggerChildren>
        <a key="one" href="/products">
          เครื่องแรก
        </a>
      </StaggerChildren>,
    );
    rerender(
      <StaggerChildren stagger={100}>
        <a key="one" href="/products">
          เครื่องแรก
        </a>
        <a key="two" href="/products">
          เครื่องถัดไป
        </a>
      </StaggerChildren>,
    );
    const next = screen.getByText('เครื่องถัดไป');
    expect(next.parentElement!.style.opacity).toBe('0');
    fireEvent.focusIn(next);
    expect(next.parentElement!.style.opacity).toBe('');
    expect(screen.getByText('เครื่องแรก').parentElement!.style.opacity).toBe('');
  });
});
