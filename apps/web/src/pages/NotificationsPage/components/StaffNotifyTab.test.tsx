import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StaffNotifyTab from './StaffNotifyTab';
import NotificationsPage from '../index';

/**
 * ก้อน 7 A16 — แท็บ "แจ้งพนักงาน (LINE)" (mockup กระดาน 1): สถานะ Staff OA · พนักงานยังไม่ผูก · ตารางเหตุการณ์ × บทบาท ·
 * แถบ "ยังไม่ได้บันทึก" · บันทึก → PUT · ส่งทดสอบถึงฉัน → POST · OWNER เท่านั้นที่เห็นแท็บ
 */

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => String(e) }));

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role } }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

type Rule = { enabled: boolean; roles: string[]; branchScoped: boolean; includeGroup: boolean };
const rule = (roles: string[], over: Partial<Rule> = {}): Rule => ({ enabled: true, roles, branchScoped: false, includeGroup: false, ...over });
const CATALOG: Array<{ key: string; group: string; label: string; description: string; defaults: Rule }> = [
  { key: 'recurring_bill', group: 'บิลประจำ', label: 'บิลประจำใกล้ครบกำหนด / ครบวันนี้ / เกินกำหนด', description: 'วันละครั้งต่อสถานะ', defaults: rule(['OWNER', 'ACCOUNTANT']) },
  { key: 'expense.pending_approval', group: 'ใบรายจ่าย', label: 'ใบรายจ่ายรออนุมัติ', description: 'ถึงผู้อนุมัติ', defaults: rule(['OWNER']) },
  { key: 'ap.due', group: 'ใบรายจ่าย', label: 'เจ้าหนี้ครบกำหนดจ่าย', description: '', defaults: rule(['OWNER', 'ACCOUNTANT'], { enabled: false }) },
  { key: 'petty_cash.replenish', group: 'ใบรายจ่าย', label: 'เงินสดย่อยต่ำกว่าเกณฑ์เติม', description: '', defaults: rule(['OWNER', 'ACCOUNTANT']) },
  { key: 'chat.handoff', group: 'แชทลูกค้า', label: 'ลูกค้าขอคุยกับคน', description: '', defaults: rule(['OWNER', 'FINANCE_MANAGER'], { includeGroup: true }) },
  { key: 'chat.slip_review', group: 'แชทลูกค้า', label: 'สลิปโอนยอดไม่ตรง / ผิดบัญชี', description: '', defaults: rule(['FINANCE_MANAGER'], { includeGroup: true }) },
  { key: 'chat.slip_sla', group: 'แชทลูกค้า', label: 'สลิปค้างตรวจเกิน SLA', description: '', defaults: rule(['OWNER', 'FINANCE_MANAGER']) },
  { key: 'chat.web_inquiry', group: 'แชทลูกค้า', label: 'ข้อความสอบถามจากเว็บ', description: '', defaults: rule(['OWNER'], { includeGroup: true }) },
  { key: 'stock.low', group: 'สต๊อก', label: 'ของต่ำกว่าจุดสั่งซื้อซ้ำ', description: 'ซ้ำไม่เกินวันละครั้ง', defaults: rule(['OWNER', 'BRANCH_MANAGER'], { branchScoped: true }) },
  { key: 'cash_close.missed', group: 'เงินสดหน้าร้าน', label: 'สาขาไม่ปิดยอดเงินสดของเมื่อวาน', description: '', defaults: rule(['OWNER', 'BRANCH_MANAGER'], { branchScoped: true }) },
  { key: 'cash_close.awaiting', group: 'เงินสดหน้าร้าน', label: 'เงินสดนับแล้ว รอยืนยันรับเงินเกิน 1 วัน', description: '', defaults: rule(['OWNER', 'FINANCE_MANAGER']) },
  { key: 'sale.completed', group: 'การขาย', label: 'ขายสดสำเร็จ (POS / ไฟแนนซ์นอก)', description: '', defaults: rule(['OWNER'], { enabled: false }) },
  { key: 'contract.activated', group: 'การขาย', label: 'สัญญาผ่อนเปิดใช้', description: '', defaults: rule(['OWNER'], { enabled: false }) },
  { key: 'overdue.owner_alert', group: 'ติดตามหนี้', label: 'แจ้งเจ้าของจากงานติดตามหนี้', description: '', defaults: rule(['OWNER']) },
  { key: 'auth.new_device_login', group: 'ระบบ', label: 'ล็อกอินจากอุปกรณ์ใหม่', description: '', defaults: rule(['OWNER']) },
  { key: 'report.owner_daily', group: 'รายงาน', label: 'รายงานรายวันถึงเจ้าของ', description: '', defaults: rule(['OWNER']) },
  { key: 'collections.daily_summary', group: 'รายงาน', label: 'สรุปติดตามหนี้รายวัน', description: '', defaults: rule(['OWNER', 'FINANCE_MANAGER']) },
  { key: 'sms.credit_low', group: 'ระบบ', label: 'SMS credit ใกล้หมด', description: '', defaults: rule(['OWNER']) },
];
const RULES = Object.fromEntries(CATALOG.map((c) => [c.key, { ...c.defaults, roles: [...c.defaults.roles] }]));
const settings = (over: Record<string, unknown> = {}) => ({
  configured: true,
  groupTargets: 3,
  webhookUrl: 'https://api.test/api/webhooks/line-staff',
  usage: { used: 12, cap: 280, monthKey: '2026-10' },
  monthlyCap: 280,
  catalog: CATALOG,
  rules: RULES,
  unlinkedUsers: [
    { id: 'u-somying', name: 'สมหญิง', role: 'ACCOUNTANT', branchName: null },
    { id: 'u-ek', name: 'เอก', role: 'BRANCH_MANAGER', branchName: 'บางนา' },
  ],
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'OWNER';
  apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/staff-notify/rules' ? settings() : undefined }));
  apiMock.put.mockResolvedValue({ data: { rules: RULES } });
  apiMock.post.mockResolvedValue({ data: { recipients: 1, sent: 1, deduped: 0, failed: 0, quotaSkipped: 0 } });
});

