import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// --- mock sonner (capture toast call args including action.onClick) ----------
type ToastCall = {
  message: string;
  options?: { duration?: number; action?: { label: string; onClick: () => void } };
};
const toastCalls: { success: ToastCall[]; error: string[] } = { success: [], error: [] };

vi.mock('sonner', () => ({
  toast: {
    success: (message: string, options?: ToastCall['options']) => {
      toastCalls.success.push({ message, options });
    },
    error: (message: string) => {
      toastCalls.error.push(message);
    },
  },
}));

// --- mock api -----------------------------------------------------------------
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'error'),
}));

// IMPORTANT: import after mocks so the hook picks up the mocked modules.
import { useUndoMutation } from './useUndoMutation';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe('useUndoMutation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastCalls.success.length = 0;
    toastCalls.error.length = 0;
    apiGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('reversibility matrix', () => {
    it('SEND_LINE: shows toast with no action (irreversible)', () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'SEND_LINE',
          message: 'ส่ง LINE 5 ราย',
          reverse,
        });
      });
      expect(toastCalls.success).toHaveLength(1);
      expect(toastCalls.success[0].message).toBe('ส่ง LINE 5 ราย');
      // No action should be wired for SEND_LINE.
      expect(toastCalls.success[0].options?.action).toBeUndefined();
    });

    it('ASSIGN: shows toast with 30s duration + action button', () => {
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'ASSIGN',
          message: 'มอบหมายแล้ว',
          reverse: vi.fn().mockResolvedValue(undefined),
        });
      });
      expect(toastCalls.success[0].options?.duration).toBe(30_000);
      expect(toastCalls.success[0].options?.action?.label).toBe('เลิกทำ');
    });

    it('SNOOZE: 30s duration', () => {
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'SNOOZE',
          message: 'พักไว้แล้ว',
          reverse: vi.fn().mockResolvedValue(undefined),
        });
      });
      expect(toastCalls.success[0].options?.duration).toBe(30_000);
    });

    it('MARK_UNDELIVERABLE: 30s duration', () => {
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'MARK_UNDELIVERABLE',
          message: 'บันทึกส่งไม่ถึง',
          reverse: vi.fn().mockResolvedValue(undefined),
        });
      });
      expect(toastCalls.success[0].options?.duration).toBe(30_000);
    });

    it('PROPOSE_LOCK: 10s duration', () => {
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'PROPOSE_LOCK',
          message: 'เสนอล็อคแล้ว',
          reverse: vi.fn().mockResolvedValue(undefined),
          mdmRequestId: 'mdm-1',
        });
      });
      expect(toastCalls.success[0].options?.duration).toBe(10_000);
    });
  });

  describe('timeout behaviour', () => {
    it('does NOT call reverse if timeout elapses without undo click', async () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'ASSIGN',
          message: 'ok',
          reverse,
        });
      });
      // advance well past the 30s window
      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      expect(reverse).not.toHaveBeenCalled();
    });

    it('cleanup function cancels the pending timeout', () => {
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      let cancel = () => {};
      act(() => {
        cancel = result.current.showUndo({
          kind: 'ASSIGN',
          message: 'ok',
          reverse: vi.fn().mockResolvedValue(undefined),
        });
      });
      act(() => {
        cancel();
      });
      // No assertion failure = timer cleared without throwing; sanity check
      // that subsequent advances don't trigger anything weird.
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      expect(toastCalls.error).toHaveLength(0);
    });

    it('unmount cancels active timers (no pending reverses fire)', () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({ kind: 'ASSIGN', message: 'ok', reverse });
      });
      unmount();
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      expect(reverse).not.toHaveBeenCalled();
    });
  });

  describe('undo invocation', () => {
    it('clicking the action button calls reverse + shows success toast', async () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({ kind: 'ASSIGN', message: 'มอบหมายแล้ว', reverse });
      });
      await act(async () => {
        toastCalls.success[0].options!.action!.onClick();
        // flush microtasks
        await Promise.resolve();
      });
      expect(reverse).toHaveBeenCalledTimes(1);
      // 2 success toasts now: the original + "เลิกทำสำเร็จ"
      expect(toastCalls.success.map((t) => t.message)).toContain('เลิกทำสำเร็จ');
    });

    it('reverse error surfaces as error toast (caller does not need try/catch)', async () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn().mockRejectedValue(new Error('reverse failed'));
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({ kind: 'ASSIGN', message: 'ok', reverse });
      });
      await act(async () => {
        toastCalls.success[0].options!.action!.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(toastCalls.error).toContain('reverse failed');
    });
  });

  describe('PROPOSE_LOCK live-check', () => {
    it('blocks reverse when MdmLockRequest status is no longer PENDING', async () => {
      const { wrapper } = makeWrapper();
      apiGet.mockResolvedValue({ data: { status: 'APPROVED' } });
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'PROPOSE_LOCK',
          message: 'เสนอล็อคแล้ว',
          reverse,
          mdmRequestId: 'mdm-42',
        });
      });
      await act(async () => {
        toastCalls.success[0].options!.action!.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(apiGet).toHaveBeenCalledWith('/overdue/mdm-requests/mdm-42');
      // reverse must NOT be invoked
      expect(reverse).not.toHaveBeenCalled();
      // user-friendly error toast surfaced
      expect(toastCalls.error.some((m) => m.includes('ไม่สามารถยกเลิกได้แล้ว'))).toBe(true);
    });

    it('proceeds with reverse when MdmLockRequest status is still PENDING', async () => {
      const { wrapper } = makeWrapper();
      apiGet.mockResolvedValue({ data: { status: 'PENDING' } });
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'PROPOSE_LOCK',
          message: 'เสนอล็อคแล้ว',
          reverse,
          mdmRequestId: 'mdm-7',
        });
      });
      await act(async () => {
        toastCalls.success[0].options!.action!.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(apiGet).toHaveBeenCalledWith('/overdue/mdm-requests/mdm-7');
      expect(reverse).toHaveBeenCalledTimes(1);
    });

    it('PROPOSE_LOCK without mdmRequestId surfaces error and skips reverse', async () => {
      const { wrapper } = makeWrapper();
      const reverse = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useUndoMutation(), { wrapper });
      act(() => {
        result.current.showUndo({
          kind: 'PROPOSE_LOCK',
          message: 'เสนอล็อคแล้ว',
          reverse,
          // no mdmRequestId
        });
      });
      await act(async () => {
        toastCalls.success[0].options!.action!.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(reverse).not.toHaveBeenCalled();
      expect(toastCalls.error.length).toBeGreaterThan(0);
    });
  });
});
