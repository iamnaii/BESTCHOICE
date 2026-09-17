import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

const toastCalls: { success: string[]; error: string[] } = { success: [], error: [] };
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => {
      toastCalls.success.push(message);
    },
    error: (message: string) => {
      toastCalls.error.push(message);
    },
  },
}));

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'error'),
}));

import {
  skipTracingSuccessMessage,
  useUpdateCustomerContact,
  type UpdateCustomerContactResponse,
} from './useUpdateCustomerContact';

const base: UpdateCustomerContactResponse = {
  id: 'c1',
  phone: '0810000000',
  phoneSecondary: null,
  lineIdFinance: null,
  status: 'ACTIVE',
  phoneStoredAs: null,
  phoneOwner: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('skipTracingSuccessMessage', () => {
  it('เบอร์ของลูกค้าคนอื่น → บอกชื่อเจ้าของและว่าเก็บเป็นเบอร์สำรอง', () => {
    expect(
      skipTracingSuccessMessage(
        {
          ...base,
          phoneSecondary: '0820000000',
          phoneStoredAs: 'SECONDARY',
          phoneOwner: { id: 'c2', name: 'สมชาย ใจดี' },
        },
        { newPhone: '0820000000', reason: 'เบอร์ภรรยา' },
      ),
    ).toBe('เบอร์ 0820000000 เป็นของ สมชาย ใจดี — บันทึกเป็นเบอร์สำรองของลูกค้าคนนี้แทน');
  });

  it('เบอร์ของคนอื่น + LINE ID ใหม่ในครั้งเดียว → บอกด้วยว่าบันทึก LINE ID แล้ว', () => {
    expect(
      skipTracingSuccessMessage(
        {
          ...base,
          phoneSecondary: '0820000000',
          lineIdFinance: 'new-line',
          phoneStoredAs: 'SECONDARY',
          phoneOwner: { id: 'c2', name: 'สมชาย ใจดี' },
        },
        { newPhone: '0820000000', newLineId: 'new-line', reason: 'เบอร์ภรรยา' },
      ),
    ).toBe(
      'เบอร์ 0820000000 เป็นของ สมชาย ใจดี — บันทึกเป็นเบอร์สำรองของลูกค้าคนนี้แทน · บันทึก LINE ID ใหม่แล้ว',
    );
  });

  it('เป็นเบอร์หลักตามปกติ → ข้อความเดิม', () => {
    expect(
      skipTracingSuccessMessage(
        { ...base, phone: '0820000000', phoneStoredAs: 'PRIMARY' },
        { newPhone: '0820000000', reason: 'x' },
      ),
    ).toBe('อัปเดตข้อมูลติดต่อแล้ว');
  });

  it('ทำเครื่องหมายสูญหาย → ข้อความเดิม', () => {
    expect(skipTracingSuccessMessage(base, { markAsLost: true, reason: 'x' })).toBe(
      'ทำเครื่องหมาย "สูญหาย" แล้ว',
    );
  });

  it('API รุ่นเก่าที่ไม่ส่ง phoneStoredAs → ข้อความเดิม', () => {
    const legacy: UpdateCustomerContactResponse = { ...base };
    delete legacy.phoneStoredAs;
    delete legacy.phoneOwner;
    expect(skipTracingSuccessMessage(legacy, { newPhone: '0820000000', reason: 'x' })).toBe(
      'อัปเดตข้อมูลติดต่อแล้ว',
    );
  });
});

describe('useUpdateCustomerContact', () => {
  beforeEach(() => {
    toastCalls.success.length = 0;
    toastCalls.error.length = 0;
    apiPost.mockReset();
  });

  it('แสดง toast เบอร์สำรองจากคำตอบของ API', async () => {
    apiPost.mockResolvedValue({
      data: {
        ...base,
        phoneSecondary: '0820000000',
        phoneStoredAs: 'SECONDARY',
        phoneOwner: { id: 'c2', name: 'สมหญิง' },
      },
    });
    const { result } = renderHook(() => useUpdateCustomerContact(), { wrapper });
    await act(async () => {
      result.current.mutate({
        customerId: 'c1',
        payload: { newPhone: '0820000000', reason: 'เบอร์ภรรยา' },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/customers/c1/update-contact', {
      newPhone: '0820000000',
      reason: 'เบอร์ภรรยา',
    });
    expect(toastCalls.success).toEqual([
      'เบอร์ 0820000000 เป็นของ สมหญิง — บันทึกเป็นเบอร์สำรองของลูกค้าคนนี้แทน',
    ]);
  });
});
