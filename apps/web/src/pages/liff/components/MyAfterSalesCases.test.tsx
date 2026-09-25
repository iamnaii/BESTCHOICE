import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { liffApi } from '@/lib/api';
import MyAfterSalesCases from './MyAfterSalesCases';
import type { LiffAfterSalesResponse } from './MyAfterSalesCases';

vi.mock('@/lib/api', () => ({
  liffApi: {
    get: vi.fn(),
  },
}));

function renderWithClient(lineId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyAfterSalesCases lineId={lineId} />
    </QueryClientProvider>,
  );
}

function mockResponse(data: LiffAfterSalesResponse) {
  vi.mocked(liffApi.get).mockResolvedValue({ data });
}

describe('MyAfterSalesCases', () => {
  beforeEach(() => {
    vi.mocked(liffApi.get).mockReset();
  });

  // (a) mock 1 เคส REPAIR now=1 (stage IN_REPAIR — ขั้นที่ 2 "กำลังซ่อม" กำลังทำอยู่)
  it('แสดงหัว "เคสของฉัน" การ์ดเคส + ชิปสถานะ + ol 4 ขั้นตอนที่ขั้นปัจจุบันถูกต้อง', async () => {
    mockResponse({
      linked: true,
      cases: [
        {
          caseNumber: 'AS-20260925-0001',
          outcome: 'REPAIR',
          stageLabel: 'กำลังซ่อม',
          deviceName: 'iPhone 13',
          branchName: 'สาขาลาดพร้าว',
          steps: [
            { title: 'รับเรื่องแล้ว', state: 'done', hint: null },
            { title: 'กำลังซ่อม', state: 'now', hint: 'ส่งศูนย์ 20 ก.ย. 69' },
            { title: 'รอรับเครื่อง', state: 'idle', hint: null },
            { title: 'ปิดเคส', state: 'idle', hint: null },
          ],
          updatedAt: '2026-09-25T03:00:00.000Z',
          costLine: 'ไม่มี (ในประกันร้าน)',
        },
      ],
    });

    renderWithClient('U123');

    await waitFor(() => expect(liffApi.get).toHaveBeenCalledWith('/line-oa/liff/my-after-sales-cases'));

    expect(await screen.findByText('เคสของฉัน')).toBeInTheDocument();
    expect(screen.getByText('AS-20260925-0001')).toBeInTheDocument();

    // ชิปสถานะ "กำลังซ่อม" ปรากฏ (อาจซ้ำกับข้อความในขั้นตอน — ยืนยันว่ามีอย่างน้อยหนึ่งจุด)
    expect(screen.getAllByText('กำลังซ่อม').length).toBeGreaterThan(0);

    const list = screen.getByRole('list', { name: 'ขั้นตอน' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);

    // ขั้นที่ 2 (index 1) คือขั้นที่กำลังทำ — มีข้อความ "กำลังซ่อม" และ aria-current="step"
    const nowStep = items[1];
    expect(nowStep).toHaveAttribute('aria-current', 'step');
    expect(nowStep.textContent).toContain('กำลังซ่อม');

    // ขั้นอื่นไม่ติด aria-current
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[2]).not.toHaveAttribute('aria-current');
    expect(items[3]).not.toHaveAttribute('aria-current');
  });

  // (b) cases: [] → ไม่มีหัว "เคสของฉัน" ใน DOM เลย
  it('ไม่แสดงอะไรเลยเมื่อไม่มีเคส (ไม่มีหัวข้อ ไม่มีข้อความ "ไม่มีเคส")', async () => {
    mockResponse({ linked: true, cases: [] });

    const { container } = renderWithClient('U123');

    await waitFor(() => expect(liffApi.get).toHaveBeenCalled());

    expect(screen.queryByText('เคสของฉัน')).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่มีเคส/)).not.toBeInTheDocument();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  // (c) ข้อความห้าม "ใบรับเครื่อง" / "รับเครื่องคืน" — "รอรับเครื่อง"/"รอรับเครื่องใหม่" อนุญาต
  it('ไม่มีคำว่า "ใบรับเครื่อง" หรือ "รับเครื่องคืน" แม้จะมี "รอรับเครื่องใหม่" ในขั้นตอน', async () => {
    mockResponse({
      linked: true,
      cases: [
        {
          caseNumber: 'AS-20260925-0002',
          outcome: 'SAME_MODEL_EXCHANGE',
          stageLabel: 'รอรับเครื่อง',
          deviceName: 'iPhone 14',
          branchName: 'สาขาลาดพร้าว',
          steps: [
            { title: 'รับเรื่องแล้ว', state: 'done', hint: null },
            { title: 'รอผู้จัดการยืนยัน', state: 'done', hint: null },
            { title: 'รอรับเครื่องใหม่', state: 'now', hint: 'พร้อมรับ 24 ก.ย. 69' },
            { title: 'ปิดเคส', state: 'idle', hint: null },
          ],
          updatedAt: '2026-09-25T03:00:00.000Z',
          costLine: 'ไม่มี (เปลี่ยนเครื่องตามประกัน)',
        },
      ],
    });

    const { container } = renderWithClient('U123');

    await waitFor(() => expect(screen.getByText('เคสของฉัน')).toBeInTheDocument());

    const text = container.textContent ?? '';
    expect(text).toContain('รอรับเครื่องใหม่');
    expect(text).not.toContain('ใบรับเครื่อง');
    expect(text).not.toContain('รับเครื่องคืน');
  });
});
