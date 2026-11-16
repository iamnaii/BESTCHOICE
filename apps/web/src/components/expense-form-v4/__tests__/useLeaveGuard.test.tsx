// apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLeaveGuard } from '../useLeaveGuard';

type Guard = ReturnType<typeof useLeaveGuard>;

const mountGuard = () =>
  renderHook(({ state }: { state: object }) => useLeaveGuard(state), {
    initialProps: { state: { n: 0 } as object },
  });

/** ผู้ใช้กดแป้นในกรอบฟอร์ม */
const touch = (guard: Guard) => act(() => guard.captureProps.onKeyDownCapture());
const beforeUnloadAdded = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.some((c) => c[0] === 'beforeunload');

afterEach(() => vi.restoreAllMocks());

describe('useLeaveGuard', () => {
  it('ผู้ใช้แตะฟอร์มแล้ว state เปลี่ยน → ผูก beforeunload ที่กันการปิดแท็บ', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { result, rerender } = mountGuard();
    touch(result.current);
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(true);
    const handler = add.mock.calls.find((c) => c[0] === 'beforeunload')![1] as (e: Event) => void;
    const event = new Event('beforeunload', { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('state เปลี่ยนตอนผู้ใช้ยังไม่แตะฟอร์ม → ไม่ผูก', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { result, rerender } = mountGuard();
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(false);
    expect(beforeUnloadAdded(add)).toBe(false);
  });

  it('แตะแล้วแต่ state เปลี่ยนจากระบบ (asSystem) → ไม่นับ · การเปลี่ยนครั้งถัดไปของผู้ใช้นับ', () => {
    const { result, rerender } = mountGuard();
    touch(result.current);
    act(() => result.current.asSystem(() => rerender({ state: { n: 1 } })));
    expect(result.current.dirty).toBe(false);
    rerender({ state: { n: 2 } });
    expect(result.current.dirty).toBe(true);
  });

  it('markPristine ถอด beforeunload และการแตะก่อนหน้านั้นไม่นับอีก', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, rerender } = mountGuard();
    touch(result.current);
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.markPristine());
    expect(result.current.dirty).toBe(false);
    expect(beforeUnloadAdded(remove)).toBe(true);
    rerender({ state: { n: 2 } });
    expect(result.current.dirty).toBe(false);
    touch(result.current);
    rerender({ state: { n: 3 } });
    expect(result.current.dirty).toBe(true);
  });
});
