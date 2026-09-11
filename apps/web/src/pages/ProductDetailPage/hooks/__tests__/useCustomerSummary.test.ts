import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useCustomerSummary } from '../useCustomerSummary';
import { PRODUCT_READINESS_QUERY_KEY } from '../useProductReadiness';
import { resolveQuotes } from '../../utils/resolveQuotes';
import { formatBaht } from '../../utils/buildCustomerSummary';

// golden config เดียวกับ buildCustomerSummary.test.ts (installmentPrice 19900 → 12 งวด/2,985/2,413.20)
const bcConfig = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function mockApi({ isReady }: { isReady: boolean }) {
  get.mockImplementation((url?: string) => {
    if (url === undefined || !url.includes('/')) {
      return Promise.reject(new Error(`unexpected call: ${String(url)}`));
    }
    if (url.includes('/interest-configs/resolved')) {
      return Promise.resolve({ data: bcConfig });
    }
    if (url.includes('/readiness')) {
      return Promise.resolve({
        data: { productId: 'p-1', isReady, isOnlineVisible: isReady, checks: [] },
      });
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('useCustomerSummary', () => {
  // braces จำเป็น — arrow ไม่มี braces จะ return ตัว mock (mockReset คืน instance)
  // แล้ว vitest ถือ return value ของ beforeEach เป็น cleanup fn → เรียก get() เปล่าๆ
  // หลังจบเทสต์ (ที่มาของ zero-arg call ที่เคยเข้าใจว่าเป็น react-query housekeeping)
  beforeEach(() => {
    get.mockReset();
  });

  it('อ่านราคาเส้นเดียวกับการ์ด — คอลัมน์ null แต่มีราคาใน prices[] ก็ยังได้บรรทัดผ่อน (fix C1)', async () => {
    mockApi({ isReady: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const product = {
      id: 'p-1',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      color: null,
      category: 'PHONE_USED',
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: null, // คอลัมน์ว่าง — ต้อง fallback ไป prices[]
      installmentPrice: null, // คอลัมน์ว่าง — ต้อง fallback ไป prices[]
      imeiSerial: null,
      branch: { name: 'ลาดพร้าว' },
      prices: [
        { label: 'ราคาเงินสด', amount: '15900', isDefault: true },
        { label: 'ราคาผ่อน BESTCHOICE', amount: '19900', isDefault: false },
      ],
    };

    const { result } = renderHook(() => useCustomerSummary(product), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.summaryText).toContain('เรทที่ 1'));
    expect(result.current.summaryText).toContain('ราคาเงินสด 15,900 บาท');
    expect(result.current.summaryText).toContain(
      'เรทที่ 1 ดาวน์ 2,985 บาท ผ่อนเดือนละ 2,413.20 บาท 12 งวด',
    );
  });

  it('ส่ง quotes จากเครื่องคำนวณ → ใช้ค่าที่เลือกอยู่ (เรทที่ 1 = BESTCHOICE · เรทที่ 2 = GFIN) และห้ามมีคำว่า GFIN', async () => {
    mockApi({ isReady: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const product = {
      id: 'p-4',
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      color: null,
      category: 'PHONE_NEW',
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: '19900',
      installmentPrice: '19900',
      imeiSerial: null,
      branch: { name: 'ลพบุรี' },
      prices: [],
    };
    const quotes = resolveQuotes({
      product,
      state: { fin: 'bc', bc: { months: 10, downAmount: 5000 }, gfin: { months: null, downPct: null, commissionPct: null } },
      bcConfig,
      gfinTables: {
        mappings: [
          { id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '23000', modelMatchPattern: 'iPhone 15', isActive: true },
        ],
        rules: [
          { id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, isActive: true },
        ],
        factors: [
          { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.179238', feePerInstallment: '100', isActive: true },
        ],
        settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
      },
    });

    const { result } = renderHook(() => useCustomerSummary(product, quotes), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.summaryText).toContain('เรทที่ 2'));
    const bcMonthly = quotes.bc!.quote.result.monthlyPayment.toNumber();
    expect(result.current.summaryText).toContain(
      `เรทที่ 1 ดาวน์ 5,000 บาท ผ่อนเดือนละ ${formatBaht(bcMonthly)} บาท 10 งวด`,
    );
    expect(result.current.summaryText).toContain('เรทที่ 2 ดาวน์ 1,900 บาท ผ่อนเดือนละ 3,327 บาท 12 งวด');
    expect(result.current.summaryText).not.toContain('GFIN');
  });

  it('isReady=false → ไม่มีบรรทัด "ดูรายละเอียด" ในสรุป แม้ปุ่มคัดลอกสรุปยังใช้ได้ (fix C2)', async () => {
    mockApi({ isReady: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const product = {
      id: 'p-2',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: null,
      color: null,
      category: 'PHONE_USED',
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: '15900',
      installmentPrice: null,
      imeiSerial: null,
      branch: { name: 'ลาดพร้าว' },
      prices: [],
    };

    const { result } = renderHook(() => useCustomerSummary(product), {
      wrapper: makeWrapper(client),
    });

    // รอให้ readiness query โหลดจริงเสร็จก่อน (ไม่ใช่แค่ default undefined ระหว่างโหลด — ต้อง
    // พิสูจน์ว่า isReady=false ที่ได้มาจากข้อมูลที่โหลดเสร็จแล้วจริงๆ ไม่ใช่ fallback ตอนกำลังโหลด)
    await waitFor(() =>
      expect(client.getQueryData(PRODUCT_READINESS_QUERY_KEY('p-2'))).toBeDefined(),
    );
    expect(result.current.summaryText).toContain('ราคาเงินสด 15,900 บาท');
    expect(result.current.summaryText).not.toContain('ดูรายละเอียด');
  });

  it('isReady=true → มีบรรทัดลิงก์ไปหน้าเว็บลูกค้า', async () => {
    mockApi({ isReady: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const product = {
      id: 'p-3',
      brand: 'Apple',
      model: 'iPhone 13',
      storage: null,
      color: null,
      category: 'PHONE_USED',
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: '15900',
      installmentPrice: null,
      imeiSerial: null,
      branch: { name: 'ลาดพร้าว' },
      prices: [],
    };

    const { result } = renderHook(() => useCustomerSummary(product), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() =>
      expect(result.current.summaryText).toContain(
        'ดูรายละเอียด: https://www.bestchoicephone.com/api/shop/share/p-3',
      ),
    );
  });
});
