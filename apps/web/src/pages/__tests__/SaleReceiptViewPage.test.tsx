import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import SaleReceiptViewPage from '../SaleReceiptViewPage';

/**
 * ก้อน 4 — หน้าสาธารณะ `/r/:token` ของใบเสร็จขายสด (ลอกจาก `/cn/:token`): ดึง PDF ผ่าน liffApi (ไม่มี JWT)
 * แสดงใน iframe + ปุ่มดาวน์โหลด · ทุกความล้มเหลวเป็นข้อความกลางเดียวกับ API.
 */
const liffGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {},
  liffApi: { get: (...args: unknown[]) => liffGet(...args) },
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/r/:token" element={<SaleReceiptViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  liffGet.mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:receipt'), revokeObjectURL: vi.fn() });
});

describe('SaleReceiptViewPage', () => {
  it('fetches the public PDF with the token and shows it with a download button', async () => {
    liffGet.mockResolvedValue({ data: new Blob(['%PDF'], { type: 'application/pdf' }) });
    renderAt('/r/abc');
    expect(await screen.findByTitle('ใบเสร็จรับเงิน')).toHaveAttribute('src', 'blob:receipt');
    expect(liffGet).toHaveBeenCalledWith('/sales/receipt/public/abc/pdf', { responseType: 'blob' });
    expect(screen.getByRole('button', { name: /ดาวน์โหลด/ })).toBeInTheDocument();
  });

  it('shows the generic not-found message when the link is unknown or expired', async () => {
    liffGet.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }));
    renderAt('/r/expired');
    expect(await screen.findByText('ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว กรุณาติดต่อร้าน BESTCHOICE')).toBeInTheDocument();
    expect(screen.queryByTitle('ใบเสร็จรับเงิน')).toBeNull();
  });
});
