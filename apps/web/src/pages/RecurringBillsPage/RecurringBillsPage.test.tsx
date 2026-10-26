import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RecurringBillMonthView, RecurringBillRow } from '@/hooks/useRecurringBills';

const apiGet = vi.fn();
const apiPost = vi.fn();
let templatesEnabled = true;
let user: { id: string; role: string; branchId: string | null } = { id: 'u-owner', role: 'OWNER', branchId: null };
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: () => 'ทำรายการไม่สำเร็จ',
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ templatesEnabled, maxTemplatesPerUser: 20 }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/components/expense-templates/RecurringBillDialog', () => ({
  RecurringBillDialog: ({ open, templateId }: { open: boolean; templateId?: string | null }) =>
    open ? <div role="dialog" aria-label="ตั้งบิลประจำ">{templateId ?? 'new'}</div> : null,
}));
import RecurringBillsPage from './index';

/** เที่ยงคืนไทย = 17:00Z ของวันก่อนหน้า (รูปแบบเดียวกับ API) */
const bkk = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d - 1, 17, 0, 0)).toISOString();
function row(over: Partial<RecurringBillRow> & Pick<RecurringBillRow, 'templateName' | 'status'>): RecurringBillRow {
  return {
    occurrenceId: 'occ-x', templateId: 'tpl-x', vendorName: null, branch: { id: 'br-1', name: 'ลาดพร้าว' }, recurrence: 'MONTHLY',
    periodKey: '2026-10', periodLabel: 'ต.ค. 2569', dueDate: bkk(2026, 10, 15), windowOpensOn: bkk(2026, 10, 12), daysUntilDue: 0, daysOverdue: 0,
    expectedAmount: null, awaitingSystem: false, documentMissing: false, templateDeleted: false, paymentConfigured: true,
    document: null, todoId: null, paidAt: null, paidById: null, paidByName: null, paidNote: null, skippedAt: null, skipReason: null, skippedByName: null,
    ...over,
  };
}
// 7 แถวตาม mockup กระดาน 1 (ตุลาคม 2569 · วันนี้ 26 ต.ค.)
const rows: RecurringBillRow[] = [
  row({ occurrenceId: 'occ-1', templateId: 'tpl-1', templateName: 'ค่าเช่าร้าน สาขาลาดพร้าว', vendorName: 'บจก.ลาดพร้าวพลาซ่า', status: 'PAID', dueDate: bkk(2026, 10, 1), expectedAmount: '25000', paidAt: '2026-09-30T03:00:00.000Z', document: { id: 'doc-1', number: 'EX-20260928-0003', status: 'POSTED', totalAmount: '25000', paidAt: '2026-09-30T03:00:00.000Z', deletedAt: null } }),
  row({ occurrenceId: 'occ-2', templateId: 'tpl-2', templateName: 'ค่าไฟ สาขาลาดพร้าว', vendorName: 'การไฟฟ้านครหลวง', status: 'PAID_UNPOSTED', dueDate: bkk(2026, 10, 15), expectedAmount: '8500', paidAt: '2026-10-14T03:00:00.000Z', paidById: 'u-2', paidByName: 'สมหญิง', paidNote: 'ตัดบัตรอัตโนมัติ', document: { id: 'doc-2', number: 'EX-20261012-0007', status: 'DRAFT', totalAmount: '8500', paidAt: null, deletedAt: null } }),
  row({ occurrenceId: 'occ-3', templateId: 'tpl-3', templateName: 'อินเทอร์เน็ต AIS Fibre', vendorName: 'บมจ.แอดวานซ์ ไวร์เลส เน็ทเวอร์ค', status: 'OVERDUE', dueDate: bkk(2026, 10, 24), daysOverdue: 2, expectedAmount: '1284', document: { id: 'doc-3', number: 'EX-20261021-0002', status: 'DRAFT', totalAmount: '1284', paidAt: null, deletedAt: null } }),
  row({ occurrenceId: 'occ-4', templateId: 'tpl-4', templateName: 'ค่าเช่าโกดัง', vendorName: 'คุณประสิทธิ์ ทองดี', status: 'DUE_TODAY', dueDate: bkk(2026, 10, 26), expectedAmount: '12000', documentMissing: true, document: { id: 'doc-4', number: 'EX-20261023-0005', status: 'DRAFT', totalAmount: '12000', paidAt: null, deletedAt: '2026-10-25T04:00:00.000Z' } }),
  row({ occurrenceId: 'occ-5', templateId: 'tpl-5', templateName: 'ประกันภัยร้าน (รายปี)', vendorName: 'บมจ.ทิพยประกันภัย', recurrence: 'YEARLY', periodKey: '2026', periodLabel: 'ปี 2569', status: 'PENDING', dueDate: bkk(2026, 10, 29), daysUntilDue: 3, expectedAmount: '18900', document: { id: 'doc-5', number: 'EX-20261026-0001', status: 'DRAFT', totalAmount: '18900', paidAt: null, deletedAt: null } }),
  row({ occurrenceId: null, templateId: 'tpl-6', templateName: 'ค่าน้ำ สาขาบางนา', vendorName: 'การประปานครหลวง', branch: { id: 'br-2', name: 'บางนา' }, status: 'UPCOMING', dueDate: bkk(2026, 10, 31), windowOpensOn: bkk(2026, 10, 28), daysUntilDue: 5, expectedAmount: '900', documentMissing: true, paymentConfigured: false }),
  row({ occurrenceId: 'occ-7', templateId: 'tpl-7', templateName: 'ค่าทำบัญชี', vendorName: 'สนง.บัญชีเอกสิทธิ์', recurrence: 'QUARTERLY', periodKey: '2026-Q4', periodLabel: 'ไตรมาส 4/2569', status: 'SKIPPED', dueDate: bkk(2026, 10, 5), expectedAmount: '6000', documentMissing: true, skippedAt: '2026-10-03T02:00:00.000Z', skipReason: 'จ่ายล่วงหน้าทั้งปีไปแล้วเมื่อ ก.ค.', skippedByName: 'เอก' }),
];
const view: RecurringBillMonthView = {
  month: '2026-10',
  summary: { upcoming: 1, pending: 1, dueToday: 1, overdue: 1, paid: 1, paidUnposted: 1, skipped: 1, amountRemaining: '33084.00' },
  rows,
};
const emptyView: RecurringBillMonthView = { month: '2026-10', summary: { upcoming: 0, pending: 0, dueToday: 0, overdue: 0, paid: 0, paidUnposted: 0, skipped: 0, amountRemaining: '0.00' }, rows: [] };

