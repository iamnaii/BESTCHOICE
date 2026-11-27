import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HomeHero } from '@/components/hero/HomeHero';
import PromoBar from '@/components/layout/PromoBar';
import { TrustStrip } from '@/components/shop/TrustStrip';
import {
  DOWN_FLOOR_ATTR,
  DOWN_FLOOR_QUERY_KEY,
  type DownFloor,
  downFloorText,
  seedDownFloorFromSnapshot,
  toDownFloor,
} from './useDownFloor';

// ยอดถูกเติมไว้ใน query ก่อนทุกครั้ง — ไม่มีเทสไหนในไฟล์นี้ควรยิงเครือข่าย
const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

function renderWithFloor(ui: React.ReactElement, floor: DownFloor | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(DOWN_FLOOR_QUERY_KEY, floor);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('toDownFloor', () => {
  it('มีเครื่องฟรีดาวน์ = 0 บาท ไม่ว่าเครื่องอื่นต้องดาวน์เท่าไร', () => {
    expect(toDownFloor({ freeDownCount: 13, nextDownFrom: 1200 })).toEqual({ amount: 0 });
  });
  it('ไม่มีฟรีดาวน์ = ดาวน์ต่ำสุดของเครื่องที่ขายอยู่', () => {
    expect(toDownFloor({ freeDownCount: 0, nextDownFrom: 1200 })).toEqual({ amount: 1200 });
  });
  it('ไม่รู้ยอด (API รุ่นเก่า / ไม่มีเครื่อง) = ไม่บอกตัวเลข', () => {
    expect(toDownFloor({})).toBeNull();
    expect(toDownFloor({ freeDownCount: 0, nextDownFrom: null })).toBeNull();
    expect(toDownFloor(null)).toBeNull();
  });
});

describe('seedDownFloorFromSnapshot — HTML ที่ prerender ไว้ → ค่าเริ่มของ query', () => {
  function snapshotWith(value: string | null) {
    const root = document.createElement('div');
    const bar = document.createElement('div');
    if (value !== null) bar.setAttribute(DOWN_FLOOR_ATTR, value);
    root.appendChild(bar);
    return root;
  }

  it('อ่านยอดจากแถบโปร และถือว่าเก่า — ดึงยอดสดทันทีหลัง mount', () => {
    const client = new QueryClient();
    seedDownFloorFromSnapshot(client, snapshotWith('1200'));
    expect(client.getQueryData(DOWN_FLOOR_QUERY_KEY)).toEqual({ amount: 1200 });
    expect(client.getQueryState(DOWN_FLOOR_QUERY_KEY)?.dataUpdatedAt).toBe(0);
  });

  it('ฟรีดาวน์ (0) ก็อ่านได้', () => {
    const client = new QueryClient();
    seedDownFloorFromSnapshot(client, snapshotWith('0'));
    expect(client.getQueryData(DOWN_FLOOR_QUERY_KEY)).toEqual({ amount: 0 });
  });

  it.each([null, '', 'abc', '-5'])('ไม่มี / ค่าเพี้ยน (%s) = ไม่ตั้งอะไร', (value) => {
    const client = new QueryClient();
    seedDownFloorFromSnapshot(client, snapshotWith(value));
    expect(client.getQueryData(DOWN_FLOOR_QUERY_KEY)).toBeUndefined();
  });

  it('แถบโปรเขียน attribute ที่ seed อ่านกลับได้ (ชื่อเดียวกัน)', () => {
    const { container } = renderWithFloor(<PromoBar />, { amount: 1200 });
    const client = new QueryClient();
    seedDownFloorFromSnapshot(client, container);
    expect(client.getQueryData(DOWN_FLOOR_QUERY_KEY)).toEqual({ amount: 1200 });
  });

  it('แถบโปรไม่เขียน attribute เมื่อไม่รู้ยอด', () => {
    const { container } = renderWithFloor(<PromoBar />, null);
    expect(container.querySelector(`[${DOWN_FLOOR_ATTR}]`)).toBeNull();
  });
});

describe('downFloorText', () => {
  it('ตัวเลขกับ "บาท" ติดกันด้วยช่องว่างไม่ตัดบรรทัด — การ์ดแคบไม่เหลือ "บาท" โดด ๆ', () => {
    expect(downFloorText({ amount: 1200 })).toBe('ดาวน์เริ่ม 1,200 บาท');
  });
});

describe('พาดหัวหน้าแรกตามสต๊อก (เจ้าของ 2026-11-27)', () => {
  // ช่องว่างไม่ตัดบรรทัด (U+00A0) ระหว่างตัวเลขกับ "บาท" — เทียบข้อความแบบช่องว่างปกติ
  const headline = () =>
    (screen.getByRole('heading', { level: 1 }).textContent ?? '').replace(/\s+/g, ' ');

  it('มีเครื่องฟรีดาวน์ = ดาวน์เริ่ม 0 บาท', () => {
    renderWithFloor(<HomeHero />, { amount: 0 });
    expect(headline()).toContain('ไม่เช็กบูโร ดาวน์เริ่ม 0 บาท');
  });

  it('ฟรีดาวน์หมด = ดาวน์ต่ำสุดจริง', () => {
    renderWithFloor(<HomeHero />, { amount: 1200 });
    expect(headline()).toContain('ไม่เช็กบูโร ดาวน์เริ่ม 1,200 บาท');
  });

  it('ยังไม่รู้ยอด = พาดหัวไม่มีตัวเลขดาวน์', () => {
    renderWithFloor(<HomeHero />, null);
    expect(headline()).toContain('ไม่เช็กบูโร ไม่ต้องมีผู้ค้ำ');
    expect(headline()).not.toContain('ดาวน์');
  });
});

describe('การ์ดจุดเด่น (TrustStrip) ตามสต๊อก', () => {
  it('รู้ยอด = ดาวน์เริ่ม X บาท', () => {
    renderWithFloor(<TrustStrip />, { amount: 1200 });
    expect(screen.getByText('ดาวน์เริ่ม 1,200 บาท')).toBeInTheDocument();
  });

  it('ยังไม่รู้ยอด = ไม่บอกตัวเลขดาวน์', () => {
    renderWithFloor(<TrustStrip />, null);
    expect(screen.queryByText(/ดาวน์เริ่ม/)).not.toBeInTheDocument();
    expect(screen.getByText('ผ่อนสูงสุด 15 งวด')).toBeInTheDocument();
  });

  it('ไม่ยิงเครือข่ายเมื่อมียอดในแคชแล้ว', () => {
    renderWithFloor(<TrustStrip />, { amount: 0 });
    expect(get).not.toHaveBeenCalled();
  });
});
