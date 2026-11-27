import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhoneShowcase } from './PhoneShowcase';
import { HERO_PHONE } from './hero-phone-images';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'phone-showcase.css'),
  'utf8',
);

function photos(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLImageElement>('img.phone-showcase__photo'));
}

describe('PhoneShowcase (ภาพส่วนหัวหน้าแรก)', () => {
  it('รูปเครื่องทั้งสองมีขนาดตายตัว — หน้าไม่กระตุกตอนรูปโหลด', () => {
    const { container } = render(<PhoneShowcase />);
    const [backImg, frontImg] = photos(container);
    expect(photos(container)).toHaveLength(2);
    expect(backImg).toHaveAttribute('width', String(HERO_PHONE.back.width));
    expect(backImg).toHaveAttribute('height', String(HERO_PHONE.back.height));
    expect(frontImg).toHaveAttribute('width', String(HERO_PHONE.front.width));
    expect(frontImg).toHaveAttribute('height', String(HERO_PHONE.front.height));
    for (const img of [backImg, frontImg]) {
      expect(img.getAttribute('srcset')).toMatch(/\d+w, .+ \d+w$/);
      expect(img.getAttribute('sizes')).toBeTruthy();
      expect(img).toHaveAttribute('alt', '');
    }
  });

  it('รูปหลัก (เครื่องด้านหน้า) รูปเดียวที่โหลดก่อน และไม่มีรูปไหน lazy', () => {
    const { container } = render(<PhoneShowcase />);
    const [backImg, frontImg] = photos(container);
    expect(frontImg).toHaveAttribute('fetchpriority', 'high');
    expect(backImg).not.toHaveAttribute('fetchpriority');
    expect(container.querySelector('img[loading="lazy"]')).toBeNull();
  });

  it('คงคำบรรยายใต้ภาพและการ์ด "ตรวจเช็กก่อนส่งมอบ" ตามที่เจ้าของอนุมัติ', () => {
    render(<PhoneShowcase />);
    expect(screen.getByText('ภาพประกอบ · เลือกดูเครื่องจริงในหน้าสินค้า')).toBeInTheDocument();
    expect(screen.getByText('ตรวจเช็กก่อนส่งมอบ')).toBeInTheDocument();
    expect(screen.getByText('เลือกเครื่องได้อย่างสบายใจ')).toBeInTheDocument();
  });

  it('หน้าจอเป็นหน้าจอแบรนด์ ไม่มีแถบโฮมของ iOS', () => {
    const { container } = render(<PhoneShowcase />);
    expect(container.querySelector('.phone-showcase__screen')).toHaveTextContent('BESTCHOICE.');
    expect(container.querySelector('[class*="homebar"], [class*="home-bar"]')).toBeNull();
  });

  it('มีชั้นให้ GSAP ครบ: เลื่อนหน้าสองเครื่อง + เอียงตามเมาส์สามชิ้น', () => {
    const { container } = render(<PhoneShowcase />);
    expect(container.querySelector('[data-phone-back]')).not.toBeNull();
    expect(container.querySelector('[data-phone-front]')).not.toBeNull();
    for (const key of ['front', 'back', 'badge']) {
      expect(container.querySelector(`[data-phone-tilt="${key}"]`)).not.toBeNull();
    }
  });
});

describe('phone-showcase.css (กติกาการเคลื่อนไหว)', () => {
  const keyframes = Array.from(
    css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g),
  );

  it('ทุก keyframes ขยับด้วย transform อย่างเดียว — ไม่เริ่มจากโปร่งใส ไม่แตะเลย์เอาต์', () => {
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    for (const [, name, body] of keyframes) {
      const props = Array.from(body.matchAll(/([\w-]+)\s*:/g)).map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const prop of props) expect(prop, name).toBe('transform');
    }
  });

  it('ประกาศ animation เฉพาะเมื่อผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว', () => {
    const motionBlockAt = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(motionBlockAt).toBeGreaterThan(-1);
    // ก่อนบล็อกนี้ต้องไม่มีการสั่ง animation เลย (ค่าตั้งต้น = ภาพนิ่ง)
    expect(css.slice(0, motionBlockAt)).not.toMatch(/\banimation(-name)?\s*:/);
  });

  it('หยุดทุกวงเมื่อส่วนหัวเลื่อนพ้นจอ', () => {
    expect(css).toMatch(/\[data-offscreen\][^{]*\{[^}]*animation-play-state:\s*paused/s);
  });
});