function LocationProbe() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function mount(data: RecurringBillMonthView = view, entry = '/expenses/recurring-bills?month=2026-10') {
  apiGet.mockImplementation((path: string) => Promise.resolve({
    data: path.startsWith('/recurring-bills?') ? data : path === '/branches' ? [{ id: 'br-1', name: 'ลาดพร้าว' }, { id: 'br-2', name: 'บางนา' }] : [],
  }));
  apiPost.mockResolvedValue({ data: {} });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}><RecurringBillsPage /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const billRow = (name: string) => screen.getByRole('row', { name });
/** ชื่อปุ่ม/ลิงก์ในช่อง "การทำ" ของแถว เรียงตาม DOM */
const actionNames = (name: string) =>
  Array.from(within(billRow(name)).getByTestId('bill-actions').querySelectorAll('a,button')).map((el) => el.textContent?.trim());
const postedPaths = () => apiPost.mock.calls.map((c) => c[0]);

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset();
  templatesEnabled = true;
  user = { id: 'u-owner', role: 'OWNER', branchId: null };
});

describe('หน้าบิลประจำ — เดือนเดียว ทุกสถานะในตารางเดียว', () => {
  it('แสดง 7 แถว ป้ายสถานะ ป้ายใบ ชิปสรุป และหัวเดือน ตาม mockup', async () => {
    mount();
    expect(await screen.findByRole('row', { name: 'ค่าเช่าร้าน สาขาลาดพร้าว' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(8); // หัวตาราง + 7
    const expected: Array<[string, string, string]> = [
      ['ค่าเช่าร้าน สาขาลาดพร้าว', 'จ่ายแล้ว', 'จ่ายแล้ว · 25,000.00'],
      ['ค่าไฟ สาขาลาดพร้าว', 'จ่ายแล้ว · ยังไม่ลงบัญชี', 'ร่าง · รอลงบัญชี'],
      ['อินเทอร์เน็ต AIS Fibre', 'เกินกำหนด 2 วัน', 'ร่าง · ยังไม่โพสต์'],
      ['ค่าเช่าโกดัง', 'ครบกำหนดวันนี้', 'ร่างถูกลบ'],
      ['ประกันภัยร้าน (รายปี)', 'รอจ่าย', 'ร่าง · ยังไม่โพสต์'],
      ['ค่าน้ำ สาขาบางนา', 'รอถึงรอบ', 'ยังไม่มี'],
      ['ค่าทำบัญชี', 'ข้ามงวดนี้', '—'],
    ];
    for (const [name, status, doc] of expected) {
      expect(within(billRow(name)).getByTestId('bill-status')).toHaveTextContent(status);
      expect(within(billRow(name)).getByTestId('bill-document')).toHaveTextContent(doc);
    }
    expect(within(billRow('ค่าน้ำ สาขาบางนา')).getByText('ระบบจะสร้างร่าง 28 ต.ค. 69')).toBeInTheDocument();
    expect(within(billRow('อินเทอร์เน็ต AIS Fibre')).getByText('งาน HIGH ใน /todos · เตือนซ้ำทุกวัน')).toBeInTheDocument(); // ยังไม่ส่ง LINE จริง — ห้ามอ้าง (รีวิว M3)
    expect(within(billRow('ค่าเช่าโกดัง')).getByTestId('bill-document')).toHaveTextContent('EX-20261023-0005');
    expect(within(billRow('ค่าเช่าโกดัง')).getByText('ถูกลบ 25 ต.ค. 69')).toBeInTheDocument();
    expect(within(billRow('ค่าน้ำ สาขาบางนา')).getByText('ยังไม่ตั้งวิธีจ่าย')).toBeInTheDocument();
    expect(within(billRow('ค่าทำบัญชี')).getByText(/โดย เอก 3 ต\.ค\. 69 — "จ่ายล่วงหน้าทั้งปีไปแล้วเมื่อ ก\.ค\."/)).toBeInTheDocument();
    expect(within(billRow('ค่าไฟ สาขาลาดพร้าว')).getByText(/บันทึกเองโดย สมหญิง — "ตัดบัตรอัตโนมัติ"/)).toBeInTheDocument();
    expect(within(billRow('ค่าเช่าร้าน สาขาลาดพร้าว')).getByRole('link', { name: 'EX-20260928-0003' })).toHaveAttribute('href', '/expenses/doc-1');
    expect(screen.getByRole('heading', { name: 'บิลประจำ — ตุลาคม 2569' })).toBeInTheDocument();
    expect(screen.getByTestId('chip-overdue')).toHaveTextContent('เกินกำหนด 1');
    expect(screen.getByTestId('chip-paidUnposted')).toHaveTextContent('จ่ายแล้ว · ยังไม่ลงบัญชี 1');
    expect(screen.getByTestId('amount-remaining')).toHaveTextContent('33,084.00');
    expect(apiGet).toHaveBeenCalledWith('/recurring-bills?month=2026-10');
  });

  it('ปุ่มต่อสถานะตาม mockup: เกินกำหนด/รอจ่าย เปิดร่าง·จ่ายแล้ว·ข้าม · ร่างถูกลบ สร้างร่างใหม่ · ยังไม่ลงบัญชี เปิดร่าง·เปิดใหม่ · รอถึงรอบ แก้ไขบิล · จ่ายแล้ว ดูใบ · ข้าม(คน) เปิดใหม่', async () => {
    mount();
    await screen.findByRole('row', { name: 'อินเทอร์เน็ต AIS Fibre' });
    expect(actionNames('อินเทอร์เน็ต AIS Fibre')).toEqual(['เปิดร่าง', 'จ่ายแล้ว', 'ข้าม']);
    expect(within(billRow('อินเทอร์เน็ต AIS Fibre')).getByRole('link', { name: 'เปิดร่าง' })).toHaveAttribute('href', '/expenses/doc-3');
    expect(actionNames('ประกันภัยร้าน (รายปี)')).toEqual(['เปิดร่าง', 'จ่ายแล้ว', 'ข้าม']);
    expect(actionNames('ค่าเช่าโกดัง')).toEqual(['สร้างร่างใหม่', 'จ่ายแล้ว', 'ข้าม']);
    expect(actionNames('ค่าไฟ สาขาลาดพร้าว')).toEqual(['เปิดร่าง', 'เปิดใหม่']);
    expect(actionNames('ค่าน้ำ สาขาบางนา')).toEqual(['แก้ไขบิล']);
    expect(actionNames('ค่าเช่าร้าน สาขาลาดพร้าว')).toEqual(['ดูใบ']);
    expect(within(billRow('ค่าเช่าร้าน สาขาลาดพร้าว')).getByRole('link', { name: 'ดูใบ' })).toHaveAttribute('href', '/expenses/doc-1');
    expect(actionNames('ค่าทำบัญชี')).toEqual(['เปิดใหม่']);
  });

  it('ข้าม: เหตุผลสั้นกว่า 5 ตัวอักษรกดยืนยันไม่ได้ · ครบแล้วยิง POST skip พร้อมเหตุผล', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('row', { name: 'อินเทอร์เน็ต AIS Fibre' });
    await u.click(within(billRow('อินเทอร์เน็ต AIS Fibre')).getByRole('button', { name: 'ข้าม' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('อินเทอร์เน็ต AIS Fibre');
    const confirm = within(dialog).getByRole('button', { name: 'ยืนยันข้าม' });
    expect(confirm).toBeDisabled();
    const reason = within(dialog).getByLabelText('เหตุผล');
    await u.type(reason, 'สั้น');
    expect(confirm).toBeDisabled();
    await u.clear(reason);
    await u.type(reason, 'จ่ายล่วงหน้าทั้งปีแล้ว');
    expect(confirm).toBeEnabled();
    await u.click(confirm);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/recurring-bills/occ-3/skip', { reason: 'จ่ายล่วงหน้าทั้งปีแล้ว' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('จ่ายแล้ว: ยิง POST mark-paid พร้อมหมายเหตุและวันที่จ่าย', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('row', { name: 'ประกันภัยร้าน (รายปี)' });
    await u.click(within(billRow('ประกันภัยร้าน (รายปี)')).getByRole('button', { name: 'จ่ายแล้ว' }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText('หมายเหตุ'), 'ตัดบัตรอัตโนมัติ');
    await u.click(within(dialog).getByRole('button', { name: 'บันทึกจ่ายแล้ว' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/recurring-bills/occ-5/mark-paid', { note: 'ตัดบัตรอัตโนมัติ', paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it('งวดที่ระบบข้าม (งวดหลุด) มีปุ่ม "จ่ายแล้ว" = เปิดใหม่ก่อนแล้วบันทึกจ่าย', async () => {
    const u = userEvent.setup();
    mount({ ...view, rows: [row({ occurrenceId: 'occ-9', templateId: 'tpl-9', templateName: 'บิลหลุด', status: 'SKIPPED', dueDate: bkk(2026, 10, 10), documentMissing: true, skippedAt: '2026-10-20T01:05:00.000Z', skipReason: 'งวดผ่านไปก่อนระบบเริ่มติดตาม', skippedByName: null })] });
    await screen.findByRole('row', { name: 'บิลหลุด' });
    expect(actionNames('บิลหลุด')).toEqual(['เปิดใหม่', 'จ่ายแล้ว']);
    expect(within(billRow('บิลหลุด')).getByText(/โดย ระบบ 20 ต\.ค\. 69/)).toBeInTheDocument();
    await u.click(within(billRow('บิลหลุด')).getByRole('button', { name: 'จ่ายแล้ว' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'บันทึกจ่ายแล้ว' }));
    await waitFor(() => expect(postedPaths()).toEqual(['/recurring-bills/occ-9/reopen', '/recurring-bills/occ-9/mark-paid']));
  });

  it('งวดหลุด: เปิดใหม่ตอบ 409 "รอจ่ายอยู่แล้ว" → ยังบันทึกจ่ายต่อ · บันทึกจ่ายล้ม → หน้าโหลดใหม่เอง (รีวิว M2)', async () => {
    const u = userEvent.setup();
    mount({ ...view, rows: [row({ occurrenceId: 'occ-9', templateId: 'tpl-9', templateName: 'บิลหลุด', status: 'SKIPPED', dueDate: bkk(2026, 10, 10), documentMissing: true, skippedAt: '2026-10-20T01:05:00.000Z', skipReason: 'งวดผ่านไปก่อนระบบเริ่มติดตาม', skippedByName: null })] });
    await screen.findByRole('row', { name: 'บิลหลุด' });
    apiPost.mockImplementation((path: string) =>
      path.endsWith('/reopen')
        ? Promise.reject({ response: { status: 409, data: { message: 'งวดนี้อยู่ในสถานะรอจ่ายอยู่แล้ว' } } })
        : Promise.reject({ response: { status: 500, data: { message: 'boom' } } }),
    );
    const getsBefore = apiGet.mock.calls.length;
    await u.click(within(billRow('บิลหลุด')).getByRole('button', { name: 'จ่ายแล้ว' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'บันทึกจ่ายแล้ว' }));
    await waitFor(() => expect(postedPaths()).toEqual(['/recurring-bills/occ-9/reopen', '/recurring-bills/occ-9/mark-paid']));
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(getsBefore));
  });

  it('ร่างถูกลบ: "สร้างร่างใหม่" ยิง create-draft · "เปิดใหม่" ยิง reopen', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('row', { name: 'ค่าเช่าโกดัง' });
    await u.click(within(billRow('ค่าเช่าโกดัง')).getByRole('button', { name: 'สร้างร่างใหม่' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/recurring-bills/occ-4/create-draft'));
    await u.click(within(billRow('ค่าไฟ สาขาลาดพร้าว')).getByRole('button', { name: 'เปิดใหม่' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/recurring-bills/occ-2/reopen'));
  });

  it('แม่แบบถูกลบ: ไม่มีปุ่มสร้างร่างใหม่ แต่ยังจ่ายแล้ว/ข้ามได้ และบอกว่าแม่แบบถูกลบ', async () => {
    mount({ ...view, rows: [row({ occurrenceId: 'occ-8', templateId: 'tpl-8', templateName: 'บิลเลิกใช้', status: 'OVERDUE', daysOverdue: 4, documentMissing: true, templateDeleted: true })] });
    await screen.findByRole('row', { name: 'บิลเลิกใช้' });
    expect(actionNames('บิลเลิกใช้')).toEqual(['จ่ายแล้ว', 'ข้าม']);
    expect(within(billRow('บิลเลิกใช้')).getByText('แม่แบบถูกลบ')).toBeInTheDocument();
  });

  it('เลื่อนเดือน: ปุ่มเดือนถัดไปเปลี่ยน ?month และโหลดเดือนใหม่ · ผจก.สาขาไม่มีตัวเลือกสาขา', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('row', { name: 'ค่าเช่าร้าน สาขาลาดพร้าว' });
    expect(screen.getByLabelText('สาขา')).toHaveDisplayValue('ทุกสาขา');
    await u.click(screen.getByRole('button', { name: 'เดือนถัดไป' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/recurring-bills?month=2026-11');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/recurring-bills?month=2026-11'));
    expect(screen.getByRole('heading', { name: 'บิลประจำ — พฤศจิกายน 2569' })).toBeInTheDocument();
  });

  it('ผู้จัดการสาขา: ไม่มีตัวเลือกสาขา (API ล็อกสาขาตนเอง)', async () => {
    user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br-1' };
    mount();
    await screen.findByRole('row', { name: 'ค่าเช่าร้าน สาขาลาดพร้าว' });
    expect(screen.queryByLabelText('สาขา')).toBeNull();
  });

  it('ไม่มีบิลในเดือน → empty state เปิดกล่องตั้งบิลประจำ', async () => {
    const u = userEvent.setup();
    mount(emptyView);
    expect(await screen.findByText('ยังไม่มีบิลประจำในเดือนนี้')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '+ บิลประจำ' });
    await u.click(buttons[buttons.length - 1]);
    expect(screen.getByRole('dialog', { name: 'ตั้งบิลประจำ' })).toHaveTextContent('new');
  });

  it('"แก้ไขบิล" บนแถวรอถึงรอบ เปิดกล่องแก้ไขพร้อม templateId', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('row', { name: 'ค่าน้ำ สาขาบางนา' });
    await u.click(within(billRow('ค่าน้ำ สาขาบางนา')).getByRole('button', { name: 'แก้ไขบิล' }));
    expect(screen.getByRole('dialog', { name: 'ตั้งบิลประจำ' })).toHaveTextContent('tpl-6');
  });

  it('ปิด templates_enabled → กล่องปิดใช้งาน และไม่โหลดข้อมูล', async () => {
    templatesEnabled = false;
    mount();
    expect(await screen.findByText('ระบบรายการโปรด/บิลประจำถูกปิดใช้งาน')).toBeInTheDocument();
    expect(apiGet.mock.calls.some((c) => String(c[0]).startsWith('/recurring-bills'))).toBe(false);
  });
});
