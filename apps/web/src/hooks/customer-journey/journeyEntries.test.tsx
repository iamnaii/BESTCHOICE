import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { JourneyEntryCreatedResponse, JourneyEntryDeletedResponse } from '@installment/shared';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import {
  JOURNEY_UNDO_TOAST_MS,
  deleteJourneyEntry,
  postHeardFrom,
  undoToastOptions,
  useDeleteJourneyEntry,
  useRecordJourneyEntry,
} from './journeyEntries';

/**
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 promise ที่ต้อง reject ใช้ mockImplementation(() => Promise.reject(...)) ไม่ใช้ mockRejectedValue
 */
const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn(), uidSeq: 0 }));

vi.mock('@/lib/api', () => ({
  default: { post: mocks.post, delete: mocks.del },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'ผิดพลาด'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/uid', () => ({ uid: () => `uuid-${++mocks.uidSeq}` }));

const SUMMARY_KEY = ['customer-journey-summary', 'c1'];
/** key ของแท็บ (groups = null) — อยู่ใต้ prefix ['customer-journey', 'c1'] เดียวกับการ์ดกิจกรรมล่าสุด */
const LIST_KEY = ['customer-journey', 'c1', null];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(SUMMARY_KEY, journeySummary({ stage: 'IDENTIFIED' }));
  qc.setQueryData(LIST_KEY, { pages: [], pageParams: [] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.del.mockReset();
  mocks.uidSeq = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('useRecordJourneyEntry', () => {
  it('POST → ตั้ง summary จากคำตอบ + ทำให้รายการไทม์ไลน์ค้าง (ไม่สั่ง summary โหลดซ้ำ) · hook ไม่ toast เอง', async () => {
    const { qc, wrapper } = setup();
    const fresh = journeySummary({ stage: 'INTERESTED' });
    const response: JourneyEntryCreatedResponse = { entryId: 'e1', event: null, summary: fresh };
    mocks.post.mockImplementation(async () => ({ data: response }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: 'req-1' });
    });

    expect(mocks.post).toHaveBeenCalledWith('/customers/c1/journey/entries', {
      kind: 'TOUCHPOINT',
      channel: 'PHONE',
      outcome: 'APPOINTED',
      clientRequestId: 'req-1',
    });
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-journey', 'c1'] });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('คอมโพเนนต์ถูกถอด (Radix TabsContent สลับแท็บ) ระหว่างรอคำตอบ ก็ยังอัปเดตแคช', async () => {
    const { qc, wrapper } = setup();
    const fresh = journeySummary({ stage: 'CONTACTED', lost: null });
    const pending = deferred<{ data: JourneyEntryCreatedResponse }>();
    mocks.post.mockImplementation(() => pending.promise);
    const { result, unmount } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    act(() => {
      result.current.mutate({ kind: 'REOPENED', clientRequestId: 'req-2' });
    });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    unmount();
    pending.resolve({ data: { entryId: 'e2', event: null, summary: fresh } });

    await waitFor(() => expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh));
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
  });

  it('POST ล้ม → mutateAsync โยนต่อ (ผู้เรียกเปิดตัวเลือกค้าง + toast.error เอง) · แคชไม่ขยับ', async () => {
    const { qc, wrapper } = setup();
    const before = qc.getQueryData(SUMMARY_KEY);
    mocks.post.mockImplementation(() => Promise.reject(new Error('กรุณาเลือกผลการติดต่อ')));
    const { result } = renderHook(() => useRecordJourneyEntry('c1'), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: 'req-3' }),
      ).rejects.toThrow('กรุณาเลือกผลการติดต่อ');
    });

    expect(qc.getQueryData(SUMMARY_KEY)).toBe(before);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('deleteJourneyEntry', () => {
  it('ปุ่ม "เลิกทำ" ใน toast ทำงานได้หลังคอมโพเนนต์ที่สร้างมันถูกถอดแล้ว: DELETE → summary + รายการ + toast', async () => {
    const { qc, wrapper } = setup();
    const { result, unmount } = renderHook(() => useQueryClient(), { wrapper });
    const client = result.current;
    const undo = () => deleteJourneyEntry(client, 'c1', 'e1');
    unmount();

    const fresh = journeySummary({ stage: 'CONTACTED' });
    const response: JourneyEntryDeletedResponse = { summary: fresh };
    mocks.del.mockImplementation(async () => ({ data: response }));

    await undo();

    expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e1');
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(fresh);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('DELETE ล้ม → toast.error ด้วยข้อความจาก API · ไม่โยนต่อ · แคชไม่ขยับ', async () => {
    const { qc } = setup();
    const before = qc.getQueryData(SUMMARY_KEY);
    mocks.del.mockImplementation(() => Promise.reject(new Error('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง')));

    await expect(deleteJourneyEntry(qc, 'c1', 'e1')).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith('ลบได้เฉพาะรายการของตัวเองภายใน 24 ชั่วโมง');
    expect(toast.success).not.toHaveBeenCalled();
    expect(qc.getQueryData(SUMMARY_KEY)).toBe(before);
    expect(qc.getQueryState(LIST_KEY)?.isInvalidated).toBe(false);
  });
});

describe('useDeleteJourneyEntry', () => {
  it('isPending + variables = entryId ระหว่างรอ แล้วจบด้วย toast เดียวกับ deleteJourneyEntry', async () => {
    const { wrapper } = setup();
    const pending = deferred<{ data: JourneyEntryDeletedResponse }>();
    mocks.del.mockImplementation(() => pending.promise);
    const { result } = renderHook(() => useDeleteJourneyEntry('c1'), { wrapper });

    act(() => {
      result.current.mutate('e9');
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.variables).toBe('e9');
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e9'));

    pending.resolve({ data: { summary: journeySummary() } });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว');
  });
});

describe('undoToastOptions — toast สำเร็จชุดเดียวของทุกปุ่มบันทึก (แถบขั้น · บันทึกการติดต่อ · รู้จักร้านจากไหน)', () => {
  it('ไม่มี entryId (เปิดอยู่แล้ว — D9) → อายุ 10 วินาที ไม่มีปุ่มเลิกทำ', () => {
    const { qc } = setup();
    expect(JOURNEY_UNDO_TOAST_MS).toBe(10_000);
    expect(undoToastOptions(qc, 'c1', null)).toEqual({ duration: 10_000 });
  });

  it('มี entryId → ปุ่ม "เลิกทำ" ลบแถวนั้นผ่าน deleteJourneyEntry (ใช้ได้แม้ผู้สร้าง toast ถูกถอดแล้ว — D12)', async () => {
    const { qc } = setup();
    const response: JourneyEntryDeletedResponse = { summary: journeySummary({ stage: 'CONTACTED' }) };
    mocks.del.mockImplementation(async () => ({ data: response }));

    const options = undoToastOptions(qc, 'c1', 'e1');
    expect(options).toMatchObject({ duration: 10_000, action: { label: 'เลิกทำ' } });
    options.action?.onClick();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
    expect(mocks.del).toHaveBeenCalledWith('/customers/c1/journey/entries/e1');
    expect(qc.getQueryData(SUMMARY_KEY)).toEqual(response.summary);
  });

  it('ส่ง onUndo → ปุ่มเรียก onUndo แทน (ผู้เรียกลบเองพร้อมอัปเดตสถานะของตัวเอง เช่นแถบรู้จักร้านจากไหน)', () => {
    const { qc } = setup();
    const onUndo = vi.fn();

    undoToastOptions(qc, 'c1', 'e1', onUndo).action?.onClick();

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});

describe('postHeardFrom', () => {
  it('สำเร็จ → false · body เป็น HEARD_FROM พร้อม clientRequestId ใหม่ทุกครั้ง', async () => {
    mocks.post.mockImplementation(async () => ({ data: {} }));

    await expect(postHeardFrom('c-new', 'FRIEND')).resolves.toBe(false);
    await expect(postHeardFrom('c-new', 'WALK_BY')).resolves.toBe(false);

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/customers/c-new/journey/entries', {
      kind: 'HEARD_FROM',
      heardFrom: 'FRIEND',
      clientRequestId: 'uuid-1',
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/customers/c-new/journey/entries', {
      kind: 'HEARD_FROM',
      heardFrom: 'WALK_BY',
      clientRequestId: 'uuid-2',
    });
  });

  it('ล้ม → true · ไม่โยน · ไม่ toast (dialog เตือนหลัง toast สร้างลูกค้าสำเร็จเอง)', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(postHeardFrom('c-new', 'OTHER')).resolves.toBe(true);

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
