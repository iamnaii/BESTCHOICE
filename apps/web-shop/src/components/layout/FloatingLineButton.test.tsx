import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FloatingLineButton from './FloatingLineButton';

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
  });
}

const button = () => screen.getByRole('link', { name: 'ทักแชทหาร้าน' });

describe('FloatingLineButton — ซ่อนตอนเลื่อนลงบนมือถือ (เจ้าของ 2026-11-27)', () => {
  afterEach(() => scrollTo(0));

  it('โผล่ตอนเปิดหน้า', () => {
    render(<FloatingLineButton />);
    expect(button()).not.toHaveAttribute('data-scroll-hidden');
  });

  it('ซ่อนเมื่อเลื่อนลง แล้วโผล่เมื่อเลื่อนขึ้น', () => {
    render(<FloatingLineButton />);
    scrollTo(400);
    expect(button()).toHaveAttribute('data-scroll-hidden', 'true');
    expect(button().className).toContain('max-md:opacity-0');
    scrollTo(300);
    expect(button()).not.toHaveAttribute('data-scroll-hidden');
  });

  it('เลื่อนสั่นเล็กน้อยไม่เปลี่ยนสถานะ', () => {
    render(<FloatingLineButton />);
    scrollTo(400);
    scrollTo(396);
    expect(button()).toHaveAttribute('data-scroll-hidden', 'true');
  });

  it('บวก --cookie-banner-offset เข้ากับตำแหน่งล่าง', () => {
    render(<FloatingLineButton />);
    expect(button().className).toContain('bottom-[calc(5rem+var(--cookie-banner-offset,0px))]');
    expect(button().className).toContain(
      'md:bottom-[calc(1.5rem+var(--cookie-banner-offset,0px))]',
    );
  });

  it('ช่วงบนสุดของหน้าโผล่เสมอ', () => {
    render(<FloatingLineButton />);
    scrollTo(400);
    scrollTo(500);
    scrollTo(80);
    expect(button()).not.toHaveAttribute('data-scroll-hidden');
  });
});
