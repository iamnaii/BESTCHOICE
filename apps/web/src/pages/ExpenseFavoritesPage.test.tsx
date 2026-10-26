import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn() },
  getErrorMessage: () => 'ไม่สำเร็จ',
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ templatesEnabled: true, maxTemplatesPerUser: 20 }) }));
vi.mock('@/components/expense-templates/RecurringBillDialog', () => ({
  RecurringBillDialog: ({ open, template }: { open: boolean; template?: { id: string } | null }) =>
    open ? <div role="dialog" aria-label="ตั้งบิลประจำ">{template?.id ?? 'new'}</div> : null,
}));
import ExpenseFavoritesPage from './ExpenseFavoritesPage';

const templates = [
  {
    id: 'tpl-net', name: 'อินเทอร์เน็ต AIS Fibre', documentType: 'EXPENSE', branchId: 'br-1',
    prefilledData: { vendorName: 'บมจ.แอดวานซ์ ไวร์เลส เน็ทเวอร์ค', category: '53-1302', sampleAmount: 1284 },
    isRecurring: true, recurringDay: 24, recurrence: 'MONTHLY', recurringMonth: null, reminderLeadDays: 3, startsOn: '2026-09-30T17:00:00.000Z',
    branch: { id: 'br-1', name: 'ลาดพร้าว' }, createdBy: { id: 'u', name: 'เอก' }, createdAt: '', updatedAt: '',
  },
  {
    id: 'tpl-acct', name: 'ค่าทำบัญชี', documentType: 'EXPENSE', branchId: 'br-1',
    prefilledData: { vendorName: 'สนง.บัญชีเอกสิทธิ์', category: '53-1301', sampleAmount: 6000 },
    isRecurring: true, recurringDay: 5, recurrence: 'QUARTERLY', recurringMonth: 1, reminderLeadDays: 7, startsOn: '2026-09-30T17:00:00.000Z',
    branch: { id: 'br-1', name: 'ลาดพร้าว' }, createdBy: { id: 'u', name: 'เอก' }, createdAt: '', updatedAt: '',
  },
  {
    id: 'tpl-plain', name: 'ค่าซ่อมเครื่องปรับอากาศ', documentType: 'EXPENSE', branchId: 'br-1',
    prefilledData: { vendorName: 'ช่างแอร์' },
    isRecurring: false, recurringDay: null, recurrence: null, recurringMonth: null, reminderLeadDays: 3, startsOn: null,
    branch: { id: 'br-1', name: 'ลาดพร้าว' }, createdBy: { id: 'u', name: 'เอก' }, createdAt: '', updatedAt: '',
  },
];
function LocationProbe() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function mount() {
  apiGet.mockImplementation((path: string) => Promise.resolve({ data: path.startsWith('/expense-templates') ? templates : [] }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/expenses/favorites']}><ExpenseFavoritesPage /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const card = (name: string) => screen.getByRole('article', { name });

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T03:00:00Z')); // 26 ต.ค. 2569
});
afterEach(() => { vi.useRealTimers(); });

describe('หน้ารายการโปรด — การ์ดบิลประจำ', () => {
  it('การ์ดบิลประจำมีป้าย บรรทัดรอบ และปุ่ม "เปิดร่างงวดนี้" ไปเดือนของงวดถัดไป · การ์ดธรรมดาไม่เปลี่ยน · โควต้านับเฉพาะแม่แบบธรรมดา', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'อินเทอร์เน็ต AIS Fibre' });
    expect(within(card('อินเทอร์เน็ต AIS Fibre')).getByText('บิลประจำ')).toBeInTheDocument();
    expect(within(card('อินเทอร์เน็ต AIS Fibre')).getByText('ทุกวันที่ 24 · รายเดือน · เตือนล่วงหน้า 3 วัน · งวดถัดไป 24 พ.ย. 69')).toBeInTheDocument();
    expect(within(card('ค่าทำบัญชี')).getByText('ทุกวันที่ 5 · ราย 3 เดือน (ม.ค./เม.ย./ก.ค./ต.ค.) · เตือนล่วงหน้า 7 วัน · งวดถัดไป 5 ม.ค. 70')).toBeInTheDocument();
    expect(within(card('ค่าซ่อมเครื่องปรับอากาศ')).getByRole('button', { name: 'ใช้' })).toBeInTheDocument();
    expect(within(card('ค่าซ่อมเครื่องปรับอากาศ')).queryByText('บิลประจำ')).toBeNull();
    expect(screen.getByRole('heading', { name: /รายการโปรด/ })).toHaveTextContent('(1/20)');
    // งวดของเดือนนี้ (24 ต.ค.) ครบกำหนดไปแล้ว → ต้องเปิดเดือนที่งวดนั้นอยู่ ไม่ใช่เดือนของงวดถัดไป (รีวิว I4)
    await u.click(within(card('อินเทอร์เน็ต AIS Fibre')).getByRole('button', { name: 'เปิดร่างงวดนี้' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/recurring-bills?month=2026-10');
    await u.click(within(card('ค่าทำบัญชี')).getByRole('button', { name: 'เปิดร่างงวดนี้' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/recurring-bills?month=2026-10'); // ไตรมาส 4 ครบ 5 ต.ค.
  });

  it('"แก้ไข" เปิดกล่องพร้อมแม่แบบเดิม · "+ บิลประจำ" เปิดกล่องว่าง · "บิลประจำเดือนนี้" ไปหน้าบิลประจำ', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('article', { name: 'ค่าทำบัญชี' });
    await u.click(within(card('ค่าทำบัญชี')).getByRole('button', { name: 'แก้ไข' }));
    expect(screen.getByRole('dialog', { name: 'ตั้งบิลประจำ' })).toHaveTextContent('tpl-acct');
    await u.click(screen.getByRole('button', { name: '+ บิลประจำ' }));
    expect(screen.getByRole('dialog', { name: 'ตั้งบิลประจำ' })).toHaveTextContent('new');
    await u.click(screen.getByRole('button', { name: 'บิลประจำเดือนนี้' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/recurring-bills');
  });
});
