import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOcrFlow } from './useOcrFlow';
import type { OcrResult } from '../types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch },
  getErrorMessage: () => 'error',
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: vi.fn() },
}));
vi.mock('@/lib/cardReader', () => ({ checkCardReaderStatus: vi.fn(), readSmartCard: vi.fn() }));
vi.mock('@/lib/compressImage', () => ({ compressImageForOcr: vi.fn() }));

const ocr: OcrResult = {
  nationalId: '1101700230705',
  nationalIdValid: true,
  prefix: 'นาย',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  fullName: 'สมชาย ใจดี',
  birthDate: null,
  address: null,
  addressStructured: null,
  issueDate: null,
  expiryDate: null,
  confidence: 1,
};

const existing = { id: 'cust-old', name: 'สมศรี มีสุข', createdAt: '2026-09-03T03:00:00.000Z', activeContracts: 1 };

/** 409 ของ POST /customers — `field` ไม่ส่ง = API ก่อน R44 */
function conflict(field?: 'phone' | 'email' | 'nationalId') {
  return Object.assign(new Error('Conflict'), {
    response: {
      status: 409,
      data: { message: 'ซ้ำ', existingCustomer: existing, ...(field ? { field } : {}) },
    },
  });
}

function mountWithOpenPanel() {
  const setSelectedCustomer = vi.fn();
  const hook = renderHook(() =>
    useOcrFlow({ setSelectedCustomer, setCustForm: vi.fn(), setCustAddrIdCard: vi.fn() }),
  );
  act(() => {
    hook.result.current.setOcrResult(ocr);
    hook.result.current.setShowOcrPanel(true);
    hook.result.current.setShowCreateCustomer(true);
    hook.result.current.setNewCustomerPhone(' 0812345678 ');
  });
  return { ...hook, setSelectedCustomer };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ data: { id: existing.id, name: existing.name, phone: '0899999999' } });
});

describe('useOcrFlow — createCustomerFromOcr เจอ 409', () => {
  it.each([
    ['phone', 'phone' as const],
    ['ไม่ส่ง field (API เก่า) = ถือเป็นเบอร์', undefined],
  ])('ชนเบอร์ (%s) → ไม่เลือกคนเดิมให้ แผงสร้างเปิดค้างให้แก้เบอร์', async (_label, field) => {
    mocks.post.mockRejectedValueOnce(conflict(field));
    const { result, setSelectedCustomer } = mountWithOpenPanel();
    setSelectedCustomer.mockClear();

    await act(() => result.current.createCustomerFromOcr());

    expect(mocks.post).toHaveBeenCalledWith('/customers', expect.objectContaining({ phone: '0812345678' }));
    // คนละคนก็ใช้เบอร์เดียวกันได้ ⇒ ห้ามดึง/เลือกคนเดิมอัตโนมัติ (Step 4 จะเขียนข้อมูลบัตรทับเขา)
    expect(mocks.get).not.toHaveBeenCalled();
    expect(setSelectedCustomer).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'เบอร์ 0812345678 เป็นของลูกค้าเดิม (สมศรี มีสุข) — ถ้าเป็นคนเดียวกันให้ค้นหาชื่อนี้แล้วเลือก ถ้าไม่ใช่ให้แก้เบอร์',
    );
    expect(result.current.showCreateCustomer).toBe(true);
    expect(result.current.showOcrPanel).toBe(true);
    expect(result.current.newCustomerPhone).toBe(' 0812345678 ');
    expect(result.current.creatingCustomer).toBe(false);
  });

  it('ชนอีเมล → ไม่เลือกคนเดิมให้เช่นกัน และไม่บอกว่าเป็นเบอร์', async () => {
    mocks.post.mockRejectedValueOnce(conflict('email'));
    const { result, setSelectedCustomer } = mountWithOpenPanel();
    setSelectedCustomer.mockClear();

    await act(() => result.current.createCustomerFromOcr());

    expect(mocks.get).not.toHaveBeenCalled();
    expect(setSelectedCustomer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'อีเมลนี้เป็นของลูกค้าเดิม (สมศรี มีสุข) — ถ้าเป็นคนเดียวกันให้ค้นหาชื่อนี้แล้วเลือก',
    );
    expect(result.current.showCreateCustomer).toBe(true);
    expect(result.current.showOcrPanel).toBe(true);
  });

  it('ชนเลขบัตร → บัตรเดียวกัน = คนเดียวกัน เลือกคนเดิมให้อัตโนมัติเหมือนเดิม', async () => {
    mocks.post.mockRejectedValueOnce(conflict('nationalId'));
    const { result, setSelectedCustomer } = mountWithOpenPanel();
    setSelectedCustomer.mockClear();

    await act(() => result.current.createCustomerFromOcr());

    expect(mocks.get).toHaveBeenCalledWith(`/customers/${existing.id}`);
    expect(setSelectedCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing.id, name: existing.name }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'บัตรนี้เป็นของลูกค้าเดิม: สมศรี มีสุข — เลือกให้อัตโนมัติ',
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(result.current.showCreateCustomer).toBe(false);
    expect(result.current.showOcrPanel).toBe(false);
    expect(result.current.newCustomerPhone).toBe('');
  });

  it('409 ที่ไม่มี existingCustomer (เช่น เลขบัตรไม่ถูกต้อง) → แสดงข้อความจาก API ตามเดิม', async () => {
    mocks.post.mockRejectedValueOnce(
      Object.assign(new Error('Conflict'), { response: { status: 409, data: { message: 'เลขบัตรประชาชนไม่ถูกต้อง' } } }),
    );
    const { result, setSelectedCustomer } = mountWithOpenPanel();
    setSelectedCustomer.mockClear();

    await act(() => result.current.createCustomerFromOcr());

    expect(mocks.get).not.toHaveBeenCalled();
    expect(setSelectedCustomer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('error');
    expect(result.current.showCreateCustomer).toBe(true);
  });
});
