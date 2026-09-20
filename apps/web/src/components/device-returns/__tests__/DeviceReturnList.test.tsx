/**
 * ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (spec 2026-09-20 §7):
 *   FINANCE (OWNER/FM) เห็น ยืนยัน / ส่งกลับ / ส่งซ้ำไลน์ · สาขา (BM) เห็นสถานะ + ยกเลิกใบสาขาตัวเอง ·
 *   SALES/ACC เห็นสถานะอย่างเดียว · ยืนยัน = ส่งแถวให้ parent เปิด overlay โหมดยืนยัน
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: Object.assign(actual.toast, {
      success: vi.fn(actual.toast.success),
      error: vi.fn(actual.toast.error),
    }),
  };
});

type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

import { DeviceReturnList } from '../DeviceReturnList';
import { toast, Toaster } from 'sonner';

const baseRow = {
  status: 'PENDING_CONFIRM',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: null,
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
};
const rows = [
  {
    ...baseRow,
    id: 'dr-1',
    docNumber: 'DR-20260919-0001',
    returnKind: 'VOLUNTARY',
    returnReason: 'UNAFFORDABLE',
    lineNotifyStatus: 'SENT',
    receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
    contract: {
      id: 'c-1',
      contractNumber: 'TEST-20260919-001',
      status: 'TERMINATED',
      customer: { id: 'cu1', name: 'สมชาย ใจดี' },
      product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: '350000000000001' },
    },
  },
  {
    ...baseRow,
    id: 'dr-2',
    docNumber: 'DR-20260919-0002',
    returnKind: 'REPOSSESSION',
    returnReason: 'AFTER_TERMINATION',
    lineNotifyStatus: 'FAILED',
    receivingBranch: { id: 'b2', name: 'รามอินทรา' },
    contract: {
      id: 'c-2',
      contractNumber: 'TEST-20260919-002',
      status: 'TERMINATED',
      customer: { id: 'cu2', name: 'สมหญิง รักดี' },
      product: { id: 'p2', brand: 'Samsung', model: 'S24', imeiSerial: null },
    },
  },
];

function routeApi(data: unknown[] = rows) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/device-returns?status=PENDING_CONFIRM&limit=100') {
      return Promise.resolve({ data: { data, total: data.length, page: 1, limit: 100 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const rowOf = (docNumber: string) => screen.getByTestId(`device-return-row-${docNumber}`);

beforeEach(() => {
  toast.dismiss();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  currentUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  apiGet.mockReset();
  apiPost.mockReset().mockImplementation((url: string) => {
    const row = rows.find((item) => url.includes(`/${item.id}/`))!;
    return Promise.resolve({
      data: {
        ...row,
        contract: {
          ...row.contract,
          status: row.returnKind === 'VOLUNTARY' ? 'ACTIVE' : 'TERMINATED',
        },
        notice: null,
        status: url.endsWith('/cancel')
          ? 'CANCELED'
          : url.endsWith('/reject')
            ? 'REJECTED'
            : row.status,
        lineNotifyStatus: 'SENT',
      },
    });
  });
});

describe('DeviceReturnList — สิทธิ์ต่อบทบาท', () => {
  it('OWNER: ยืนยัน/ส่งกลับ/ยกเลิก ทุกแถว, ส่งซ้ำไลน์เฉพาะแถวที่ไลน์ไม่ SENT', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    const r2 = within(rowOf('DR-20260919-0002'));
    expect(r1.getByRole('button', { name: 'ยืนยัน' })).toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ส่งกลับ' })).toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
    expect(r1.queryByRole('button', { name: /ส่งซ้ำไลน์/ })).not.toBeInTheDocument();
    expect(r2.getByRole('button', { name: /ส่งซ้ำไลน์/ })).toBeInTheDocument();
    expect(r1.getByText('ส่งไลน์แล้ว')).toBeInTheDocument();
    expect(r2.getByText('ส่งไลน์ไม่สำเร็จ')).toBeInTheDocument();
    expect(r1.getByText('ลูกค้าคืนเอง')).toBeInTheDocument();
    expect(r2.getByText('ยึดเครื่อง')).toBeInTheDocument();
    expect(r1.getByText('7,000.00 ฿')).toBeInTheDocument();
  });

  it('FINANCE_MANAGER: ยืนยัน/ส่งกลับ แต่ไม่มียกเลิก', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    expect(r1.getByRole('button', { name: 'ยืนยัน' })).toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ส่งกลับ' })).toBeInTheDocument();
    expect(r1.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
    expect(
      within(rowOf('DR-20260919-0002')).getByRole('button', { name: /ส่งซ้ำไลน์/ }),
    ).toBeInTheDocument();
  });

  it('BRANCH_MANAGER สาขา b1: ไม่มียืนยัน; ยกเลิกเฉพาะใบสาขาตัวเอง; ส่งซ้ำไลน์ได้', async () => {
    currentUser = { id: 'u-bm', name: 'ผจก.ลาดพร้าว', role: 'BRANCH_MANAGER', branchId: 'b1' };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    const r1 = within(rowOf('DR-20260919-0001'));
    const r2 = within(rowOf('DR-20260919-0002'));
    expect(r1.queryByRole('button', { name: 'ยืนยัน' })).not.toBeInTheDocument();
    expect(r1.queryByRole('button', { name: 'ส่งกลับ' })).not.toBeInTheDocument();
    expect(r1.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument();
    expect(r2.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
    expect(r2.getByRole('button', { name: /ส่งซ้ำไลน์/ })).toBeInTheDocument();
  });

  it.each(['SALES', 'ACCOUNTANT', 'UNKNOWN'])('%s: สถานะอย่างเดียว ไม่มีปุ่ม', async (role) => {
    currentUser = { id: 'u-s', name: 'พนักงาน', role, branchId: 'b1' };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ว่าง → ข้อความว่างและจำนวน 0 ใบ', async () => {
    routeApi([]);
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    expect(await screen.findByText('ไม่มีใบรับเครื่องคืนที่รอยืนยัน')).toBeInTheDocument();
    expect(screen.getByText('0 ใบ')).toBeInTheDocument();
  });
});

describe('DeviceReturnList — query and mutation lifecycle', () => {
  it('renders the server cross-month cancellation notice after closing the dialog', async () => {
    const notice = 'ใบนี้ข้ามเดือน — ให้ OWNER เปิดงวดใหม่ผ่าน PERIOD_REOPENED ก่อน';
    apiPost.mockResolvedValueOnce({
      data: {
        ...rows[0],
        status: 'CANCELED',
        contract: { ...rows[0].contract, status: 'ACTIVE' },
        notice,
      },
    });
    routeApi();
    render(
      <>
        <DeviceReturnList onConfirm={() => {}} />
        <Toaster />
      </>,
      { wrapper },
    );
    await screen.findByText(rows[0].docNumber);
    fireEvent.click(within(rowOf(rows[0].docNumber)).getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    expect(await screen.findByText(notice)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not promise restoration when cancellation returns an independently closed contract', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        ...rows[0],
        status: 'CANCELED',
        contract: { ...rows[0].contract, status: 'COMPLETED' },
        notice: null,
      },
    });
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[0].docNumber);
    fireEvent.click(within(rowOf(rows[0].docNumber)).getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(`ยกเลิกใบ ${rows[0].docNumber} แล้ว`, {
        description: undefined,
      }),
    );
  });

  it('shows loading, query error, and retries the exact pending query', async () => {
    let fail!: (error: Error) => void;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
    await act(async () => fail(new Error('โหลดไม่สำเร็จ')));
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่สามารถโหลดใบรับเครื่องคืนได้');
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText(rows[0].docNumber);
    expect(apiGet).toHaveBeenLastCalledWith('/device-returns?status=PENDING_CONFIRM&limit=100');
  });

  it.each([null, 'NO_LINE'])('allows resend for %s and renders its status', async (status) => {
    routeApi([{ ...rows[0], lineNotifyStatus: status }]);
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(status === null ? 'ยังไม่ส่ง' : 'ไม่มีไลน์ผูก');
    fireEvent.click(screen.getByRole('button', { name: /ส่งซ้ำไลน์/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/resend-line'));
  });

  it('BM without a branch cannot cancel any row', async () => {
    currentUser = { ...currentUser, role: 'BRANCH_MANAGER', branchId: null };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[0].docNumber);
    expect(screen.queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();
  });

  it('dismisses cancel without a POST and explains repossession cancellation', async () => {
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[1].docNumber);
    fireEvent.click(within(rowOf(rows[1].docNumber)).getByRole('button', { name: 'ยกเลิก' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('สัญญายังบอกเลิกอยู่ตามเดิม');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps cancel open while pending, prevents duplicate requests, then refreshes dependent caches', async () => {
    let finish!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    routeApi();
    const invalidation = vi.spyOn(qc, 'invalidateQueries');
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[0].docNumber);
    fireEvent.click(within(rowOf(rows[0].docNumber)).getByRole('button', { name: 'ยกเลิก' }));
    const submit = screen.getByRole('button', { name: 'ยืนยันยกเลิกใบ' });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'กำลังดำเนินการ...' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    routeApi([rows[1]]);
    await act(async () =>
      finish({
        data: {
          ...rows[0],
          status: 'CANCELED',
          contract: { ...rows[0].contract, status: 'ACTIVE' },
          notice: null,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(rows[0].docNumber)).not.toBeInTheDocument());
    for (const queryKey of [
      ['device-returns'],
      ['contracts'],
      ['contract', 'c-1'],
      ['customer-tags'],
    ]) {
      expect(invalidation).toHaveBeenCalledWith({ queryKey });
    }
    expect(toast.success).toHaveBeenCalledWith(
      `ยกเลิกใบ ${rows[0].docNumber} แล้ว`,
      expect.anything(),
    );
  });

  it('retains cancel target on failure and permits retry', async () => {
    apiPost.mockRejectedValueOnce(new Error('ยกเลิกไม่สำเร็จ'));
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[0].docNumber);
    fireEvent.click(within(rowOf(rows[0].docNumber)).getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: ยกเลิกไม่สำเร็จ'));
    expect(screen.getByRole('dialog')).toHaveTextContent(rows[0].docNumber);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('disables resend during the request and refreshes the delivered status', async () => {
    let finish!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[1].docNumber);
    const submit = screen.getByRole('button', { name: /ส่งซ้ำไลน์/ });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit).toBeDisabled());
    routeApi([rows[0], { ...rows[1], lineNotifyStatus: 'SENT' }]);
    await act(async () => finish({ data: { ...rows[1], lineNotifyStatus: 'SENT' } }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /ส่งซ้ำไลน์/ })).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledWith('ส่งไลน์แจ้งลูกค้าอีกครั้งแล้ว');
  });

  it('reports resend failure and leaves it available for retry', async () => {
    apiPost.mockRejectedValueOnce(new Error('ส่งไม่สำเร็จ'));
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText(rows[1].docNumber);
    fireEvent.click(screen.getByRole('button', { name: /ส่งซ้ำไลน์/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: ส่งไม่สำเร็จ'));
    expect(screen.getByRole('button', { name: /ส่งซ้ำไลน์/ })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('DeviceReturnList — การกระทำ', () => {
  it.each(['OWNER', 'FINANCE_MANAGER'])('%s ยืนยัน → onConfirm(row)', async (role) => {
    currentUser = { ...currentUser, role };
    const onConfirm = vi.fn();
    routeApi();
    render(<DeviceReturnList onConfirm={onConfirm} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    fireEvent.click(within(rowOf('DR-20260919-0001')).getByRole('button', { name: 'ยืนยัน' }));
    expect(onConfirm).toHaveBeenCalledWith(rows[0]);
  });

  it.each(['OWNER', 'BRANCH_MANAGER'])('%s ยกเลิก → ConfirmDialog → POST cancel', async (role) => {
    currentUser = { ...currentUser, role, branchId: 'b1' };
    routeApi();
    render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
    await screen.findByText('DR-20260919-0001');
    fireEvent.click(within(rowOf('DR-20260919-0001')).getByRole('button', { name: 'ยกเลิก' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/DR-20260919-0001/);
    expect(dialog).toHaveTextContent(/สัญญาจะกลับไปสถานะเดิม/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันยกเลิกใบ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/cancel'));
  });

  it.each(['OWNER', 'FINANCE_MANAGER'])(
    '%s ส่งกลับ → RejectDeviceReturnDialog → POST reject',
    async (role) => {
      currentUser = { ...currentUser, role };
      routeApi();
      render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
      await screen.findByText('DR-20260919-0002');
      fireEvent.click(within(rowOf('DR-20260919-0002')).getByRole('button', { name: 'ส่งกลับ' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ส่งกลับ/), {
        target: { value: 'ราคาประเมินสูงเกินสภาพจริง' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันส่งกลับ' }));
      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-2/reject', {
          reason: 'ราคาประเมินสูงเกินสภาพจริง',
        }),
      );
    },
  );

  it.each(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'])(
    '%s ส่งซ้ำไลน์ → POST resend-line',
    async (role) => {
      currentUser = { ...currentUser, role, branchId: 'b1' };
      routeApi();
      render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
      await screen.findByText('DR-20260919-0002');
      fireEvent.click(
        within(rowOf('DR-20260919-0002')).getByRole('button', { name: /ส่งซ้ำไลน์/ }),
      );
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-2/resend-line'));
    },
  );

  it.each(['FAILED', 'NO_LINE'])(
    'does not report LINE delivery for HTTP 200 with %s',
    async (lineNotifyStatus) => {
      routeApi();
      apiPost.mockResolvedValueOnce({ data: { ...rows[1], lineNotifyStatus } });
      render(<DeviceReturnList onConfirm={() => {}} />, { wrapper });
      await screen.findByText(rows[1].docNumber);
      fireEvent.click(screen.getByRole('button', { name: /ส่งซ้ำไลน์/ }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          lineNotifyStatus === 'FAILED' ? 'ส่งไลน์ไม่สำเร็จ' : 'ไม่มีไลน์ผูก',
        ),
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(apiGet).toHaveBeenCalledTimes(2);
    },
  );
});
