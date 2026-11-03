import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from './index';

/**
 * Task 34 ข้อ 1 (Task 30 รีวิว M4) — การ์ด "Compliance blocks" ต้องมีช่องของทุกคีย์ที่ `GET /notifications/compliance/stats` ส่ง ·
 * API ส่ง `LEGACY_LINK_GRACE` (ข้อความทวงที่ระบบส่งเองถูกระงับช่วงผ่อนผัน 7 วันหลังผูก LINE ของสัญญานำเข้า) ⇒ วันที่มีแต่แถวผ่อนผัน
 * การ์ดเคยขึ้นพร้อม 0/0/0/0 โดยไม่บอกว่าถูกระงับเพราะอะไร
 */

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => String(e) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-owner', role: 'OWNER' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ZERO_STATS = {
  OUTSIDE_HOURS: 0,
  FREQUENCY_CAP: 0,
  NO_CONSENT: 0,
  HOLIDAY_BLOCK: 0,
  LEGACY_LINK_GRACE: 0,
};

function renderWithStats(stats: Record<string, number>) {
  apiMock.get.mockImplementation(async (path: string) => ({
    data: path === '/notifications/compliance/stats' ? stats : undefined,
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** ช่องของการ์ด = div ที่ห่อทั้งคำกับตัวเลข */
function cellOf(label: RegExp): HTMLElement {
  const el = screen.getByText(label);
  return el.closest('div') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsPage — การ์ด Compliance blocks', () => {
  it('มีแต่แถวผ่อนผัน → การ์ดขึ้นพร้อมช่อง "ผ่อนผัน 7 วัน (ลูกค้าเก่า)" ที่บอกจำนวน', async () => {
    renderWithStats({ ...ZERO_STATS, LEGACY_LINK_GRACE: 3 });
    expect(await screen.findByText(/Compliance blocks/)).toBeInTheDocument();
    expect(cellOf(/ผ่อนผัน 7 วัน \(ลูกค้าเก่า\)/)).toHaveTextContent(
      /ผ่อนผัน 7 วัน \(ลูกค้าเก่า\):\s*3$/,
    );
  });

  it('ช่องเดิมสี่ช่องยังอยู่ และแต่ละช่องบอกจำนวนของคีย์ตัวเอง', async () => {
    renderWithStats({
      OUTSIDE_HOURS: 1,
      FREQUENCY_CAP: 2,
      NO_CONSENT: 4,
      HOLIDAY_BLOCK: 5,
      LEGACY_LINK_GRACE: 6,
    });
    await screen.findByText(/Compliance blocks/);
    expect(cellOf(/นอกเวลา/)).toHaveTextContent(/1$/);
    expect(cellOf(/เกินจำนวนครั้ง/)).toHaveTextContent(/2$/);
    expect(cellOf(/ไม่มี PDPA/)).toHaveTextContent(/4$/);
    expect(cellOf(/วันหยุด/)).toHaveTextContent(/5$/);
    expect(cellOf(/ผ่อนผัน 7 วัน/)).toHaveTextContent(/6$/);
  });

  it('ผู้คุมงาน (รอบเก็บ): ห้าช่องอยู่แถวเดียวบนจอกว้าง (lg) · แท็บเล็ตคงสี่คอลัมน์ · มือถือสองคอลัมน์', async () => {
    renderWithStats({ ...ZERO_STATS, NO_CONSENT: 1 });
    await screen.findByText(/Compliance blocks/);
    const grid = cellOf(/ผ่อนผัน 7 วัน/).parentElement as HTMLElement;
    expect(grid.children).toHaveLength(5);
    expect(grid).toHaveClass('grid', 'grid-cols-2', 'md:grid-cols-4', 'lg:grid-cols-5');
  });

  it('ทุกช่องเป็นศูนย์ → ไม่แสดงการ์ด', async () => {
    renderWithStats(ZERO_STATS);
    await screen.findByText('ส่งเตือนก่อนครบกำหนด');
    expect(screen.queryByText(/Compliance blocks/)).not.toBeInTheDocument();
  });
});

describe('NotificationsPage — แท็บ', () => {
  it('ไม่มีแท็บ "ส่งการแจ้งเตือน" (คำตัดสินเจ้าของ #42 — ส่งข้อความหาลูกค้าใช้อินบ็อกซ์)', async () => {
    renderWithStats(ZERO_STATS);
    expect(await screen.findByRole('button', { name: 'ประวัติการส่ง' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แม่แบบข้อความ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่งการแจ้งเตือน' })).not.toBeInTheDocument();
  });
});
