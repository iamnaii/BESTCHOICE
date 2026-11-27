import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
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

  // ส่วน B5 (เจ้าของ 2026-11-27): เนื้อหาต้องเห็นทันทีที่หน้าเรนเดอร์ — ไม่จางเข้า ไม่รอเลื่อนถึง
  it('shows content immediately with motion allowed — no fade, no observer', () => {
    render(
      <StrictMode>
        <Reveal data-testid="content">
          <a href="/products">ดูสินค้า</a>
        </Reveal>
      </StrictMode>,
    );
    const node = screen.getByTestId('content');
    expect(node.style.opacity).toBe('');
    expect(node.style.transform).toBe('');
    expect(Observer.instances).toHaveLength(0);
  });

  it('shows every StaggerChildren card immediately, including cards that arrive later', () => {
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
    expect(screen.getByText('เครื่องถัดไป').parentElement!.style.opacity).toBe('');
    expect(screen.getByText('เครื่องแรก').parentElement!.style.opacity).toBe('');
    expect(Observer.instances).toHaveLength(0);
  });
});
