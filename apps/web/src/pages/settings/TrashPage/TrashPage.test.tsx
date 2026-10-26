import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrashPage from './index';
import { settingsRegistry } from '@/config/settings-registry';

/**
 * ก้อน 8 A10 — หน้า ตั้งค่า › ระบบ & ความปลอดภัย › ถังขยะ (mockup กระดาน 1–2): chips ประเภท · ค้นหา · ช่วงเวลา ·
 * แถวกู้ได้/กู้ไม่ได้/ชี้ทาง · ยืนยันก่อนกู้ · กู้หลายรายการ · หน้าว่าง · ลงทะเบียน OWNER เท่านั้น
 */
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => (e as Error)?.message ?? String(e) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role: 'OWNER' } }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const TYPES = [
  { type: 'customer', label: 'ลูกค้า / ผู้สนใจ', group: 'ลูกค้าและการขาย', count: 2, restorable: true },
  { type: 'booking', label: 'ใบจอง', group: 'ลูกค้าและการขาย', count: 1, restorable: true },
  { type: 'contract', label: 'ร่างสัญญา', group: 'ลูกค้าและการขาย', count: 1, restorable: false },
  { type: 'promotion', label: 'โปรโมชัน', group: 'ตั้งค่า', count: 0, restorable: true },
  { type: 'product', label: 'สินค้า', group: 'สินค้า', count: 1, restorable: false },
];
const ROWS = [
  { type: 'customer', typeLabel: 'ลูกค้า / ผู้สนใจ', group: 'ลูกค้าและการขาย', id: 'c1', title: 'สมหญิง ทองดี', subtitle: 'โทร 08x-xxx-1234', deletedAt: '2026-10-25T07:02:00.000Z', deletedBy: { id: 'u-ek', name: 'เอก', system: false }, restorable: true, link: '/customers/c1' },
  { type: 'booking', typeLabel: 'ใบจอง', group: 'ลูกค้าและการขาย', id: 'b1', title: 'BK-20261024-0007 · สมชาย', subtitle: 'ยอด 1,000.00', deletedAt: '2026-10-24T11:40:00.000Z', deletedBy: null, restorable: true },
  { type: 'product', typeLabel: 'สินค้า', group: 'สินค้า', id: 'p1', title: 'Apple · iPhone 14 · 128GB', subtitle: 'IMEI …4421', deletedAt: '2026-10-18T04:30:00.000Z', deletedBy: { id: 'u-owner', name: 'เจ้าของ', system: false }, restorable: false, reason: 'กู้เครื่องผ่านคำขอ "พบของคืน"', actionLabel: 'ขอพบของคืน', link: '/stock/adjustments?request=found&q=35x' },
  { type: 'contract', typeLabel: 'ร่างสัญญา', group: 'ลูกค้าและการขาย', id: 'ct1', title: 'CT-1 · ประสิทธิ์', subtitle: 'ดาวน์ 5,000.00', deletedAt: '2026-10-17T08:48:00.000Z', deletedBy: { id: 'u-sys', name: 'SYSTEM', system: true }, restorable: false, reason: 'ระบบลบเอง (เช่น งวดบิลประจำถูกแทน) — กู้ไม่ได้' },
];
const listResponse = (rows = ROWS, extra: Record<string, unknown> = {}) => ({ data: rows, total: rows.length, page: 1, pageSize: 50, capped: true, ...extra });

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><TrashPage /></MemoryRouter></QueryClientProvider>);
}
const listCalls = () => apiMock.get.mock.calls.filter(([p]) => p === '/trash');
const lastListParams = () => listCalls().at(-1)?.[1]?.params ?? {};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/trash/types' ? { types: TYPES } : listResponse() }));
  apiMock.post.mockResolvedValue({ data: { ok: true, warnings: [], link: '/customers/c1' } });
});