describe('StaffNotifyTab', () => {
  it('T1: แสดงทุกเหตุการณ์ในแคตตาล็อก สถานะเชื่อมต่อแล้ว โควต้า และรายชื่อพนักงานที่ยังไม่ผูก', async () => {
    wrap(<StaffNotifyTab />);
    expect(await screen.findByText('เชื่อมต่อแล้ว')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(CATALOG.length);
    expect(screen.getByRole('switch', { name: 'เปิด ของต่ำกว่าจุดสั่งซื้อซ้ำ' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'เปิด เจ้าหนี้ครบกำหนดจ่าย' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/12 \/ 280/)).toBeInTheDocument();
    expect(screen.getByText(/กลุ่ม LINE จาก Integration/)).toHaveTextContent('3 รหัส');
    const unlinked = screen.getByText('2 คน').closest('section')!;
    expect(within(unlinked).getByRole('link', { name: /สมหญิง/ })).toHaveAttribute('href', '/users/u-somying');
    expect(within(unlinked).getByRole('link', { name: /เอก/ })).toHaveTextContent('ผจก.สาขา บางนา');
    expect(screen.getByLabelText('ของต่ำกว่าจุดสั่งซื้อซ้ำ — ผจก.สาขา')).toBeChecked();
    expect(screen.getByLabelText('ของต่ำกว่าจุดสั่งซื้อซ้ำ — บัญชี')).not.toBeChecked();
    expect(screen.getByLabelText('ของต่ำกว่าจุดสั่งซื้อซ้ำ — เฉพาะสาขาที่เกี่ยว')).toBeChecked();
    expect(screen.getByRole('button', { name: 'บันทึกกติกา' })).toBeDisabled();
  });

  it('T2: ติ๊กบทบาทเพิ่ม → แถบยังไม่ได้บันทึก (1 รายการ) → บันทึก → PUT กติกาครบทุกคีย์ + toast', async () => {
    const user = userEvent.setup();
    wrap(<StaffNotifyTab />);
    await user.click(await screen.findByLabelText('ของต่ำกว่าจุดสั่งซื้อซ้ำ — บัญชี'));
    expect(screen.getByText('มีการแก้ไขที่ยังไม่ได้บันทึก (1 รายการ)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกกติกา' }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
    const [path, body] = apiMock.put.mock.calls[0];
    expect(path).toBe('/staff-notify/rules');
    expect(Object.keys(body.rules)).toHaveLength(CATALOG.length);
    expect(body.rules['stock.low'].roles).toEqual(['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER']);
    expect(body.rules['chat.handoff']).toEqual(RULES['chat.handoff']);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('บันทึกกติกาแล้ว'));
  });

  it('T2b: ปิดสวิตช์ + คืนค่าเริ่มต้น → แถบหายเมื่อกลับเท่าค่าบนเซิร์ฟเวอร์', async () => {
    const user = userEvent.setup();
    wrap(<StaffNotifyTab />);
    await user.click(await screen.findByRole('switch', { name: 'เปิด ของต่ำกว่าจุดสั่งซื้อซ้ำ' }));
    expect(screen.getByText('มีการแก้ไขที่ยังไม่ได้บันทึก (1 รายการ)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'คืนค่าเริ่มต้น' }));
    expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกกติกา' })).toBeDisabled();
  });

  it('T3: "ส่งทดสอบถึงฉัน" ของแถว ลูกค้าขอคุยกับคน → POST /staff-notify/test { eventKey: chat.handoff }', async () => {
    const user = userEvent.setup();
    wrap(<StaffNotifyTab />);
    const row = await screen.findByRole('row', { name: /ลูกค้าขอคุยกับคน/ });
    await user.click(within(row).getByRole('button', { name: 'ส่งทดสอบถึงฉัน' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/staff-notify/test', { eventKey: 'chat.handoff' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('T4: Staff OA ยังไม่ตั้งค่า → กล่องเตือน + ลิงก์ Integration Hub + ปุ่มทดสอบทุกแถว disabled', async () => {
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/staff-notify/rules' ? settings({ configured: false, groupTargets: 0 }) : undefined }));
    wrap(<StaffNotifyTab />);
    expect(await screen.findByText('ยังไม่ตั้งค่า')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ตั้งค่า Staff OA/ })).toHaveAttribute('href', '/settings/integrations/hub');
    const buttons = screen.getAllByRole('button', { name: 'ส่งทดสอบถึงฉัน' });
    expect(buttons).toHaveLength(CATALOG.length);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('NotificationsPage — แท็บแจ้งพนักงาน', () => {
  it('T5: OWNER เห็นแท็บและเปิดได้ · บทบาทอื่นไม่มีแท็บ', async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<NotificationsPage />);
    await user.click(await screen.findByRole('button', { name: 'แจ้งพนักงาน (LINE)' }));
    expect(await screen.findByText('เชื่อมต่อแล้ว')).toBeInTheDocument();
    unmount();

    role = 'ACCOUNTANT';
    wrap(<NotificationsPage />);
    expect(await screen.findByRole('button', { name: 'ประวัติการส่ง' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แจ้งพนักงาน (LINE)' })).not.toBeInTheDocument();
  });
});
