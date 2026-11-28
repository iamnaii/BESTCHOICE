import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogBanner } from './CatalogBanner';
import { CATALOG_PHONE } from './catalog-banner-images';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'catalog-banner.css'),
  'utf8',
);

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <CatalogBanner />
    </QueryClientProvider>,
  );
}

function photos(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLImageElement>('img.catalog-banner__photo'));
}

afterEach(() => get.mockReset());

describe('CatalogBanner (แบนเนอร์หัวหน้ารายการสินค้า)', () => {
  it('หัวข้อและป้าย 3 ป้ายเป็นตัวหนังสือจริงตามคำที่เจ้าของเลือก', async () => {
    get.mockResolvedValue({ data: { freeDownCount: 3, nextDownFrom: 1200 } });
    renderBanner();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('iPhone มือ 1 กับมือ 2');
    expect(title).toHaveTextContent('ผ่อนสูงสุด 15 งวด');
    expect(await screen.findByText('ดาวน์เริ่ม 0 บาท')).toBeInTheDocument();
    const chips = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual([
      'ใช้บัตรประชาชนใบเดียว',
      'มือ 2 รับประกันร้าน 60 วัน',
      'ไม่เช็กเครดิตบูโร',
    ]);
  });

  it('ยอดดาวน์ในหัวข้อเปลี่ยนตามสต๊อก — ฟรีดาวน์หมดแสดงดาวน์ต่ำสุดจริง', async () => {
    get.mockResolvedValue({ data: { freeDownCount: 0, nextDownFrom: 1200 } });
    renderBanner();
    expect(await screen.findByText('ดาวน์เริ่ม 1,200 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ดาวน์เริ่ม 0 บาท')).not.toBeInTheDocument();
  });

  it('ยังไม่รู้ยอดดาวน์ — ไม่บอกตัวเลข และหัวข้อยังครบสองบรรทัด', async () => {
    get.mockRejectedValue(new Error('network'));
    renderBanner();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/ดาวน์เริ่ม/)).not.toBeInTheDocument();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('ไม่ต้องมีผู้ค้ำ');
    expect(title).toHaveTextContent('ผ่อนสูงสุด 15 งวด');
  });

  it('กลุ่มคำในหัวข้อไม่ถูกตัดกลาง — ยอดดาวน์และจำนวนงวดอยู่คนละกลุ่ม', async () => {
    get.mockResolvedValue({ data: { freeDownCount: 1, nextDownFrom: null } });
    const { container } = renderBanner();
    await screen.findByText('ดาวน์เริ่ม 0 บาท');
    const groups = Array.from(container.querySelectorAll('.catalog-banner__nobr')).map(
      // ตัวเลขกับ "บาท" ติดกันด้วยช่องว่างไม่ตัดบรรทัด (downFloorText) — เทียบโดยมองเป็นช่องว่างธรรมดา
      (el) => el.textContent?.replace(/\u00a0/g, ' '),
    );
    expect(groups).toEqual(['iPhone มือ 1', 'กับมือ 2', 'ดาวน์เริ่ม 0 บาท', 'ผ่อนสูงสุด 15 งวด']);
  });

  it('รูปเครื่องทั้งสองมีขนาดตายตัวและคำอธิบายภาษาไทย — หน้าไม่กระตุกตอนรูปโหลด', () => {
    get.mockResolvedValue({ data: {} });
    const { container } = renderBanner();
    const [backImg, frontImg] = photos(container);
    expect(photos(container)).toHaveLength(2);
    expect(backImg).toHaveAttribute('width', String(CATALOG_PHONE.back.width));
    expect(backImg).toHaveAttribute('height', String(CATALOG_PHONE.back.height));
    expect(backImg).toHaveAttribute('alt', 'iPhone 17 สีเขียวเซจ ด้านหลัง เห็นกล้องคู่');
    expect(frontImg).toHaveAttribute('width', String(CATALOG_PHONE.front.width));
    expect(frontImg).toHaveAttribute('height', String(CATALOG_PHONE.front.height));
    expect(frontImg).toHaveAttribute('alt', 'iPhone 16 สีชมพู ด้านหน้า');
    for (const img of [backImg, frontImg]) {
      expect(img.getAttribute('srcset')).toMatch(/\d+w, .+ \d+w$/);
      expect(img.getAttribute('sizes')).toBeTruthy();
      // เก็บรูปในโปรเจกต์เอง ไม่ลิงก์ตรงไปเว็บผู้ผลิต
      expect(img.getAttribute('src')).not.toMatch(/^https?:/);
      expect(img.getAttribute('srcset')).not.toMatch(/https?:/);
    }
  });

  it('รูปเครื่องด้านหน้ารูปเดียวที่โหลดก่อน และไม่มีรูปไหน lazy', () => {
    get.mockResolvedValue({ data: {} });
    const { container } = renderBanner();
    const [backImg, frontImg] = photos(container);
    expect(frontImg).toHaveAttribute('fetchpriority', 'high');
    expect(backImg).not.toHaveAttribute('fetchpriority');
    expect(container.querySelector('img[loading="lazy"]')).toBeNull();
  });

  it('มีชั้นให้เลื่อนตามเมาส์ครบสองเครื่อง และแถบแสงอยู่บนเครื่องหน้าเครื่องเดียว', () => {
    get.mockResolvedValue({ data: {} });
    const { container } = renderBanner();
    for (const key of ['front', 'back']) {
      expect(container.querySelector(`[data-banner-follow="${key}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll('.catalog-banner__shine')).toHaveLength(1);
    expect(
      container.querySelector('.catalog-banner__slot--front .catalog-banner__shine'),
    ).not.toBeNull();
  });
});

describe('catalog-banner.css (กติกาการเคลื่อนไหว)', () => {
  const keyframes = Array.from(
    css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g),
  );

  it('ทุก keyframes ขยับด้วย transform กับ opacity เท่านั้น — ไม่แตะเลย์เอาต์', () => {
    expect(keyframes.length).toBe(5);
    for (const [, name, body] of keyframes) {
      const props = Array.from(body.matchAll(/([\w-]+)\s*:/g)).map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const prop of props) expect(['transform', 'opacity'], name).toContain(prop);
    }
  });

  it('ประกาศ animation เฉพาะเมื่อผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว (ค่าตั้งต้น = ภาพนิ่ง)', () => {
    const motionBlockAt = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(motionBlockAt).toBeGreaterThan(-1);
    expect(css.slice(0, motionBlockAt)).not.toMatch(/\banimation(-name)?\s*:/);
    // ไม่มี transition ที่ไหนเลย — การเลื่อนตามเมาส์เป็นงานของ GSAP ซึ่งเปิดเฉพาะเมื่อไม่ได้ขอลดการเคลื่อนไหว
    expect(css).not.toMatch(/\btransition\s*:/);
  });

  it('การเข้าจอจบภายใน 700 มิลลิวินาที', () => {
    const entrance = Array.from(
      css.matchAll(
        /animation:\s*catalog-banner-(?:rise|in-back|in-front)\s+(\d+)ms[^;]*?(?:\s(\d+)ms)?\s+both/g,
      ),
    ).map((m) => Number(m[1]) + Number(m[2] ?? 0));
    expect(entrance.length).toBeGreaterThanOrEqual(4);
    const chipDelays = Array.from(css.matchAll(/animation-delay:\s*(\d+)ms/g)).map((m) =>
      Number(m[1]),
    );
    // ป้ายใช้ 360 มิลลิวินาที เริ่มช้าสุดที่ animation-delay ตัวมากสุด
    expect(Math.max(...entrance, 360 + Math.max(...chipDelays))).toBeLessThanOrEqual(700);
  });

  it('หยุดทุกวงเมื่อแบนเนอร์เลื่อนพ้นจอ', () => {
    expect(css).toMatch(/\[data-offscreen\][^{]*\{[^}]*animation-play-state:\s*paused/s);
  });

  it('พื้นที่ภาพจองขนาดตายตัวทุกช่วงจอ — ไม่ขึ้นกับการโหลดรูป', () => {
    expect(css).toMatch(/\.catalog-banner__stage\s*\{[^}]*width:\s*92px;[^}]*height:\s*110px/s);
    expect(css).toMatch(/aspect-ratio:\s*var\(--cb-front-ratio\)/);
    expect(css).toMatch(/aspect-ratio:\s*var\(--cb-back-ratio\)/);
  });
});