describe('TrashPage', () => {
  it('T1 แสดง chips ที่มีของ แถวกู้ได้/ชี้ทาง/กู้ไม่ได้ และผู้ลบ', async () => {
    wrap();
    expect(await screen.findByRole('tab', { name: /ทั้งหมด/ })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /ลูกค้า \/ ผู้สนใจ/ })).toHaveTextContent('2');
    expect(screen.queryByRole('tab', { name: /โปรโมชัน/ })).not.toBeInTheDocument(); // count 0 ไม่โชว์

    const customer = await screen.findByRole('row', { name: /สมหญิง ทองดี/ });
    expect(within(customer).getByRole('button', { name: 'กู้คืน' })).toBeInTheDocument();
    expect(within(customer).getByRole('checkbox', { name: /เลือก สมหญิง/ })).toBeInTheDocument();
    expect(customer).toHaveTextContent('เอก');

    const product = screen.getByRole('row', { name: /iPhone 14/ });
    expect(within(product).getByRole('link', { name: 'ขอพบของคืน' })).toHaveAttribute('href', '/stock/adjustments?request=found&q=35x');
    expect(within(product).queryByRole('checkbox')).not.toBeInTheDocument();

    const contract = screen.getByRole('row', { name: /CT-1/ });
    expect(contract).toHaveTextContent('ระบบลบเอง');
    expect(within(contract).queryByRole('button', { name: 'กู้คืน' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /BK-20261024-0007/ })).toHaveTextContent('ไม่ทราบ');
    expect(screen.getByText(/50 รายการต่อประเภท/)).toBeInTheDocument();
  });

  it('T2 กด chip ประเภท → ขอรายการเฉพาะประเภทนั้น', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole('tab', { name: /ลูกค้า \/ ผู้สนใจ/ }));
    await waitFor(() => expect(lastListParams()).toMatchObject({ type: 'customer', days: 90, page: 1 }));
  });

  it('T3 พิมพ์ค้นหา → ส่ง q หลัง debounce', async () => {
    const user = userEvent.setup();
    wrap();
    await user.type(await screen.findByRole('searchbox', { name: 'ค้นหา' }), 'สม');
    await waitFor(() => expect(lastListParams()).toMatchObject({ q: 'สม' }));
  });

  it('T4 กู้คืน → ยืนยัน → POST → toast + โหลดใหม่', async () => {
    const user = userEvent.setup();
    wrap();
    const customer = await screen.findByRole('row', { name: /สมหญิง ทองดี/ });
    const before = listCalls().length;
    await user.click(within(customer).getByRole('button', { name: 'กู้คืน' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('สมหญิง ทองดี');
    await user.click(within(dialog).getByRole('button', { name: 'กู้คืน' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/trash/customer/c1/restore'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('สมหญิง ทองดี'), expect.anything()));
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it('T5 API ปฏิเสธ (409) → toast error ข้อความจาก API', async () => {
    const user = userEvent.setup();
    apiMock.post.mockRejectedValue(new Error('กู้ไม่ได้: เบอร์ 08x-xxx-1234 ถูกใช้โดยลูกค้า "ประสิทธิ์ ท." แล้ว'));
    wrap();
    const customer = await screen.findByRole('row', { name: /สมหญิง ทองดี/ });
    await user.click(within(customer).getByRole('button', { name: 'กู้คืน' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'กู้คืน' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('ประสิทธิ์ ท.')));
  });

  it('T6 เลือกหลายรายการ → กู้คืนที่เลือก → POST bulk → สรุปผลรายตัว', async () => {
    const user = userEvent.setup();
    apiMock.post.mockResolvedValue({ data: { results: [{ type: 'customer', id: 'c1', ok: true, warnings: [] }, { type: 'booking', id: 'b1', ok: false, error: 'เครื่องถูกใบจอง BK-9 ล็อกอยู่' }] } });
    wrap();
    await user.click(await screen.findByRole('checkbox', { name: /เลือก สมหญิง/ }));
    await user.click(screen.getByRole('checkbox', { name: /เลือก BK-20261024-0007/ }));
    await user.click(screen.getByRole('button', { name: 'กู้คืนที่เลือก (2)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'กู้คืน' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/trash/restore', { items: [{ type: 'customer', id: 'c1' }, { type: 'booking', id: 'b1' }] }));
    const result = await screen.findByRole('dialog', { name: /สำเร็จ 1/ });
    expect(result).toHaveTextContent('ไม่สำเร็จ 1');
    expect(result).toHaveTextContent('BK-9');
  });

  it('T7 ว่าง → ข้อความ + "ดูทั้งหมด" ขอ days=0', async () => {
    const user = userEvent.setup();
    apiMock.get.mockImplementation(async (path: string) => ({ data: path === '/trash/types' ? { types: TYPES.map((t) => ({ ...t, count: 0 })) } : listResponse([]) }));
    wrap();
    expect(await screen.findByText(/ไม่มีของที่ถูกลบ/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
    await waitFor(() => expect(lastListParams()).toMatchObject({ days: 0 }));
  });

  it('T8 ลงทะเบียนใน settings หมวด system เป็น route OWNER เท่านั้น', () => {
    const system = settingsRegistry.find((c) => c.id === 'system')!;
    const item = system.items.find((i) => i.id === 'trash')!;
    expect(item).toMatchObject({ kind: 'route', path: '/settings/system/trash', roles: ['OWNER'] });
    expect(item.component).toBeTruthy();
  });
});
