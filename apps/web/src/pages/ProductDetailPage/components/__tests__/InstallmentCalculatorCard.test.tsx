import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// Mutable auth role (vi.mock factory is hoisted — reference via vi.hoisted holder,
// same pattern as LateFeeSettingsCard.test.tsx / other RBAC component tests in this repo).
const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: authState.role } }),
}));

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

import { InstallmentCalculatorCard } from '../InstallmentCalculatorCard';

// golden config เดียวกับ BcCalculatorCard.test.tsx / useCustomerSummary.test.ts
const bcConfig = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

function mockApiGet(url?: string) {
  if (url === undefined) return Promise.reject(new Error('unexpected call: undefined'));
  if (url.includes('/interest-configs/resolved')) return Promise.resolve({ data: bcConfig });
  // GfinCalculatorCard renders alongside — feed it empty tables so it settles on the
  // "รุ่นนี้ไม่อยู่ในตาราง GFIN" branch instead of hanging; this test doesn't assert on it.
  if (url.includes('/gfin-config/')) return Promise.resolve({ data: [] });
  return Promise.reject(new Error(`unexpected url: ${url}`));
}

const productWithInstallment = {
  id: 'p1',
  category: 'PHONE_USED',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  cashPrice: '15900',
  installmentPrice: '19900',
  prices: [],
};

const productWithoutInstallment = {
  id: 'p2',
  category: 'PHONE_USED',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  cashPrice: null,
  installmentPrice: null,
  prices: [],
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(BrowserRouter, null, ui),
    ),
  );
}

describe('InstallmentCalculatorCard', () => {
  // braces จำเป็นเสมอ — arrow ไม่มี braces จะ return ค่าของ mockImplementation แล้ว vitest
  // ถือเป็น cleanup fn (บั๊กเดียวกับที่แก้ไปแล้วใน useCustomerSummary.test.ts อีก 2 ไฟล์)
  beforeEach(() => {
    authState.role = 'OWNER';
    apiGet.mockReset();
    apiGet.mockImplementation(mockApiGet);
  });

  describe('[I1a] canCreateContract gating — OWNER/BRANCH_MANAGER/SALES ทำสัญญาได้, FINANCE_MANAGER/ACCOUNTANT ไม่ได้', () => {
    it.each(['OWNER', 'BRANCH_MANAGER', 'SALES'])(
      'role=%s → เห็นปุ่ม "ใช้ราคานี้ทำสัญญา"',
      async (role) => {
        authState.role = role;
        wrap(
          <InstallmentCalculatorCard
            product={productWithInstallment}
            onEditPrice={() => {}}
            canEditPrice={false}
          />,
        );
        expect(
          await screen.findByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' }),
        ).toBeInTheDocument();
      },
    );

    // mutation "เพิ่ม FINANCE_MANAGER เข้า list ทำสัญญา" ต้องทำให้เคสนี้ตก — พิสูจน์ว่าสูตร
    // canCreateContract ไม่ใช่แค่ "role ใดก็ได้ที่ไม่ใช่ undefined"
    it.each(['FINANCE_MANAGER', 'ACCOUNTANT'])(
      'role=%s → ไม่เห็นปุ่ม "ใช้ราคานี้ทำสัญญา"',
      async (role) => {
        authState.role = role;
        wrap(
          <InstallmentCalculatorCard
            product={productWithInstallment}
            onEditPrice={() => {}}
            canEditPrice={false}
          />,
        );
        // รอให้การ์ดโหลดเสร็จก่อน (เห็นหัวข้อ) — กัน false-negative จาก "query ยังค้างอยู่
        // เลยยังไม่ render อะไรเลย" ไม่ใช่ปุ่มถูกซ่อนจริงตามสิทธิ์
        expect(await screen.findByText('เครื่องคำนวณค่างวด')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' })).toBeNull();
      },
    );
  });

  describe('[I1b] canEditPrice / onEditPrice — เครื่องที่ยังไม่ได้กำหนดราคาเงินผ่อน', () => {
    it('canEditPrice=true → เห็นปุ่ม "ไปแก้ราคา" และคลิกแล้ว onEditPrice ถูกเรียก', async () => {
      const onEditPrice = vi.fn();
      wrap(
        <InstallmentCalculatorCard
          product={productWithoutInstallment}
          onEditPrice={onEditPrice}
          canEditPrice
        />,
      );
      const btn = await screen.findByRole('button', { name: 'ไปแก้ราคา' });
      await userEvent.click(btn);
      expect(onEditPrice).toHaveBeenCalledTimes(1);
    });

    it('canEditPrice=false → ไม่เห็นปุ่ม "ไปแก้ราคา" แต่เห็นข้อความแจ้งผู้จัดการแทน', async () => {
      wrap(
        <InstallmentCalculatorCard
          product={productWithoutInstallment}
          onEditPrice={() => {}}
          canEditPrice={false}
        />,
      );
      expect(await screen.findByText(/แจ้งผู้จัดการให้กำหนดราคา/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ไปแก้ราคา' })).toBeNull();
    });
  });
});
