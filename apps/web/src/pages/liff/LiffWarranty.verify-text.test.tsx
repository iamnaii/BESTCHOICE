import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { liffApi } from '@/lib/api';
import LiffWarranty from './LiffWarranty';

vi.mock('@/lib/api', () => ({ liffApi: { get: vi.fn() } }));
vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({
    lineId: 'U-test',
    idToken: 'token',
    profile: null,
    loading: false,
    error: null,
  }),
}));

/**
 * Task 22 — ลูกค้าผูก LINE ร้านด้วยการพิมพ์เบอร์ไม่ได้แล้ว (Task 20 C1) ⇒ หน้า "ประกันของฉัน" ที่ยังไม่ยืนยันตัวตนต้องชี้ทางที่ทำได้จริง:
 * พิมพ์ "ลงทะเบียน" ในแชท → ลิงก์ยืนยันตัวตน (เบอร์ + OTP)
 */
describe('LiffWarranty — ยังไม่ยืนยันตัวตน', () => {
  it('บอกให้พิมพ์ "ลงทะเบียน" แล้วยืนยันด้วย OTP — ไม่บอกให้พิมพ์เบอร์ให้ระบบผูกอัตโนมัติ', async () => {
    vi.mocked(liffApi.get).mockResolvedValue({
      data: { linked: false, customerName: null, devices: [] },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LiffWarranty />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('ยังไม่ได้ยืนยันตัวตน')).toBeInTheDocument();
    expect(screen.getByText('ลงทะเบียน')).toBeInTheDocument();
    expect(document.body.textContent).toContain('รหัส OTP ทาง SMS');
    expect(document.body.textContent).not.toContain('ผูกบัญชีให้อัตโนมัติ');
  });
});
