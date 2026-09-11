import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import WhtAnnualPage from './WhtAnnualPage';
import { CERTIFICATE_PAYER_ENDPOINT, resolveCertificatePayer } from '@/lib/certificate-payer';

/**
 * DOC-04 (#1563) — the 50 ทวิ certificate never found its payer: the page
 * called `GET /company` (the route is `/companies`, so every call was a 404)
 * and, had the list loaded, silently fell back to the first company (SHOP)
 * when the FINANCE entity was missing.
 */
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), default: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const finance = { id: 'f', nameTh: 'บริษัทไฟแนนซ์', taxId: '0000000000000', address: 'ที่อยู่ FINANCE', directorName: 'ผู้ลงนาม', companyCode: 'FINANCE' };
const shop = { id: 's', nameTh: 'บริษัทหน้าร้าน', taxId: '1111111111111', address: 'ที่อยู่ SHOP', directorName: 'ผู้จัดการ', companyCode: 'SHOP' };
const preview = { year: 2026, items: [{ employeeName: 'พนักงาน e1', employeeTaxId: '7000000000001', monthsPaid: 2, grossTotal: '37000.00', whtTotal: '350.00', ssoTotal: '1750.00' }], count: 1, grossTotal: '37000.00', whtTotal: '350.00', annualWageTotal: '37000.00' };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WhtAnnualPage /></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('resolveCertificatePayer', () => {
  it('picks the FINANCE entity whatever its position', () => {
    expect(resolveCertificatePayer([shop, finance])).toBe(finance);
  });

  it('never falls back to the first company when FINANCE is missing', () => {
    expect(resolveCertificatePayer([shop])).toBeNull();
    expect(resolveCertificatePayer([])).toBeNull();
    expect(resolveCertificatePayer(undefined)).toBeNull();
  });
});

describe('WhtAnnualPage — certificate payer', () => {
  it('loads the payer from the companies list route that exists', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/tax/') ? preview : [shop, finance] }));
    renderPage();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(CERTIFICATE_PAYER_ENDPOINT));
    expect(CERTIFICATE_PAYER_ENDPOINT).toBe('/companies');
    fireEvent.click(await screen.findByRole('button', { name: /50 ทวิ/ }));
    await screen.findByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
    expect(screen.getAllByText('บริษัทไฟแนนซ์').length).toBeGreaterThan(0);
    expect(screen.queryByText('บริษัทหน้าร้าน')).toBeNull();
  });

  it('says plainly that the FINANCE entity is missing instead of printing the SHOP identity', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/tax/') ? preview : [shop] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /50 ทวิ/ }));
    await screen.findByText(/ไม่พบข้อมูลบริษัทฝั่ง FINANCE/);
    expect(screen.queryByText('บริษัทหน้าร้าน')).toBeNull();
    expect(screen.queryByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย')).toBeNull();
    expect(screen.queryByRole('button', { name: 'พิมพ์' })).toBeNull();
  });

  it('reports a failed companies request with a retry instead of a permanent "loading"', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/tax/')) return { data: preview };
      throw new Error('Request failed with status code 404');
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /50 ทวิ/ }));
    await screen.findByText(/โหลดข้อมูลบริษัทไม่สำเร็จ/);
    expect(screen.queryByText(/กำลังโหลดข้อมูลบริษัท/)).toBeNull();
    vi.mocked(api.get).mockImplementation(async (path: string) => ({ data: path.startsWith('/tax/') ? preview : [finance] }));
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
  });
});
