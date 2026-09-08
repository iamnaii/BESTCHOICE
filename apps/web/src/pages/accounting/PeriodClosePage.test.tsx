import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PeriodClosePage from './PeriodClosePage';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: apiGet, post: apiPost } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1', role: 'OWNER' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const currentYear = new Date().getFullYear();
const companies = [
  { id: 'test-finance-id', companyCode: 'TEST_FINANCE', nameTh: 'ข้อมูลทดสอบเดิม' },
  { id: 'shop-id', companyCode: 'SHOP', nameTh: 'บริษัท หน้าร้าน' },
  { id: 'finance-id', companyCode: 'FINANCE', nameTh: 'บริษัท การเงิน' },
];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ data: {} });
  apiGet.mockImplementation(async (path: string, options?: { params: { companyId: string; year: number } }) => {
    if (path === '/companies') return { data: companies };
    if (path === '/expenses/periods/overview' && options) {
      return { data: [
        { ...options.params, month: 1, status: 'OPEN', closedAt: null, reviewStartedAt: null },
        { ...options.params, month: 2, status: 'CLOSED', closedAt: null, reviewStartedAt: null },
      ] };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><PeriodClosePage /></QueryClientProvider>);
  return { client, invalidate };
}

async function expectOverview(companyId: string, year: number) {
  await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/expenses/periods/overview', {
    params: { companyId, year },
  }));
  await screen.findByText(`ม.ค. ${year}`);
}

function activateTab(tab: HTMLElement) {
  // Radix Tabs activates on primary mouse down (or keyboard), not click alone.
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
}

function periodAction(month: string, year: number, action: string) {
  const row = screen.getByText(`${month} ${year}`).closest('tr')!;
  return within(row).getByRole('button', { name: action });
}

describe('PeriodClosePage company tabs and captured period targets', () => {
  it('defaults to FINANCE and queries each company/year independently while keeping the year selector', async () => {
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'เลือกนิติบุคคล' });
    const finance = within(tabs).getByRole('tab', { name: 'FINANCE (การเงิน)' });
    const shop = within(tabs).getByRole('tab', { name: 'SHOP (หน้าร้าน)' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
    expect(within(tabs).queryByRole('tab', { name: 'TEST_FINANCE' })).not.toBeInTheDocument();
    await expectOverview('finance-id', currentYear);
    expect(finance).toHaveAttribute('aria-selected', 'true');
    expect(shop).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('combobox', { name: 'เลือกนิติบุคคล' })).not.toBeInTheDocument();

    const year = screen.getByRole('combobox', { name: 'เลือกปี' });
    expect(within(year).getAllByRole('option').map((option) => option.textContent)).toEqual([
      String(currentYear + 542), String(currentYear + 543), String(currentYear + 544),
    ]);
    activateTab(shop);
    await expectOverview('shop-id', currentYear);
    expect(shop).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(year, { target: { value: String(currentYear - 1) } });
    await expectOverview('shop-id', currentYear - 1);
    activateTab(finance);
    await expectOverview('finance-id', currentYear - 1);
    expect(year).toHaveValue(String(currentYear - 1));
    expect(apiGet.mock.calls.filter(([path]) => path === '/companies')).toHaveLength(1);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('confirms a SHOP close with its selected company id and year', async () => {
    renderPage();
    await expectOverview('finance-id', currentYear);
    activateTab(screen.getByRole('tab', { name: 'SHOP (หน้าร้าน)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เลือกปี' }), {
      target: { value: String(currentYear - 1) },
    });
    await expectOverview('shop-id', currentYear - 1);
    fireEvent.click(periodAction('ม.ค.', currentYear - 1, 'ปิดงวด'));
    const dialog = await screen.findByRole('dialog', { name: 'ปิดงวดบัญชี' });
    expect(dialog).toHaveTextContent('SHOP');
    expect(dialog).toHaveTextContent(`ม.ค. ${currentYear + 542}`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดงวด' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expenses/periods/close', {
      companyId: 'shop-id', year: currentYear - 1, month: 1,
    }));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('cannot retarget an open close confirmation by changing the background company/year', async () => {
    const { invalidate } = renderPage();
    await expectOverview('finance-id', currentYear);
    const shop = screen.getByRole('tab', { name: 'SHOP (หน้าร้าน)' });
    const year = screen.getByRole('combobox', { name: 'เลือกปี' });
    fireEvent.click(periodAction('ม.ค.', currentYear, 'ปิดงวด'));
    const dialog = await screen.findByRole('dialog', { name: 'ปิดงวดบัญชี' });

    // Dispatch background changes directly to verify the captured target even
    // though the modal normally prevents pointer access to these controls.
    activateTab(shop);
    fireEvent.change(year, { target: { value: String(currentYear - 1) } });
    await expectOverview('shop-id', currentYear - 1);
    expect(dialog).toHaveTextContent('FINANCE');
    expect(dialog).toHaveTextContent(`ม.ค. ${currentYear + 543}`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดงวด' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expenses/periods/close', {
      companyId: 'finance-id', year: currentYear, month: 1,
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['accounting-periods', 'finance-id', currentYear],
    }));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('keeps the reopen company/year/month and structured reason after background selection changes', async () => {
    const { invalidate } = renderPage();
    await expectOverview('finance-id', currentYear);
    const finance = screen.getByRole('tab', { name: 'FINANCE (การเงิน)' });
    activateTab(screen.getByRole('tab', { name: 'SHOP (หน้าร้าน)' }));
    const year = screen.getByRole('combobox', { name: 'เลือกปี' });
    fireEvent.change(year, { target: { value: String(currentYear - 1) } });
    await expectOverview('shop-id', currentYear - 1);
    fireEvent.click(periodAction('ก.พ.', currentYear - 1, 'เปิดงวด'));
    const dialog = await screen.findByRole('dialog', { name: /คุณกำลังเปิดงวด/ });

    activateTab(finance);
    fireEvent.change(year, { target: { value: String(currentYear) } });
    await expectOverview('finance-id', currentYear);
    expect(dialog).toHaveTextContent('SHOP');
    expect(dialog).toHaveTextContent(`ก.พ. ${currentYear + 542}`);
    fireEvent.click(within(dialog).getByLabelText(/พบเอกสารผิดต้อง reverse/));
    fireEvent.change(within(dialog).getByLabelText(/บันทึกรายละเอียด/), {
      target: { value: 'แก้ไขเอกสารที่ลงวันที่ผิด' },
    });
    fireEvent.click(within(dialog).getByLabelText('ยังไม่ได้ยื่น'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันเปิดงวด' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expenses/periods/reopen', {
      companyId: 'shop-id', year: currentYear - 1, month: 2,
      reasonType: 'WRONG_ENTRY', reason: 'แก้ไขเอกสารที่ลงวันที่ผิด', taxFiled: false,
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['accounting-periods', 'shop-id', currentYear - 1],
    }));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
