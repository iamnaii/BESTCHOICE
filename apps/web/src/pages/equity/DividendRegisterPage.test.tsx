import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { CERTIFICATE_PAYER_ENDPOINT } from '@/lib/certificate-payer';
import DividendRegisterPage from './DividendRegisterPage';

/**
 * DOC-08 (#1567) — the dividend 50 ทวิ certificate never found its payer: the
 * page called `GET /company` (the route is `/companies`, so every call was a
 * 404) and, had the list loaded, silently fell back to the first company (SHOP)
 * when the FINANCE entity was missing. Same defect as WhtAnnualPage (DOC-04).
 */
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), default: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const finance = { id: 'f', nameTh: 'บริษัทไฟแนนซ์', taxId: '0000000000000', address: 'ที่อยู่ FINANCE', directorName: 'ผู้ลงนาม', companyCode: 'FINANCE' };
const shop = { id: 's', nameTh: 'บริษัทหน้าร้าน', taxId: '1111111111111', address: 'ที่อยู่ SHOP', directorName: 'ผู้จัดการ', companyCode: 'SHOP' };
const register = { year: new Date().getFullYear(), rows: [{ shareholderId: 'sh1', name: 'ผู้ถือหุ้น หนึ่ง', taxId: '7000000000001', type: 'INDIVIDUAL', payCount: 2, gross: '45000.00', wht: '4500.00', net: '40500.00', docNumbers: ['EQ-20260310-0001', 'EQ-20260905-0001'] }], totals: { gross: '45000.00', wht: '4500.00', net: '40500.00' } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><DividendRegisterPage /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DividendRegisterPage — certificate payer', () => {
  it('loads the payer from the companies list route that exists and prints the FINANCE identity', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/equity/') ? register : [shop, finance] }));
    renderPage();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(CERTIFICATE_PAYER_ENDPOINT));
    fireEvent.click(await screen.findByRole('button', { name: /หนังสือรับรอง/ }));
    await screen.findByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
    expect(screen.getAllByText('บริษัทไฟแนนซ์').length).toBeGreaterThan(0);
    expect(screen.getByText(/ผู้ลงนาม/)).toBeInTheDocument();
    expect(screen.queryByText('บริษัทหน้าร้าน')).toBeNull();
  });

  it('says plainly that the FINANCE entity is missing instead of printing the SHOP identity', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/equity/') ? register : [shop] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /หนังสือรับรอง/ }));
    await screen.findByText(/ไม่พบข้อมูลบริษัทฝั่ง FINANCE/);
    expect(screen.queryByText('บริษัทหน้าร้าน')).toBeNull();
    expect(screen.queryByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย')).toBeNull();
    expect(screen.queryByRole('button', { name: 'พิมพ์' })).toBeNull();
  });

  it('reports a failed companies request with a retry instead of a permanent "loading"', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/equity/')) return { data: register };
      throw new Error('Request failed with status code 404');
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /หนังสือรับรอง/ }));
    await screen.findByText(/โหลดข้อมูลบริษัทไม่สำเร็จ/);
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/equity/') ? register : [finance] }));
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
  });
});
