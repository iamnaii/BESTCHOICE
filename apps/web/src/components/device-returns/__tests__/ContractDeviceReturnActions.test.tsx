/**
 * ป้าย/ปุ่มใบรับเครื่องคืนบนหน้าสัญญา (spec 2026-09-20 §7 แถว ContractDetailPage)
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('../DeviceReturnIntakeDialog', () => ({
  DeviceReturnIntakeDialog: (p: { open: boolean; initialContractId?: string }) =>
    p.open ? <div data-testid="intake-dialog">intake:{p.initialContractId}</div> : null,
}));
vi.mock('@/pages/PaymentsPage/components/RepossessionOverlay', () => ({
  RepossessionOverlay: (p: { deviceReturnId: string; contractNumber: string; branchName: string }) => (
    <div data-testid="repo-overlay">
      overlay:{p.deviceReturnId}:{p.contractNumber}:{p.branchName}
    </div>
  ),
}));

import { ContractDeviceReturnActions } from '../ContractDeviceReturnActions';

const pendingRow = {
  id: 'dr-1',
  docNumber: 'DR-20260920-0007',
  status: 'PENDING_CONFIRM',
  receivingBranch: { id: 'b1', name: 'ลพบุรี' },
  contract: { id: 'c-1', contractNumber: 'TEST-1', customer: { id: 'cu1', name: 'สมชาย' } },
};

function routeApi(pending: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/device-returns?contractId=c-1&status=PENDING_CONFIRM&limit=1') {
      return Promise.resolve({ data: { data: pending, total: pending.length, page: 1, limit: 1 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('ContractDeviceReturnActions', () => {
  it('มีใบ PENDING_CONFIRM → ป้ายพร้อมเลขที่ใบ ไม่มีปุ่ม', async () => {
    routeApi([pendingRow]);
    render(
      <ContractDeviceReturnActions contractId="c-1" contractStatus="TERMINATED" role="OWNER" />,
      {
        wrapper,
      },
    );
    expect(
      await screen.findByText(/รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-20260920-0007/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
  });

  // คำสั่งเจ้าของ 2026-09-23: "คนอื่นคำนวณได้ แต่ผู้จัดการอนุมัติทีหลัง" — ทุก role
  // (รวม SALES ที่ไม่มีทางไปหน้า /repossessions) เปิดตัวเลขยอดปิดจากหน้าสัญญาได้
  it.each(['SALES', 'ACCOUNTANT', 'BRANCH_MANAGER', 'OWNER'])(
    '%s + มีใบ PENDING_CONFIRM → ปุ่ม ดูยอดปิด เปิด overlay ของใบนั้น',
    async (role) => {
      routeApi([pendingRow]);
      render(
        <ContractDeviceReturnActions contractId="c-1" contractStatus="TERMINATED" role={role} />,
        { wrapper },
      );
      fireEvent.click(await screen.findByRole('button', { name: 'ดูยอดปิด' }));
      expect(screen.getByTestId('repo-overlay')).toHaveTextContent('overlay:dr-1:TEST-1:ลพบุรี');
    },
  );

  it.each([
    ['OWNER', 'ACTIVE'],
    ['BRANCH_MANAGER', 'OVERDUE'],
    ['SALES', 'TERMINATED'],
  ])('%s + %s ไม่มีใบ → ปุ่ม รับเครื่องคืน เปิด intake dialog ล็อกสัญญา', async (role, status) => {
    routeApi([]);
    render(<ContractDeviceReturnActions contractId="c-1" contractStatus={status} role={role} />, {
      wrapper,
    });
    const button = await screen.findByRole('button', { name: 'รับเครื่องคืน' });
    fireEvent.click(button);
    expect(screen.getByTestId('intake-dialog')).toHaveTextContent('intake:c-1');
  });

  it.each(['FINANCE_MANAGER', 'ACCOUNTANT'])(
    '%s ไม่มีปุ่ม (POST /device-returns roles) แม้สถานะเข้าเกณฑ์',
    async (role) => {
      routeApi([]);
      render(<ContractDeviceReturnActions contractId="c-1" contractStatus="ACTIVE" role={role} />, {
        wrapper,
      });
      await waitFor(() => expect(apiGet).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
    },
  );

  it('ซ่อนปุ่มรับเครื่องคืนระหว่างตรวจสอบใบค้างยืนยัน', async () => {
    apiGet.mockImplementation(() => new Promise(() => undefined));
    render(<ContractDeviceReturnActions contractId="c-1" contractStatus="ACTIVE" role="SALES" />, {
      wrapper,
    });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังตรวจสอบใบรับเครื่องคืน');
  });

  it('ตรวจสอบไม่สำเร็จ → ซ่อนปุ่มและลองใหม่จนพบใบค้างยืนยัน', async () => {
    apiGet.mockRejectedValueOnce(new Error('network unavailable'));
    apiGet.mockResolvedValue({ data: { data: [pendingRow], total: 1, page: 1, limit: 1 } });
    render(<ContractDeviceReturnActions contractId="c-1" contractStatus="ACTIVE" role="OWNER" />, {
      wrapper,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ไม่สามารถตรวจสอบใบรับเครื่องคืนได้',
    );
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(
      await screen.findByText(/รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-20260920-0007/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รับเครื่องคืน' })).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('สถานะที่รับคืนไม่ได้ (COMPLETED) → ไม่ render และไม่ยิง API', () => {
    routeApi([]);
    const { container } = render(
      <ContractDeviceReturnActions contractId="c-1" contractStatus="COMPLETED" role="OWNER" />,
      { wrapper },
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
