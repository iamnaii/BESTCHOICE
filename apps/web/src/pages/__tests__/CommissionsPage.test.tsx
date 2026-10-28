import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Payroll D4 ส่วนที่ 2 (Task 6, mockup กระดาน 4) — หน้าค่าคอม: จ่ายผ่านใบเงินเดือนเท่านั้น
 * · อนุมัติ = POST (P2-R19.7) · ไม่มีปุ่มจ่าย/สร้างใบจ่าย · แท็บใบจ่ายรายเดือนดูอย่างเดียว
 * · ชิปต่อรายการในใบเงินเดือน · เรียกคืนรอหัก / พนักงานลาออก · แบนเนอร์และลิงก์ใบเฉพาะคนที่เปิดหน้ารายจ่ายได้
 * · ส่ง `period` (API อ่านแค่ period — เดิมส่ง startDate/endDate ⇒ ตัวกรองเดือนไม่ทำงาน)
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
  },
  getErrorMessage: (e: { response?: { data?: { message?: string } } }) => e?.response?.data?.message ?? 'ผิดพลาด',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const auth = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', name: 'ผู้ทดสอบ', role: auth.role, branchId: 'b1' } }),
}));

import CommissionsPage from '../CommissionsPage';

const BANNER_TITLE = 'ค่าคอมไม่มีปุ่มจ่ายแยกแล้ว';
const BANNER_BODY =
  'อนุมัติรายการที่นี่ แล้วระบบดึงเข้าใบเงินเดือนให้เมื่อบันทึกใบ (หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR)) — ค่าคอมจะเป็น "จ่ายแล้ว" เมื่อใบเงินเดือนลงบัญชี';

type Link = { documentId: string; documentNumber: string; status: string; kind: 'PAY' | 'CLAWBACK' };
const commission = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  salesperson: { id: `sp-${id}`, name },
  contract: { contractNumber: `CT-${id}` },
  sale: null,
  saleAmount: '20000',
  commissionRate: '0.05',
  commissionAmount: '1000',
  status: 'APPROVED',
  createdAt: '2026-10-03T03:00:00.000Z',
  payrollLinks: [] as Link[],
  clawbackOutstanding: null,
  salespersonResigned: false,
  ...over,
});
const PR_A: Link = { documentId: 'doc-a', documentNumber: 'PR-20261031-0001', status: 'POSTED', kind: 'PAY' };

const ROWS = [
  commission('pending', 'กมล แสงทอง', { status: 'PENDING', commissionAmount: '650' }),
  commission('in-draft', 'สมศรี มีสุข', {
    payrollLinks: [{ documentId: 'doc-d', documentNumber: 'PR-20261101-0003', status: 'DRAFT', kind: 'PAY' }],
  }),
  commission('waiting', 'อรุณี แก้วใส', { commissionAmount: '900' }),
  // จ่ายใน PR-A แล้วหักคืนใน PR-B และ PR-C — สามชิป
  commission('three', 'วิชัย ทองดี', {
    status: 'PARTIALLY_CLAWED_BACK',
    commissionAmount: '1200',
    clawbackOutstanding: '0.00',
    payrollLinks: [
      PR_A,
      { documentId: 'doc-b', documentNumber: 'PR-20261130-0001', status: 'POSTED', kind: 'CLAWBACK' },
      { documentId: 'doc-c', documentNumber: 'PR-20261231-0001', status: 'DRAFT', kind: 'CLAWBACK' },
    ],
  }),
  commission('owed', 'ปรีชา ศรีสุข', { status: 'CLAWED_BACK', clawbackOutstanding: '400.00', payrollLinks: [PR_A] }),
  commission('resigned', 'มานี ใจงาม', {
    status: 'CLAWED_BACK',
    clawbackOutstanding: '300.00',
    salespersonResigned: true,
    payrollLinks: [PR_A],
  }),
  commission('outside', 'สมใจ นอกใบ', { status: 'CLAWED_BACK', clawbackOutstanding: null }),
  commission('paid', 'จันทร์ เพ็ญ', { status: 'PAID', payrollLinks: [PR_A] }),
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'OWNER';
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/commissions/payouts')) return Promise.resolve({ data: { data: [], total: 0 } });
    if (url.startsWith('/commissions')) return Promise.resolve({ data: { data: ROWS, total: ROWS.length } });
    return Promise.resolve({ data: [] });
  });
  apiPost.mockResolvedValue({ data: { id: 'pending', status: 'APPROVED' } });
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const rowOf = async (name: string) => screen.findByRole('row', { name: new RegExp(name) });
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

