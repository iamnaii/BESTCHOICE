import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TicketRedirect from './TicketRedirect';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: (error: Error) => error.message,
}));

function renderAt(id: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/insurance/${id}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/insurance/:id" element={<TicketRedirect />} />
          <Route path="/after-sales/:id" element={<div>หน้าเคสใหม่</div>} />
          <Route path="/after-sales" element={<div>หน้าหลังการขาย</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TicketRedirect — A1/A3 final-fix: fallback เฉพาะ 404 เท่านั้น', () => {
  it('เจอเคสใหม่ (200) → เด้งไป /after-sales/:id', async () => {
    mocks.get.mockResolvedValue({ data: { id: 'case-9' } });
    renderAt('rt-1');

    expect(await screen.findByText('หน้าเคสใหม่')).toBeInTheDocument();
  });

  it('404 (ไม่มีเคสผูกใบซ่อมนี้) → ข้อความ "ไม่พบเคส" + ลิงก์ไปหน้าหลังการขาย (หน้าใบซ่อมเดิมถูกถอดแล้ว)', async () => {
    mocks.get.mockRejectedValue({ response: { status: 404 } });
    renderAt('rt-2');

    expect(await screen.findByText('ไม่พบเคสหลังการขายของใบซ่อมนี้')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'ไปหน้าหลังการขาย' }));
    expect(await screen.findByText('หน้าหลังการขาย')).toBeInTheDocument();
  });

  it('500 (server พัง) → ไม่ fallback ไปหน้าเดิม แสดง error UI + ปุ่มลองใหม่แทน', async () => {
    mocks.get.mockRejectedValue({ response: { status: 500 } });
    renderAt('rt-3');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบเคสหลังการขายของใบซ่อมนี้')).not.toBeInTheDocument();
  });

  it('เครือข่ายล่ม (ไม่มี response เลย) → ไม่ fallback ไปหน้าเดิม แสดง error UI แทน', async () => {
    mocks.get.mockRejectedValue(new Error('Network Error'));
    renderAt('rt-4');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบเคสหลังการขายของใบซ่อมนี้')).not.toBeInTheDocument();
  });
});
