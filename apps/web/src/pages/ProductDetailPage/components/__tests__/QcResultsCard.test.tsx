import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QcResultsCard from '../QcResultsCard';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => apiGet(...args) } }));

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

// braces จำเป็น — arrow ไม่มี braces จะ return ตัว mock (mockReset คืน instance) แล้ว vitest
// ถือ return value ของ beforeEach เป็น cleanup fn → เรียก apiGet() เปล่าๆ หลังจบแต่ละเทสต์
beforeEach(() => {
  apiGet.mockReset();
});

describe('QcResultsCard', () => {
  it('แสดงผลตรวจรายข้อพร้อมผ่าน/ไม่ผ่าน', async () => {
    apiGet.mockResolvedValue({
      data: {
        id: 'i-1',
        isCompleted: true,
        results: [
          { id: 'r-1', passFail: true, grade: null, notes: null, templateItem: { itemName: 'จอภาพ', category: 'หน้าจอ', sortOrder: 1 } },
          { id: 'r-2', passFail: false, grade: null, notes: 'มีรอย', templateItem: { itemName: 'ตัวเครื่อง', category: 'ภายนอก', sortOrder: 2 } },
        ],
      },
    });

    render(wrap(<QcResultsCard inspectionId="i-1" />));

    expect(await screen.findByText('จอภาพ')).toBeInTheDocument();
    expect(screen.getByText('ตัวเครื่อง')).toBeInTheDocument();
    expect(screen.getByText('มีรอย')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/inspections/i-1');
  });

  it('ไม่มีผลตรวจรายข้อ → ไม่ render การ์ด', async () => {
    apiGet.mockResolvedValue({ data: { id: 'i-1', isCompleted: false, results: [] } });
    const { container } = render(wrap(<QcResultsCard inspectionId="i-1" />));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toContain('ผลตรวจรายข้อ'));
  });

  it('เรียงตาม sortOrder ไม่ใช่ลำดับที่ API ส่งมา (service ไม่ orderBy ให้)', async () => {
    apiGet.mockResolvedValue({
      data: {
        id: 'i-1',
        isCompleted: true,
        results: [
          { id: 'r-2', passFail: true, grade: null, notes: null, templateItem: { itemName: 'ลำโพง', category: 'เสียง', sortOrder: 9 } },
          { id: 'r-1', passFail: true, grade: null, notes: null, templateItem: { itemName: 'จอภาพ', category: 'หน้าจอ', sortOrder: 1 } },
        ],
      },
    });

    render(wrap(<QcResultsCard inspectionId="i-1" />));

    const items = await screen.findAllByRole('listitem');
    expect(items[0].textContent).toContain('จอภาพ');
    expect(items[1].textContent).toContain('ลำโพง');
  });
});
