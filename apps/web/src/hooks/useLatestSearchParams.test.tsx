import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useLatestSearchParams } from './useLatestSearchParams';

function setup(initialUrl: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const [searchParams, update] = useLatestSearchParams();
      return { searchParams, update, location: useLocation(), navigate: useNavigate() };
    },
    { wrapper },
  );
}

const paramsOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useLatestSearchParams', () => {
  it('เขียนสองครั้งก่อน render — ครั้งที่สองต่อยอดจากครั้งแรก ไม่ทับทิ้ง', () => {
    const { result } = setup('/list?zone=shop');

    act(() => {
      result.current.update((next) => next.set('a', '1'));
      result.current.update((next) => next.set('b', '2'));
    });

    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'shop', a: '1', b: '2' });
    expect(result.current.searchParams.get('a')).toBe('1');
  });

  it('ตัวเขียนอื่นเปลี่ยน URL (navigate ตรง) — การเขียนครั้งถัดไปตั้งต้นจาก URL จริงล่าสุด', () => {
    const { result } = setup('/list?a=1');

    act(() => {
      result.current.update((next) => next.set('b', '2'));
    });
    act(() => {
      result.current.navigate('/list?zone=fin', { replace: true });
    });
    act(() => {
      result.current.update((next) => next.set('c', '3'));
    });

    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'fin', c: '3' });
  });

  it('เขียนแบบ replace — ไม่เพิ่มประวัติให้ปุ่มย้อนกลับ', () => {
    const { result } = setup('/list');
    const before = window.history.length;

    act(() => {
      result.current.update((next) => next.set('a', '1'));
    });

    expect(window.history.length).toBe(before);
    expect(paramsOf(result.current.location.search)).toEqual({ a: '1' });
  });
});
