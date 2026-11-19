import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: vi.fn(),
  },
}));

import { OverpriceRulesTab } from '../OverpriceRulesTab';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderTab() {
  render(
    <Wrapper>
      <OverpriceRulesTab />
    </Wrapper>,
  );
}

describe('OverpriceRulesTab — ผ่อนสูงสุด + ดาวน์ขั้นต่ำต่อกฎ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    apiPatch.mockResolvedValue({ data: {} });
    apiPost.mockResolvedValue({ data: {} });
    apiGet.mockResolvedValue({
      data: [
        {
          id: 'r1',
          label: 'iPhone 17 มือ 1',
          seriesPattern: 'iPhone 17|iPhone Air',
          condition: 'HAND_1',
          allowance: '2000',
          maxMonths: 15,
          minDownPct: 30,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
        {
          id: 'r2',
          label: 'iPhone 12 มือ 2',
          seriesPattern: 'iPhone 12',
          condition: 'HAND_2',
          allowance: '0',
          maxMonths: null,
          minDownPct: null,
          isActive: true,
          updatedAt: '2026-09-11T03:00:00.000Z',
        },
      ],
    });
  });

  it('มีคอลัมน์ผ่อนสูงสุด: โชว์ "15 งวด" และ "ไม่จำกัด" เมื่อ null', async () => {
    renderTab();
    expect(await screen.findByRole('columnheader', { name: 'ผ่อนสูงสุด' })).toBeInTheDocument();
    expect(screen.getByText('15 งวด')).toBeInTheDocument();
    expect(screen.getByText('ไม่จำกัด')).toBeInTheDocument();
  });

  it('มีคอลัมน์ดาวน์ขั้นต่ำ: โชว์ "30%" และ "ตามค่าตั้งต้น" เมื่อ null', async () => {
    renderTab();
    expect(await screen.findByRole('columnheader', { name: 'ดาวน์ขั้นต่ำ' })).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('ตามค่าตั้งต้น')).toBeInTheDocument();
  });

  it('แก้กฎ: ช่อง "ดาวน์ขั้นต่ำ %" ขึ้นค่าเดิม · ลบให้ว่างแล้วบันทึก → ส่ง minDownPct: null', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'แก้ไข iPhone 17 มือ 1' }));
    const field = screen.getByLabelText('ดาวน์ขั้นต่ำ %');
    expect(field).toHaveValue('30');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        '/gfin-config/overprice-rules/r1',
        expect.objectContaining({ minDownPct: null, maxMonths: 15 }),
      ),
    );
  });

  it('แก้กฎที่ยังไม่ตั้ง: พิมพ์ 30 แล้วบันทึก → ส่ง minDownPct: 30', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'แก้ไข iPhone 12 มือ 2' }));
    const field = screen.getByLabelText('ดาวน์ขั้นต่ำ %');
    expect(field).toHaveValue('');
    await userEvent.type(field, '30');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(
        '/gfin-config/overprice-rules/r2',
        expect.objectContaining({ minDownPct: 30, maxMonths: null }),
      ),
    );
  });
});