describe('CommissionsPage — the list query', () => {
  it('sends period=YYYY-MM (the API reads only period) and a page size that covers the month', async () => {
    mount();
    await rowOf('กมล แสงทอง');
    const url = apiGet.mock.calls.map((c) => c[0] as string).find((u) => u.startsWith('/commissions?'))!;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('period')).toBe(thisMonth());
    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
    expect(params.get('limit')).toBe('100');
  });
});

describe('CommissionsPage — approve only, no pay buttons', () => {
  it('อนุมัติ calls POST /commissions/:id/approve (the API route is POST) and refreshes the list', async () => {
    const user = userEvent.setup();
    mount();
    const row = await rowOf('กมล แสงทอง');
    const before = apiGet.mock.calls.filter((c) => (c[0] as string).startsWith('/commissions?')).length;
    await user.click(within(row).getByRole('button', { name: 'อนุมัติ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/commissions/pending/approve'));
    expect(apiPatch).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() =>
      expect(apiGet.mock.calls.filter((c) => (c[0] as string).startsWith('/commissions?')).length).toBeGreaterThan(before),
    );
  });

  it('no row has a จ่าย button; only PENDING rows have อนุมัติ', async () => {
    mount();
    await rowOf('กมล แสงทอง');
    expect(screen.queryByRole('button', { name: 'จ่าย' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'อนุมัติ' })).toHaveLength(1);
  });

  it('the payouts tab is view-only: no สร้างใบจ่าย, no อนุมัติ / จ่ายแล้ว, and the empty state names no button', async () => {
    const user = userEvent.setup();
    mount();
    await rowOf('กมล แสงทอง');
    await user.click(screen.getByRole('button', { name: /ใบจ่ายรายเดือน/ }));
    expect(await screen.findByText('ไม่พบข้อมูลใบจ่าย')).toBeInTheDocument();
    expect(screen.getByText('ดูอย่างเดียว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /สร้างใบจ่าย/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'จ่ายแล้ว' })).not.toBeInTheDocument();
    expect(screen.queryByText(/สร้างใบจ่าย/)).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('CommissionsPage — status labels and payroll chips', () => {
  it('labels: PENDING รออนุมัติ · APPROVED not yet in a payroll อนุมัติแล้ว · รอเข้าใบเงินเดือน · CLAWED_BACK เรียกคืน · PAID จ่ายแล้ว', async () => {
    mount();
    expect(within(await rowOf('กมล แสงทอง')).getByText('รออนุมัติ')).toBeInTheDocument();
    expect(within(await rowOf('อรุณี แก้วใส')).getByText('อนุมัติแล้ว · รอเข้าใบเงินเดือน')).toBeInTheDocument();
    expect(within(await rowOf('สมใจ นอกใบ')).getByText('เรียกคืน')).toBeInTheDocument();
    expect(within(await rowOf('จันทร์ เพ็ญ')).getByText('จ่ายแล้ว')).toBeInTheDocument();
    expect(within(await rowOf('วิชัย ทองดี')).getByText('เรียกคืนบางส่วน')).toBeInTheDocument();
  });

  it('an APPROVED commission already pulled into a draft payroll shows the payroll chip instead of "รอเข้าใบเงินเดือน"', async () => {
    mount();
    const row = await rowOf('สมศรี มีสุข');
    expect(within(row).getByText('อยู่ในใบเงินเดือน PR-20261101-0003 · ร่าง')).toBeInTheDocument();
    expect(within(row).queryByText('อนุมัติแล้ว · รอเข้าใบเงินเดือน')).not.toBeInTheDocument();
  });

  it('paid in PR-A and deducted in PR-B and PR-C → three chips, each a link to its payroll for OWNER', async () => {
    mount();
    const row = await rowOf('วิชัย ทองดี');
    const chips = [
      ['อยู่ในใบเงินเดือน PR-20261031-0001 · ลงบัญชีแล้ว', '/expenses/doc-a'],
      ['หักคืนในใบ PR-20261130-0001', '/expenses/doc-b'],
      ['หักคืนในใบ PR-20261231-0001', '/expenses/doc-c'],
    ];
    for (const [text, href] of chips) {
      expect(within(row).getByRole('link', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toHaveAttribute('href', href);
    }
    expect(within(row).queryByText(/รอหัก/)).not.toBeInTheDocument();
  });

  it('a clawback still to deduct shows เรียกคืน — รอหัก {n}; a resigned salesperson shows the owner-decision label', async () => {
    mount();
    expect(within(await rowOf('ปรีชา ศรีสุข')).getByText('เรียกคืน — รอหัก 400.00')).toBeInTheDocument();
    const resigned = await rowOf('มานี ใจงาม');
    expect(within(resigned).getByText('เรียกคืน — พนักงานลาออก ให้เจ้าของตัดสิน')).toBeInTheDocument();
    // P2-R30 — ยอดที่ค้างยังต้องเห็น (เจ้าของตัดสินจากยอดนี้)
    expect(within(resigned).getByText('รอหัก 300.00')).toBeInTheDocument();
  });

  it('payroll document statuses without a label fall back to Thai, never the enum (ACCRUAL / unknown)', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/commissions?')) {
        return Promise.resolve({
          data: {
            data: [
              commission('accrual', 'ก ตั้งค้าง', { payrollLinks: [{ documentId: 'd1', documentNumber: 'PR-1', status: 'ACCRUAL', kind: 'PAY' }] }),
              commission('odd', 'ข แปลก', { payrollLinks: [{ documentId: 'd2', documentNumber: 'PR-2', status: 'SOMETHING_NEW', kind: 'PAY' }] }),
            ],
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: { data: [], total: 0 } });
    });
    mount();
    expect(within(await rowOf('ก ตั้งค้าง')).getByText('อยู่ในใบเงินเดือน PR-1 · ตั้งค้างจ่าย')).toBeInTheDocument();
    expect(within(await rowOf('ข แปลก')).getByText('อยู่ในใบเงินเดือน PR-2 · สถานะอื่น')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW|ACCRUAL/)).not.toBeInTheDocument();
  });

  it('when the month has more rows than the page shows, says so above the summary (the cards are partial)', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/commissions?')) return Promise.resolve({ data: { data: ROWS, total: 250 } });
      return Promise.resolve({ data: { data: [], total: 0 } });
    });
    mount();
    expect(await screen.findByText(`แสดง ${ROWS.length} จาก 250 รายการ`)).toBeInTheDocument();
  });

  it('no partial note when every row of the month is shown', async () => {
    mount();
    await rowOf('กมล แสงทอง');
    expect(screen.queryByText(/^แสดง \d+ จาก/)).not.toBeInTheDocument();
  });

  it('new controls have at least a 36 px hit area (approve, payroll links)', async () => {
    mount();
    expect(within(await rowOf('กมล แสงทอง')).getByRole('button', { name: 'อนุมัติ' })).toHaveClass('min-h-9');
    for (const link of within(await rowOf('วิชัย ทองดี')).getAllByRole('link')) expect(link).toHaveClass('min-h-9');
  });
});

describe('CommissionsPage — audience (SALES cannot open หน้ารายจ่าย)', () => {
  it.each(['OWNER', 'FINANCE_MANAGER'])('%s sees the banner and the approver subtitle', async (role) => {
    auth.role = role;
    mount();
    await rowOf('กมล แสงทอง');
    expect(screen.getByText(BANNER_TITLE)).toBeInTheDocument();
    expect(screen.getByText(BANNER_BODY)).toBeInTheDocument();
    expect(screen.getByText('อนุมัติค่าคอมพนักงานขาย — จ่ายพร้อมใบเงินเดือนเท่านั้น')).toBeInTheDocument();
  });

  it('SALES: no banner, no approve, no payouts tab, and the payroll chips are plain text (no link to /expenses)', async () => {
    auth.role = 'SALES';
    mount();
    const row = await rowOf('CT-three');
    expect(screen.queryByText(BANNER_TITLE)).not.toBeInTheDocument();
    // P2-R30 — SALES อนุมัติไม่ได้ ⇒ คำบรรยายไม่พูดเรื่องอนุมัติ
    expect(screen.getByText('ค่าคอมของคุณ — จ่ายพร้อมใบเงินเดือน')).toBeInTheDocument();
    expect(screen.queryByText(/อนุมัติค่าคอม/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ใบจ่ายรายเดือน/ })).not.toBeInTheDocument();
    expect(within(row).getByText('อยู่ในใบเงินเดือน PR-20261031-0001 · ลงบัญชีแล้ว')).toBeInTheDocument();
    expect(within(row).getByText('หักคืนในใบ PR-20261130-0001')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
