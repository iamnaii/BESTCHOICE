import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useGfinTables } from '../useGfinTables';

describe('useGfinTables', () => {
  it('คืน `tables` อ้างอิงเดิมระหว่าง render (ข้อมูลไม่เปลี่ยน) — useMemo ฝั่งผู้ใช้จึงไม่คิดใหม่ทุกครั้งที่พิมพ์', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url === '/gfin-config/settings'
          ? { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15 } }
          : [],
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result, rerender } = renderHook(() => useGfinTables(true), { wrapper });
    await waitFor(() => expect(result.current.tables).toBeDefined());
    const first = result.current.tables;
    rerender();
    expect(result.current.tables).toBe(first);
  });
});
