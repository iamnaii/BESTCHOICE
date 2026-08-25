import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LayoutProvider, useLayout } from './LayoutContext';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LayoutProvider>{children}</LayoutProvider>
);

describe('LayoutContext currentZone persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('defaults to "shop" when no URL and no localStorage', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('reads from URL ?zone= first (priority 1)', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    localStorage.setItem('bc.sidebar.lastZone', 'shop');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('falls back to localStorage when URL has no ?zone= (priority 2)', () => {
    localStorage.setItem('bc.sidebar.lastZone', 'fin');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('setCurrentZone updates state + localStorage + URL', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.setCurrentZone('fin'));
    expect(result.current.currentZone).toBe('fin');
    expect(localStorage.getItem('bc.sidebar.lastZone')).toBe('fin');
    expect(new URL(window.location.href).searchParams.get('zone')).toBe('fin');
  });

  it('ignores invalid zone in URL', () => {
    window.history.replaceState({}, '', '/?zone=invalid');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('ignores invalid zone in localStorage', () => {
    localStorage.setItem('bc.sidebar.lastZone', 'invalid');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('accepts "settings" zone from URL', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('settings');
  });
});

describe('LayoutContext effectiveSidebarCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('โหมดตั้งค่าบังคับกางเมนู แม้ผู้ใช้ตั้งค่าไว้เป็นย่อ', () => {
    localStorage.setItem('sidebar_collapse', 'true');
    window.history.replaceState({}, '', '/?zone=settings');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.sidebarCollapse).toBe(true);
    expect(result.current.effectiveSidebarCollapse).toBe(false);
  });

  it('ออกจากตั้งค่าแล้วได้ค่าที่ผู้ใช้ตั้งไว้คืน (ไม่เขียนทับ localStorage)', () => {
    localStorage.setItem('sidebar_collapse', 'true');
    window.history.replaceState({}, '', '/?zone=settings');
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => {
      result.current.exitSettings({ zone: 'shop', path: '/' });
    });
    expect(result.current.effectiveSidebarCollapse).toBe(true);
    expect(localStorage.getItem('sidebar_collapse')).toBe('true');
  });
});

describe('LayoutContext settingsReturn', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('enterSettings จำที่ที่จากมา แล้ว exitSettings คืนที่เดิม', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.enterSettings({ zone: 'fin', path: '/payments' }));
    expect(result.current.currentZone).toBe('settings');

    let out: { zone: string; path: string } | undefined;
    act(() => {
      out = result.current.exitSettings({ zone: 'shop', path: '/' });
    });
    expect(out).toEqual({ zone: 'fin', path: '/payments' });
    expect(result.current.currentZone).toBe('fin');
  });

  it('ออกครั้งที่สองไม่มีของค้าง → ใช้ fallback (กันเด้งกลับที่เก่าซ้ำ)', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.enterSettings({ zone: 'fin', path: '/payments' }));
    act(() => {
      result.current.exitSettings({ zone: 'shop', path: '/' });
    });
    let out: { zone: string; path: string } | undefined;
    act(() => {
      out = result.current.exitSettings({ zone: 'shop', path: '/' });
    });
    expect(out).toEqual({ zone: 'shop', path: '/' });
  });

  it('ไม่ persist ที่จำไว้ — รีเฟรชกลางโหมดตั้งค่าต้องตกไป fallback ไม่ใช่ path เก่าที่อาจหมดสิทธิ์', () => {
    const { result, unmount } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.enterSettings({ zone: 'fin', path: '/payments' }));
    unmount();
    const fresh = renderHook(() => useLayout(), { wrapper });
    expect(fresh.result.current.settingsReturn).toBeNull();
  });
});
