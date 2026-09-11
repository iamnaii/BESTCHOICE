import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

import QcSummaryCard from '../QcSummaryCard';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('QcSummaryCard — ผลตรวจ QC ย่อ + ดูรายข้อ', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      data: {
        id: 'i1',
        isCompleted: true,
        results: [
          { id: 'r1', passFail: true, grade: null, notes: null, templateItem: { itemName: 'หน้าจอ', category: 'ภายนอก', sortOrder: 2 } },
          { id: 'r2', passFail: false, grade: null, notes: 'ลำโพงแตก', templateItem: { itemName: 'ลำโพง', category: 'ฟังก์ชัน', sortOrder: 1 } },
          { id: 'r3', passFail: null, grade: null, notes: null, templateItem: { itemName: 'แบตเตอรี่', category: 'ฟังก์ชัน', sortOrder: 3 } },
        ],
      },
    });
  });

  it('สรุป "ผ่าน 2 / 3 ข้อ" + เกรด และเปิดรายข้อใน dialog เรียงตาม sortOrder', async () => {
    render(
      <Wrapper>
        <QcSummaryCard inspection={{ id: 'i1', overallGrade: 'B', isCompleted: true }} />
      </Wrapper>,
    );
    expect(await screen.findByText('ผ่าน 2 / 3 ข้อ')).toBeInTheDocument();
    expect(screen.getByText('ตรวจเสร็จ')).toBeInTheDocument();
    expect(screen.getByText('เกรด B')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ดูรายข้อ/ }));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('ลำโพง');
    expect(items[0]).toHaveTextContent('ลำโพงแตก');
    expect(items[1]).toHaveTextContent('หน้าจอ');
  });

  it('ยังไม่มีผลรายข้อ → โชว์สถานะกำลังตรวจ ไม่มีปุ่มดูรายข้อ', async () => {
    apiGet.mockResolvedValue({ data: { id: 'i2', isCompleted: false, results: [] } });
    render(
      <Wrapper>
        <QcSummaryCard inspection={{ id: 'i2', overallGrade: null, isCompleted: false }} />
      </Wrapper>,
    );
    expect(await screen.findByText('กำลังตรวจ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ดูรายข้อ/ })).toBeNull();
  });
});
