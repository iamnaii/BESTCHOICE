import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';

// DossierCards.tsx imports `Group` from `./RoomDossier`, which pulls in a large chunk of the
// app (api client, AuthContext, Customer360Panel, TodoForm, etc.) — mock the module so loading
// DeviceWarrantyCard in isolation doesn't drag all of that in. `Group` itself is only used by
// PaymentsTimeline/CallLogList (not rendered by this test file) — a passthrough is enough.
vi.mock('./RoomDossier', () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// สิทธิ์เปิดปุ่ม "แจ้งปัญหาเครื่อง" อ่านจาก useAuth (mirror ของ /after-sales/new roles) —
// ค่าเริ่มต้นเป็น SALES (มีปุ่ม), เทส FINANCE_MANAGER สลับเป็นค่าอื่นแทนการ mock ซ้ำ
// (pattern เดียวกับ RoomDossier.test.tsx authRole)
const authRole = { role: 'SALES' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1', role: authRole.role } }) }));

beforeEach(() => {
  authRole.role = 'SALES';
});

import { DeviceWarrantyCard, type SummaryContract } from './DossierCards';

function Probe() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

const contract: SummaryContract = {
  id: 'ct-1',
  contractNumber: 'CT-2026-0912',
  status: 'ACTIVE',
  product: { brand: 'Apple', model: 'iPhone 13', serialNumber: null, warrantyExpireDate: null },
  serialNumber: '356812345674412',
  paidInstallments: 1,
  totalInstallments: 12,
  monthlyPayment: 1500,
  shopWarrantyEndDate: null,
};

describe('DeviceWarrantyCard — ปุ่มแจ้งปัญหาเครื่อง', () => {
  it('ไปหน้าแจ้งปัญหาเครื่องพร้อม IMEI (เดิมชี้ /repair-tickets ที่ไม่มีหน้า)', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route path="/inbox" element={<DeviceWarrantyCard contract={contract} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /แจ้งปัญหาเครื่อง/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/after-sales/new?imei=356812345674412');
  });

  it('ไม่มี IMEI → ไปหน้าแจ้งปัญหาเครื่องแบบค้นหาเอง', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route
            path="/inbox"
            element={<DeviceWarrantyCard contract={{ ...contract, serialNumber: null }} />}
          />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /แจ้งปัญหาเครื่อง/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/after-sales/new');
    expect(screen.getByTestId('where')).not.toHaveTextContent('imei=');
  });

  it('FINANCE_MANAGER (ไม่มีสิทธิ์เข้า /after-sales/new) → ไม่เห็นปุ่ม แต่ยังเห็น "ดูสัญญา"', () => {
    authRole.role = 'FINANCE_MANAGER';
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route path="/inbox" element={<DeviceWarrantyCard contract={contract} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /แจ้งปัญหาเครื่อง/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ดูสัญญา/ })).toBeInTheDocument();
  });
});
